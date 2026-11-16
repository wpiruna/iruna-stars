/** What the sessions tell the background sound (water and crowd) about the play. */
import type { Swimmer } from '../sim/attack/types';

/** How hard the swimmers are swimming, 0–1: the water in the background follows it. */
export function swimActivity(swimmers: readonly Swimmer[]): number {
  if (swimmers.length === 0) return 0;
  let sum = 0;
  for (const s of swimmers) sum += Math.hypot(s.vel.x, s.vel.y);
  return Math.min(1, sum / swimmers.length / 1.7);
}
