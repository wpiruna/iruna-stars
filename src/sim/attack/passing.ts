/**
 * Smart receiver selection and pass risk (GDD §6.4 [FIJO]). Pure: given who is where, it says
 * which team-mate a pad direction means, what kind of pass goes there and how likely each
 * defender is to cut it out. The preview colours and the real roll use these same numbers, so
 * the warning and the result never contradict each other.
 */
import { barFactor, clamp, lerp } from '../../core/math';
import type { Goal, Vec2, Vec3 } from '../field';
import type { AttackTuning, PassType, Swimmer } from './types';
import { angleBetween, dir, dist, dot, norm, sigmoid } from './vec';

type PassTuning = AttackTuning['pase'];

export interface DriveInfo {
  destination: Vec2;
  free: boolean;
  /** Swimming speed while driving, m/s. */
  speed: number;
}

export interface PassWorld {
  holder: Swimmer;
  /** Ball in the passer's hand. */
  from: Vec3;
  /** Team-mates other than the holder (may include our own keeper). */
  teammates: readonly Swimmer[];
  /** Field defenders who can cut a pass out. */
  defenders: readonly Swimmer[];
  /** The goal being attacked. */
  goal: Goal;
  drives: ReadonlyMap<Swimmer, DriveInfo>;
  boya: Swimmer | null;
  /** How well the centre holds position: −1 fronted … +1 won (GDD §6.6). */
  post: number;
}

export interface RiskShare {
  defender: Swimmer;
  /** Probability that this defender cuts the pass out. */
  risk: number;
  /** Fraction of the flight at which they would get it. */
  s: number;
}

export interface PassCandidate {
  receiver: Swimmer;
  type: PassType;
  point: Vec2;
  endZ: number;
  arc: number;
  speed: number;
  flightTime: number;
  /** Degrees between the pad direction and the pass. */
  angleError: number;
  distance: number;
  risk: number;
  shares: RiskShare[];
  free: number;
  role: number;
  score: number;
}

export interface PassChoice {
  best: PassCandidate | null;
  candidates: PassCandidate[];
  /** Cone actually used: the normal one, or the wide one when the normal one was empty. */
  cone: number;
}

export type RiskColor = 'green' | 'amber' | 'red';

export function riskColor(risk: number, t: PassTuning): RiskColor {
  return risk < t.colores.verde ? 'green' : risk < t.colores.ambar ? 'amber' : 'red';
}

const TYPE_KEY: Record<PassType, 'seco' | 'mojado' | 'adelantado' | 'largo'> = {
  dry: 'seco',
  wet: 'mojado',
  lead: 'adelantado',
  long: 'largo',
};

export function passSpeed(passer: Swimmer, type: PassType, t: PassTuning): number {
  return lerp(t.velocidad.min, t.velocidad.max, barFactor(passer.player.stats.passing)) * t.factor[TYPE_KEY[type]];
}

function nearestDefender(world: PassWorld, p: Vec2): { defender: Swimmer; distance: number } | null {
  let best: { defender: Swimmer; distance: number } | null = null;
  for (const defender of world.defenders) {
    const d = dist(defender.pos, p);
    if (!best || d < best.distance) best = { defender, distance: d };
  }
  return best;
}

/**
 * How squarely a defender stands between a receiver and the ball: 0 = beside or behind
 * (the receiver's body is in the way), 1 = right in front, denying the pass.
 */
export function fronting(receiver: Vec2, defender: Vec2, ball: Vec2): number {
  return clamp((dot(dir(receiver, defender), dir(receiver, ball)) - 0.35) / 0.5, 0, 1);
}

/** Dry to the hand, wet to the water, ahead of a driver, or long. */
export function passTypeFor(world: PassWorld, receiver: Swimmer, t: PassTuning): PassType {
  if (world.drives.has(receiver)) return 'lead';
  if (dist(world.from, receiver.pos) > t.distanciaLargo) return 'long';
  if (receiver === world.boya) return 'wet';
  const near = nearestDefender(world, receiver.pos);
  if (near) {
    const front = fronting(receiver.pos, near.defender.pos, world.from);
    if (near.distance < t.marcado.pegado || (near.distance < t.marcado.distancia && front > 0.6)) return 'wet';
  }
  return 'dry';
}

/** Seconds a defender treading water needs to cover a distance: accelerates, then swims flat out. */
function timeToCover(distance: number, t: PassTuning['defensor']): number {
  const accelerationTime = t.estirada / t.aceleracion;
  const accelerationDistance = (t.estirada * accelerationTime) / 2;
  if (distance <= accelerationDistance) return Math.sqrt((2 * distance) / t.aceleracion);
  return accelerationTime + (distance - accelerationDistance) / t.estirada;
}

/** Where the ball is sent for each kind of pass. */
export function receivePoint(world: PassWorld, receiver: Swimmer, type: PassType, speed: number, t: PassTuning): Vec2 {
  const r = receiver.pos;
  if (type === 'lead') {
    const drive = world.drives.get(receiver);
    if (drive) {
      // Where the driver will be when the ball gets there (two refinements are plenty).
      const towards = dir(r, drive.destination);
      const left = dist(r, drive.destination);
      let point = r;
      let flight = dist(world.from, r) / speed;
      for (let i = 0; i < 3; i++) {
        const travel = Math.min(left, drive.speed * flight);
        point = { x: r.x + towards.x * travel, y: r.y + towards.y * travel };
        flight = dist(world.from, point) / speed;
      }
      return point;
    }
  }
  if (type === 'wet') {
    // Into the water on the side away from the defender.
    const near = nearestDefender(world, r);
    const away = near && near.distance < 2 ? dir(near.defender.pos, r) : dir(r, world.from);
    return { x: r.x + away.x * t.ladoMojado, y: r.y + away.y * t.ladoMojado };
  }
  // To the hand, which reaches towards the ball and away from the defender.
  const near = nearestDefender(world, r);
  const towardsBall = dir(r, world.from);
  const away = near && near.distance < 2 ? dir(r, near.defender.pos) : { x: 0, y: 0 };
  const hand = norm({ x: towardsBall.x - away.x * t.manoLejosDefensor, y: towardsBall.y - away.y * t.manoLejosDefensor });
  return { x: r.x + hand.x * t.manoHaciaBalon, y: r.y + hand.y * t.manoHaciaBalon };
}

/**
 * Chance that each defender cuts the pass out. A defender gets there if, from a standstill, they
 * can reach a point of the flight (with an arm, if the ball is low enough) before the ball does.
 * Near the catch the receiver's body is in the way unless the defender fronts them, and the
 * passer throws around their own marker.
 */
export function passRisk(
  passer: Swimmer,
  from: Vec3,
  to: Vec2,
  endZ: number,
  arc: number,
  speed: number,
  receiver: Swimmer,
  defenders: readonly Swimmer[],
  t: PassTuning,
): { total: number; shares: RiskShare[] } {
  const d = t.defensor;
  const total = Math.max(0.01, dist(from, to)) / speed;
  const shares: RiskShare[] = [];
  let keep = 1;
  for (const defender of defenders) {
    const reaction = lerp(d.reaccion.lento, d.reaccion.rapido, barFactor(defender.player.stats.defense));
    const front = fronting(receiver.pos, defender.pos, from);
    const fromReceiver = dir(receiver.pos, defender.pos);
    let best = 0;
    let bestS = 1;
    for (let i = 1; i <= 10; i++) {
      const s = i / 10;
      const p = { x: from.x + (to.x - from.x) * s, y: from.y + (to.y - from.y) * s };
      const z = from.z + (endZ - from.z) * s + arc * 4 * s * (1 - s);
      if (z > d.alturaAlcance) continue;
      // How close to the catch: there the receiver's body is in the way of a defender who does not front.
      const nearCatch = dist(p, to);
      let gap = Math.max(0, dist(defender.pos, p) - d.alcance);
      // A ball on the far side of the receiver means going round their body.
      if (dist(p, receiver.pos) < d.radioEscudo && dot(fromReceiver, dir(receiver.pos, p)) < 0) gap += d.rodeo;
      let r = sigmoid(d.pendiente * (s * total - (reaction + timeToCover(gap, d))));
      if (nearCatch < d.radioEscudo) r *= lerp(lerp(d.escudoCuerpo, d.disputa, front), 1, nearCatch / d.radioEscudo);
      if (defender.mark === passer) r *= d.factorPropio;
      if (r > best) {
        best = r;
        bestS = s;
      }
    }
    best = Math.min(0.95, best);
    if (best >= 0.01) {
      shares.push({ defender, risk: best, s: bestS });
      keep *= 1 - best;
    }
  }
  shares.sort((a, b) => a.s - b.s);
  return { total: 1 - keep, shares };
}

/** Everything about a pass to one team-mate, before the pad direction is taken into account. */
export function evaluatePass(world: PassWorld, receiver: Swimmer, t: PassTuning): Omit<PassCandidate, 'angleError' | 'score'> {
  const type = passTypeFor(world, receiver, t);
  const speed = passSpeed(world.holder, type, t);
  const point = receivePoint(world, receiver, type, speed, t);
  const endZ = type === 'dry' || type === 'long' ? t.alturaRecepcion : 0.05;
  const arc = t.arco[TYPE_KEY[type]];
  const { total, shares } = passRisk(world.holder, world.from, point, endZ, arc, speed, receiver, world.defenders, t);
  const near = nearestDefender(world, point);
  const free = near ? clamp((near.distance - 0.6) / 1.4, 0, 1) : 1;
  const drive = world.drives.get(receiver);
  let role = drive ? (drive.free ? 1 : 0.2) : 0;
  if (receiver === world.boya) role += 0.6 * world.post;
  // Never invite a 2-metre foul: receiving inside 2 m ahead of the ball.
  const fromLine = (world.goal.x - point.x) * world.goal.facing;
  const ballLine = (world.goal.x - world.from.x) * world.goal.facing;
  if (fromLine < 2 && fromLine < ballLine) role -= 1;
  const distance = dist(world.from, point);
  return { receiver, type, point, endZ, arc, speed, flightTime: distance / speed, distance, risk: total, shares, free, role };
}

/**
 * The team-mate the player means with a pad direction (`aim`, world space). Candidates inside a
 * ±50° cone are scored by angle, risk, space, distance and role; only those within 20° of the
 * best-aligned one may win, so a clear direction is never overruled. Empty cone → ±90°; still
 * empty → null (no pass). The keeper only gets the ball when clearly aimed at.
 */
export function choosePass(world: PassWorld, aim: Vec2, previous: Swimmer | null, t: PassTuning): PassChoice {
  const field = world.teammates.filter((s) => !s.keeper);
  const keepers = world.teammates.filter((s) => s.keeper);
  const angleTo = (s: Swimmer): number => angleBetween(aim, { x: s.pos.x - world.from.x, y: s.pos.y - world.from.y });

  let cone = t.cono;
  let inCone = field.filter((s) => angleTo(s) <= cone);
  if (inCone.length === 0) {
    cone = t.conoAmplio;
    inCone = field.filter((s) => angleTo(s) <= cone);
  }
  if (inCone.length === 0) inCone = keepers.filter((s) => angleTo(s) <= t.conoPortero);
  if (inCone.length === 0) return { best: null, candidates: [], cone };

  const w = t.pesos;
  const candidates: PassCandidate[] = inCone.map((receiver) => {
    const base = evaluatePass(world, receiver, t);
    const angleError = angleBetween(aim, { x: base.point.x - world.from.x, y: base.point.y - world.from.y });
    const angleScore = 1 - Math.min(1, (angleError / cone) ** 2);
    const distanceScore = 1 - clamp((base.distance - 3) / 9, 0, 1);
    const score =
      w.angulo * angleScore +
      w.riesgo * (1 - base.risk) +
      w.libre * base.free +
      w.distancia * distanceScore +
      w.papel * clamp(base.role, -1, 1) +
      (receiver === previous ? t.histeresis : 0);
    return { ...base, angleError, score };
  });
  const bestAligned = Math.min(...candidates.map((c) => c.angleError));
  const contenders = candidates.filter((c) => c.angleError <= bestAligned + t.guardaIntencion);
  const best = contenders.reduce((a, b) => (b.score > a.score ? b : a));
  candidates.sort((a, b) => b.score - a.score);
  return { best, candidates, cone };
}

/** HABILIDAD + direction: the team-mate in that zone who should drive (or fight for position). */
export function chooseDriver(world: PassWorld, aim: Vec2, t: PassTuning): Swimmer | null {
  let best: Swimmer | null = null;
  let bestCost = Infinity;
  for (const mate of world.teammates) {
    if (mate.keeper) continue;
    const error = angleBetween(aim, { x: mate.pos.x - world.from.x, y: mate.pos.y - world.from.y });
    if (error > t.conoEntrada) continue;
    const cost = error + 2 * dist(world.from, mate.pos);
    if (cost < bestCost) {
      bestCost = cost;
      best = mate;
    }
  }
  return best;
}
