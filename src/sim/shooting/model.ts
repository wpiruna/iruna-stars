/**
 * Shot and save model (GDD §6.7 and §10). Pure functions: no rendering, no global state, every
 * random number comes from the Rng passed in. The constants live in data/tuning.json.
 *
 * Goal-plane coordinates: `u` is the lateral offset from the centre of the goal (world y minus
 * goal y, so negative is the post drawn higher on screen) and `v` is the height above the water.
 */
import { barFactor, clamp, lerp } from '../../core/math';
import type { Rng } from '../../core/rng';
import type { Goal, Vec2 } from '../field';

export type ShotMode = 'direct' | 'skip' | 'lob';
/** −1 = the post drawn higher on screen, +1 = the lower one, 0 = let the player pick the gap. */
export type AimSide = -1 | 0 | 1;
export type ChargeQuality = 'quick' | 'short' | 'optimal' | 'over';
export type Landing = 'onTarget' | 'post' | 'bar' | 'wide' | 'over';
export type KeeperContext = 'open' | 'penalty';

interface Range {
  min: number;
  max: number;
}

export interface ShotTuning {
  segundosCarga: number;
  segundosTiroRapido: number;
  segundosMaximoCargado: number;
  zonaOptimaCentro: number;
  zonaOptimaSemiancho: Range;
  velocidadMaxima: Range;
  potenciaTiroRapido: number;
  potenciaMinimaCargado: number;
  dispersionA6m: Range;
  dispersionVertical: number;
  exponenteDistancia: number;
  factorTiroRapido: number;
  factorCorto: number;
  factorPasado: number;
  factorBote: number;
  factorVaselina: number;
  apuntadoPalo: number;
  alturaApuntado: number;
  bote: { distanciaAntesDeGol: number; perdidaVelocidad: number };
  vaselina: { velocidad: number; alturaMaxima: number; alturaApuntado: number };
  /** Band around each post and the bar that counts as "off the frame": metres inside and outside. */
  poste: { dentro: number; fuera: number };
  paloYDentro: number;
}

interface KeeperModeTuning {
  alcance: number;
  reaccion: Range;
  estirada: Range;
}
export interface KeeperTuning {
  limites: Range;
  pendiente: number;
  pesoAltura: number;
  alturaManos: number;
  abierto: KeeperModeTuning;
  penalti: KeeperModeTuning & { factorAdivinar: number; alcanceLadoContrario: number };
  extraReaccionBote: Range;
  vaselina: { reaccion: Range; retroceso: Range; profundidad: number };
  errorColocacion: Range;
  blocaje: { velocidadMaxima: number; margenMinimo: number };
}

export interface ShooterProfile {
  power: number;
  accuracy: number;
  /** 0–1. Below 0.5 the shot loses pace and precision (GDD §11.2). */
  energy: number;
}

export interface KeeperProfile {
  reflexes: number;
  positioning: number;
  energy: number;
}

export interface ChargeResult {
  quality: ChargeQuality;
  /** Fraction of the shooter's top speed. */
  power: number;
  /** Multiplier on the dispersion. */
  spread: number;
}

/** Where the sweet spot of the charge bar is for a given Precisión. */
export function optimalZone(accuracy: number, t: ShotTuning): { start: number; end: number } {
  const half = lerp(t.zonaOptimaSemiancho.min, t.zonaOptimaSemiancho.max, barFactor(accuracy));
  return { start: t.zonaOptimaCentro - half, end: t.zonaOptimaCentro + half };
}

/**
 * Reads the charge bar. `charge` is 0–1 (how full it was on release) or null for a quick shot.
 * Short → less pace. Sweet spot → high pace, best precision. Past it → top pace, growing spread.
 */
export function evaluateCharge(charge: number | null, accuracy: number, t: ShotTuning): ChargeResult {
  if (charge === null) return { quality: 'quick', power: t.potenciaTiroRapido, spread: t.factorTiroRapido };
  const zone = optimalZone(accuracy, t);
  const c = clamp(charge, 0, 1);
  if (c < zone.start) {
    const k = c / zone.start;
    return {
      quality: 'short',
      power: lerp(t.potenciaMinimaCargado, 0.94, k * k * (3 - 2 * k)),
      spread: lerp(t.factorCorto, 1, k),
    };
  }
  if (c <= zone.end) {
    return { quality: 'optimal', power: lerp(0.95, 1, (c - zone.start) / (zone.end - zone.start)), spread: 1 };
  }
  const over = (c - zone.end) / Math.max(1e-6, 1 - zone.end);
  return { quality: 'over', power: 1, spread: 1 + t.factorPasado * over * over };
}

/** Tired players shoot softer and wilder. Full effect only when the bar is empty. */
function energyPenalty(energy: number): number {
  return clamp((0.5 - energy) / 0.5, 0, 1);
}

export function topSpeed(shooter: ShooterProfile, t: ShotTuning): number {
  const speed = lerp(t.velocidadMaxima.min, t.velocidadMaxima.max, barFactor(shooter.power));
  return speed * (1 - 0.18 * energyPenalty(shooter.energy));
}

export interface ShotRequest {
  from: Vec2;
  /** Height of the hand on release. */
  releaseHeight: number;
  charge: number | null;
  side: AimSide;
  mode: ShotMode;
  /** 0 = free, 1 = a defender all over the shooter. */
  pressure: number;
}

export interface ShotPlan {
  mode: ShotMode;
  side: AimSide;
  quality: ChargeQuality;
  from: Vec2;
  releaseHeight: number;
  /** Speed leaving the hand, m/s. */
  speed: number;
  /** Where the shooter aimed and where the ball actually crosses the goal plane. */
  aim: { u: number; v: number };
  arrival: { u: number; v: number };
  landing: Landing;
  /** Seconds from release to the goal plane. */
  flightTime: number;
  /** Speed on arrival (a skip shot loses some on the bounce). */
  arrivalSpeed: number;
  /** Where a skip shot hits the water. */
  bounce?: Vec2;
  /** Fraction of the flight at which the bounce happens. */
  bounceAt?: number;
}

/**
 * Turns the player's input into a concrete shot: aim point, speed, the error that the stats and
 * the situation add, and where the ball ends up relative to the goal frame.
 */
export function planShot(
  request: ShotRequest,
  shooter: ShooterProfile,
  goal: Goal,
  /** Lateral position of the keeper, used to pick the open side when no direction is held. */
  keeperU: number,
  rng: Rng,
  t: ShotTuning,
): ShotPlan {
  const charge = evaluateCharge(request.charge, shooter.accuracy, t);
  const accuracy = barFactor(shooter.accuracy);
  const tired = energyPenalty(shooter.energy);

  // --- Aim ------------------------------------------------------------------------------------
  let side = request.side;
  let aimU: number;
  if (side === 0) {
    // No direction held: the player looks for the bigger gap, as well as their Precisión allows.
    const open: 1 | -1 = keeperU > 0 ? -1 : keeperU < 0 ? 1 : rng.chance(0.5) ? 1 : -1;
    aimU = open * lerp(goal.halfWidth * 0.45, goal.halfWidth - t.apuntadoPalo - 0.1, accuracy);
    side = 0;
  } else {
    aimU = side * (goal.halfWidth - t.apuntadoPalo);
  }
  const aimV = request.mode === 'lob' ? t.vaselina.alturaApuntado : t.alturaApuntado;

  // --- Geometry -------------------------------------------------------------------------------
  const target: Vec2 = { x: goal.x, y: goal.y + aimU };
  const dx = Math.abs(target.x - request.from.x);
  const dy = target.y - request.from.y;
  const dist = Math.max(0.5, Math.hypot(dx, dy));
  // From a tight angle the same angular error spreads further along the goal line.
  const obliquity = clamp(dx / dist, 0.25, 1);

  // --- Error ----------------------------------------------------------------------------------
  let sigma = lerp(t.dispersionA6m.max, t.dispersionA6m.min, accuracy) * Math.pow(dist / 6, t.exponenteDistancia);
  sigma *= charge.spread * (1 + 0.8 * clamp(request.pressure, 0, 1)) * (1 + 0.5 * tired);
  if (request.mode === 'skip') sigma *= t.factorBote;
  if (request.mode === 'lob') sigma *= t.factorVaselina;
  const u = aimU + (rng.gauss() * sigma) / obliquity;
  let v = aimV + rng.gauss() * sigma * t.dispersionVertical;
  // A direct shot that drops short skims off the water just before the line.
  if (v < 0) v = -v * 0.5;

  // --- Speed and time -------------------------------------------------------------------------
  const top = topSpeed(shooter, t);
  let speed = top * charge.power;
  let arrivalSpeed = speed;
  let flightTime: number;
  let bounce: Vec2 | undefined;
  let bounceAt: number | undefined;
  const actualDist = Math.max(0.5, Math.hypot(dx, goal.y + u - request.from.y));

  if (request.mode === 'lob') {
    // A lob is about touch, not pace: Potencia only helps a little.
    speed = t.vaselina.velocidad * lerp(0.92, 1.12, barFactor(shooter.power));
    arrivalSpeed = speed;
    flightTime = actualDist / speed;
  } else if (request.mode === 'skip') {
    const afterBounce = Math.min(t.bote.distanciaAntesDeGol, actualDist * 0.5);
    const before = actualDist - afterBounce;
    arrivalSpeed = speed * (1 - t.bote.perdidaVelocidad);
    flightTime = before / speed + afterBounce / arrivalSpeed;
    bounceAt = before / speed / flightTime;
    const k = before / actualDist;
    bounce = { x: lerp(request.from.x, goal.x, k), y: lerp(request.from.y, goal.y + u, k) };
  } else {
    flightTime = actualDist / speed;
  }

  // --- Where it ends up against the frame -------------------------------------------------------
  const absU = Math.abs(u);
  let landing: Landing;
  if (v > goal.height + t.poste.fuera) landing = 'over';
  else if (absU > goal.halfWidth + t.poste.fuera) landing = 'wide';
  else if (absU > goal.halfWidth - t.poste.dentro) landing = 'post';
  else if (v > goal.height - t.poste.dentro) landing = 'bar';
  else landing = 'onTarget';

  const plan: ShotPlan = {
    mode: request.mode,
    side,
    quality: charge.quality,
    from: { ...request.from },
    releaseHeight: request.releaseHeight,
    speed,
    aim: { u: aimU, v: aimV },
    arrival: { u, v },
    landing,
    flightTime,
    arrivalSpeed,
  };
  if (bounce) plan.bounce = bounce;
  if (bounceAt !== undefined) plan.bounceAt = bounceAt;
  return plan;
}

export interface KeeperState {
  /** Lateral position on the goal line when the ball is released. */
  u: number;
  /**
   * Penalty only: the side the keeper commits to (same convention as AimSide; 0 = waits), and
   * how well timed the dive was (0–1).
   */
  commit?: { side: AimSide; timing: number };
  /** Extra readiness from watching the shooter wind up (0–1). */
  set?: number;
}

export interface SaveEstimate {
  probability: number;
  /** Metres the keeper can cover in time. */
  reach: number;
  /** Metres the keeper has to cover. */
  need: number;
  margin: number;
}

/** Ideal lateral position: on the line between the ball and the centre of the goal. */
export function keeperIdealU(from: Vec2, goal: Goal, depth = 0.5): number {
  const dx = Math.max(0.5, Math.abs(goal.x - from.x));
  return clamp(((from.y - goal.y) * depth) / dx, -goal.halfWidth * 0.6, goal.halfWidth * 0.6);
}

/** Where the keeper actually is: the ideal spot plus an error that Colocación reduces. */
export function keeperPosition(from: Vec2, goal: Goal, keeper: KeeperProfile, rng: Rng, t: KeeperTuning): number {
  const error = lerp(t.errorColocacion.max, t.errorColocacion.min, barFactor(keeper.positioning));
  return keeperIdealU(from, goal) + rng.gauss() * error;
}

/**
 * Chance that the keeper stops an on-target shot. Compares how far the keeper can get in the
 * time the ball takes against how far the ball is from them. Never certain either way.
 */
export function estimateSave(
  plan: ShotPlan,
  keeper: KeeperProfile,
  state: KeeperState,
  context: KeeperContext,
  t: KeeperTuning,
): SaveEstimate {
  const reflexes = barFactor(keeper.reflexes);
  const positioning = barFactor(keeper.positioning);
  const tired = 1 - 0.2 * clamp((0.5 - keeper.energy) / 0.5, 0, 1);
  const lateral = plan.arrival.u - state.u;
  const vertical = (plan.arrival.v - t.alturaManos) * t.pesoAltura;
  let need = Math.hypot(lateral, vertical);
  let reach: number;

  if (plan.mode === 'lob' && !(context === 'penalty' && state.commit && state.commit.side !== 0)) {
    // A lob gives time, but it drops behind the keeper: it is about reading it and going back.
    const reaction = lerp(t.vaselina.reaccion.max, t.vaselina.reaccion.min, positioning);
    const backSpeed = lerp(t.vaselina.retroceso.min, t.vaselina.retroceso.max, positioning);
    // On a penalty the keeper is on the line, so there is no water behind them to drop the ball into.
    const depth = context === 'penalty' ? 0 : t.vaselina.profundidad;
    need = Math.hypot(lateral, depth * 1.5 + Math.max(0, plan.arrival.v - t.alturaManos));
    reach = t.abierto.alcance * 0.75 + backSpeed * Math.max(0, plan.flightTime - reaction);
  } else if (context === 'penalty') {
    const mode = t.penalti;
    const lunge = lerp(mode.estirada.min, mode.estirada.max, reflexes);
    const commit = state.commit;
    if (commit && commit.side !== 0) {
      const sameSide = Math.sign(lateral) === commit.side || Math.abs(lateral) < 0.25;
      // Guessed right: already moving when the ball leaves. Guessed wrong: only a trailing leg.
      reach = sameSide
        ? mode.alcance + lunge * mode.factorAdivinar * plan.flightTime * commit.timing
        : mode.alcanceLadoContrario;
    } else {
      let reaction = lerp(mode.reaccion.max, mode.reaccion.min, reflexes);
      if (plan.mode === 'skip') reaction += lerp(t.extraReaccionBote.max, t.extraReaccionBote.min, positioning);
      reach = mode.alcance + lunge * Math.max(0, plan.flightTime - reaction);
    }
  } else {
    const mode = t.abierto;
    let reaction = lerp(mode.reaccion.max, mode.reaccion.min, reflexes) - 0.04 * clamp(state.set ?? 0, 0, 1);
    if (plan.mode === 'skip') reaction += lerp(t.extraReaccionBote.max, t.extraReaccionBote.min, positioning);
    reach = mode.alcance + lerp(mode.estirada.min, mode.estirada.max, reflexes) * Math.max(0, plan.flightTime - reaction);
  }

  reach *= tired;
  const margin = reach - need;
  const probability = clamp(1 / (1 + Math.exp(-t.pendiente * margin)), t.limites.min, t.limites.max);
  return { probability, reach, need, margin };
}

export type ShotOutcome =
  | { type: 'goal'; viaPost: boolean }
  | { type: 'save'; held: boolean }
  | { type: 'post' }
  | { type: 'miss'; where: 'wide' | 'over' };

/** Final result of a shot once the keeper has had their say. */
export function resolveShot(
  plan: ShotPlan,
  goal: Goal,
  keeper: KeeperProfile,
  state: KeeperState,
  context: KeeperContext,
  rng: Rng,
  shotTuning: ShotTuning,
  keeperTuning: KeeperTuning,
): { outcome: ShotOutcome; save: SaveEstimate | null } {
  if (plan.landing === 'wide' || plan.landing === 'over') {
    return { outcome: { type: 'miss', where: plan.landing }, save: null };
  }
  if (plan.landing === 'post' || plan.landing === 'bar') {
    // Off the frame: a ball that clips the inner side sometimes goes in, the rest come back out.
    const innerSide = plan.landing === 'bar' ? plan.arrival.v < goal.height : Math.abs(plan.arrival.u) < goal.halfWidth;
    if (innerSide && rng.chance(shotTuning.paloYDentro)) return { outcome: { type: 'goal', viaPost: true }, save: null };
    return { outcome: { type: 'post' }, save: null };
  }
  const save = estimateSave(plan, keeper, state, context, keeperTuning);
  if (!rng.chance(save.probability)) return { outcome: { type: 'goal', viaPost: false }, save };
  // Slow shots straight at the keeper are held; hard or stretched ones are pushed away.
  const held =
    plan.arrivalSpeed <= keeperTuning.blocaje.velocidadMaxima && save.margin >= keeperTuning.blocaje.margenMinimo
      ? rng.chance(0.85)
      : rng.chance(0.15);
  return { outcome: { type: 'save', held }, save };
}
