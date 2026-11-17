/** What the sessions tell the background sound (water and crowd) about the play. */
import type { Swimmer } from '../sim/attack/types';

/** Sprint pace (m/s): a pool where everybody swims like this is the loudest water. */
const SPRINT = 1.9;

/**
 * How hard the swimmers are swimming, 0–1: the water in the background follows it (Julián: loud
 * with many swimming fast, quieter once the positions settle). It is the mean of the squared
 * speeds, like the splashing. Measured with `npm run sim`: a counter-attack fills it (≈ 1), the
 * sprint ≈ 0.7, the arc still forming 0.3–0.8 and a set attack treading water < 0.15.
 */
export function swimActivity(swimmers: readonly Swimmer[]): number {
  if (swimmers.length === 0) return 0;
  let sum = 0;
  for (const s of swimmers) sum += s.vel.x * s.vel.x + s.vel.y * s.vel.y;
  return Math.min(1, sum / swimmers.length / (SPRINT * SPRINT));
}
