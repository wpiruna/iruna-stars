/**
 * Energy (GDD §11.2): a 0–1 bar per player. Swimming hard, bursts, drives, wrestling, shooting
 * and contact use it up; treading water gives a little back, the bench a lot. Resistencia sets
 * how fast it goes and comes back. Below half the bar he swims slower (down to −35 % when empty),
 * shoots softer and wilder and keeps the ball worse.
 */
import { barFactor, clamp, lerp } from '../../core/math';
import type { Swimmer } from '../attack/types';
import type { MatchTuning } from './types';

export type EnergyTuning = MatchTuning['energia'];

/** What a swimmer is doing this step besides swimming (each one costs per second). */
export interface Exertion {
  burst: boolean;
  drive: boolean;
  wrestle: boolean;
  shoot: boolean;
  contact: boolean;
}

/** How much faster than the average (1) this player tires: Resistencia, and the Diésel trait. */
export function drainFactor(s: Swimmer, t: EnergyTuning): number {
  const f = lerp(t.resistencia.gasto.max, t.resistencia.gasto.min, barFactor(s.player.stats.stamina));
  return s.player.trait === 'diesel' ? f * t.diesel : f;
}

/** How much faster than the average (1) this player gets his breath back. */
export function recoveryFactor(s: Swimmer, t: EnergyTuning): number {
  return lerp(t.resistencia.recuperacion.min, t.resistencia.recuperacion.max, barFactor(s.player.stats.stamina));
}

/** Effort of swimming at this speed: 0 treading water or swimming easy, 1 flat out (more with a break's pace). */
export function swimEffort(s: Swimmer, t: EnergyTuning): number {
  const ratio = Math.hypot(s.vel.x, s.vel.y) / Math.max(0.1, s.topSpeed);
  return clamp((ratio - t.esfuerzo.desde) / (1 - t.esfuerzo.desde), 0, t.esfuerzo.max);
}

/** One step in the water: spend what he does, or get a little back while he rests. */
export function stepEnergy(s: Swimmer, exertion: Exertion, dt: number, t: EnergyTuning): void {
  const effort = swimEffort(s, t);
  const g = t.gasto;
  let cost = g.nado * effort ** g.curva;
  if (exertion.burst) cost += g.aceleron;
  if (exertion.drive) cost += g.entrada;
  if (exertion.wrestle) cost += g.lucha;
  if (exertion.shoot) cost += g.tiro;
  if (exertion.contact) cost += g.contacto;
  if (cost > 0) s.energy = Math.max(0, s.energy - cost * drainFactor(s, t) * dt);
  else s.energy = Math.min(1, s.energy + t.recuperacion.agua * recoveryFactor(s, t) * dt);
}

/** Resting out of the water (the bench) or a pause in the match (`amount` per second, or at once). */
export function rest(s: Swimmer, amount: number, t: EnergyTuning): void {
  s.energy = Math.min(1, s.energy + amount * recoveryFactor(s, t));
}

/** 0 with half the bar or more, 1 with it empty. */
export function tiredness(energy: number, t: EnergyTuning): number {
  return clamp((t.umbral - energy) / t.umbral, 0, 1);
}

/** Multiplier on the top speed. */
export function speedFactor(energy: number, t: EnergyTuning): number {
  return 1 - t.efecto.velocidad * tiredness(energy, t);
}

/** A bar (1–10) as a tired player plays it. */
export function tiredBar(bar: number, energy: number, drop: number, t: EnergyTuning): number {
  return Math.max(1, bar - drop * tiredness(energy, t));
}
