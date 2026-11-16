/**
 * Drives (GDD §6.5, plan §6.3): HABILIDAD + direction sends a team-mate towards the goal looking
 * for inside water. A roll at the start sets how late the defender reacts; after that both swim
 * for real and the result is read from where they end up: free, dragging the defender, or nothing.
 */
import { barFactor, clamp, lerp } from '../../core/math';
import type { Rng } from '../../core/rng';
import { fromGoal, type Goal, type Vec2 } from '../field';
import { toGoal } from './formation';
import type { AttackTuning, Swimmer } from './types';
import { dir, dist, sigmoid } from './vec';

type DriveTuning = AttackTuning['entrada'];

export interface Drive {
  driver: Swimmer;
  defender: Swimmer | null;
  from: Vec2;
  destination: Vec2;
  startedAt: number;
  /** Seconds the defender takes to react. */
  reaction: number;
  phase: 'start' | 'run' | 'free';
  freeUntil: number;
  /** Where the defender was when the drive began (to tell a drag from a plain failure). */
  defenderHome: Vec2;
}

export type DriveStep = 'free' | 'end-free' | 'end-drag' | 'end-fail' | null;

/** The goal-side spot that keeps an attacker covered. */
export function insidePoint(attacker: Vec2, goal: Goal, distance: number): Vec2 {
  const towards = dir(attacker, { x: goal.x, y: goal.y });
  return { x: attacker.x + towards.x * distance, y: attacker.y + towards.y * distance };
}

/** Near post, centre or far post at the 2.5 m mark, whichever is open. */
export function driveDestination(driver: Swimmer, goal: Goal, others: readonly Swimmer[], t: DriveTuning): Vec2 {
  const lateral = toGoal(goal, driver.pos).lateral;
  const side = lateral >= 0 ? 1 : -1;
  const options: [number, number][] = [
    [side * t.ladoPalo, 0],
    [0, 0.35],
    [-side * t.ladoPalo, 0.6],
  ];
  let best = fromGoal(goal, t.distanciaDestino, options[0]?.[0] ?? 0);
  let bestCost = Infinity;
  for (const [offset, preference] of options) {
    const point = fromGoal(goal, t.distanciaDestino, offset);
    let cost = preference + dist(driver.pos, point) * 0.05;
    for (const other of others) if (other !== driver && dist(other.pos, point) < 1.3) cost += 1;
    if (cost < bestCost) {
      bestCost = cost;
      best = point;
    }
  }
  return best;
}

/** Attacker (Habilidad, Velocidad) against defender (Defensa, Velocidad): seconds of delay. */
export function rollReaction(driver: Swimmer, defender: Swimmer, weakSide: boolean, rng: Rng, t: DriveTuning): number {
  const a = driver.player.stats;
  const d = defender.player.stats;
  const attack = 0.45 * barFactor(a.skill) + 0.45 * barFactor(a.speed) + 0.1;
  const defence = 0.6 * barFactor(d.defense) + 0.3 * barFactor(d.speed) + 0.1;
  const k = sigmoid(t.pendiente * (attack - defence) + rng.gauss() * t.ruido);
  let reaction = lerp(t.reaccion.min, t.reaccion.max, k) + (weakSide ? t.atencionLadoDebil : 0);
  // Nothing is guaranteed: the best drive is sometimes read, the worst sometimes catches a defender napping.
  const roll = rng.next();
  if (roll < t.lectura) reaction = 0;
  else if (roll > 1 - t.despiste) reaction += t.despisteSegundos;
  return clamp(reaction, 0, t.reaccion.max + t.atencionLadoDebil + t.despisteSegundos);
}

export function startDrive(
  driver: Swimmer,
  defender: Swimmer | null,
  goal: Goal,
  others: readonly Swimmer[],
  ball: Vec2,
  now: number,
  rng: Rng,
  t: DriveTuning,
): Drive {
  const destination = driveDestination(driver, goal, others, t);
  // Away from the ball the defender is watching the ball, not the man.
  const weakSide = Math.sign(toGoal(goal, driver.pos).lateral) !== Math.sign(toGoal(goal, ball).lateral);
  return {
    driver,
    defender,
    from: { ...driver.pos },
    destination,
    startedAt: now,
    reaction: defender ? rollReaction(driver, defender, weakSide, rng, t) : 0,
    phase: 'start',
    freeUntil: 0,
    defenderHome: defender ? { ...defender.pos } : { ...driver.pos },
  };
}

/** One step of a drive: sets the targets of driver and defender, and reports what changed. */
export function stepDrive(drive: Drive, goal: Goal, now: number, t: DriveTuning, insideDistance: number): DriveStep {
  const { driver, defender } = drive;
  const elapsed = now - drive.startedAt;
  if (drive.phase === 'start') {
    driver.target = { ...drive.from };
    driver.speedScale = 0.6;
    if (elapsed >= t.arranque) {
      drive.phase = 'run';
      // The explosive first stroke of a drive (eggbeater lunge).
      const towards = dir(driver.pos, drive.destination);
      driver.vel = { x: driver.vel.x + towards.x * t.impulso, y: driver.vel.y + towards.y * t.impulso };
    }
  } else {
    driver.target = { ...drive.destination };
    driver.speedScale = drive.phase === 'free' ? 0.6 : t.velocidad;
    // Looking for inside water: swim round a defender who stands in the way, not into him.
    if (defender && drive.phase === 'run') {
      const towards = dir(driver.pos, drive.destination);
      const toDefender = { x: defender.pos.x - driver.pos.x, y: defender.pos.y - driver.pos.y };
      const gap = Math.hypot(toDefender.x, toDefender.y);
      if (gap < t.rodear.distancia && toDefender.x * towards.x + toDefender.y * towards.y > 0) {
        const across = { x: -towards.y, y: towards.x };
        const side = across.x * toDefender.x + across.y * toDefender.y > 0 ? -1 : 1;
        driver.target = {
          x: defender.pos.x + across.x * side * t.rodear.lado + towards.x * t.rodear.avance,
          y: defender.pos.y + across.y * side * t.rodear.lado + towards.y * t.rodear.avance,
        };
      }
    }
  }
  driver.desiredFacing = Math.atan2(drive.destination.y - driver.pos.y, drive.destination.x - driver.pos.x);

  let advantage = Infinity;
  if (defender) {
    if (elapsed < drive.reaction) {
      // Caught watching the ball: stays where they are.
      defender.target = { ...defender.pos };
      defender.speedScale = 0.3;
    } else {
      const ahead = { x: driver.pos.x + driver.vel.x * 0.2, y: driver.pos.y + driver.vel.y * 0.2 };
      defender.target = insidePoint(ahead, goal, insideDistance);
      defender.speedScale = t.velocidad;
    }
    defender.desiredFacing = Math.atan2(driver.pos.y - defender.pos.y, driver.pos.x - defender.pos.x);
    advantage = dist(defender.pos, insidePoint(driver.pos, goal, insideDistance));
  }

  const total = Math.max(0.1, dist(drive.from, drive.destination));
  const progress = 1 - dist(driver.pos, drive.destination) / total;
  if (drive.phase === 'run') {
    if (progress >= t.progresoMinimo && advantage >= t.ventajaLibre) {
      drive.phase = 'free';
      drive.freeUntil = now + lerp(t.ventanaLibre.min, t.ventanaLibre.max, barFactor(driver.player.stats.skill));
      return 'free';
    }
    if (dist(driver.pos, drive.destination) < 0.35 || elapsed > t.duracionMax) {
      const dragged = defender !== null && dist(defender.pos, drive.defenderHome) > t.arrastre;
      return dragged ? 'end-drag' : 'end-fail';
    }
    return null;
  }
  if (drive.phase === 'free') {
    if (now >= drive.freeUntil || advantage < t.cierraVentaja || elapsed > t.duracionMax + 1.5) return 'end-free';
  }
  return null;
}
