/** Ball path from the hand to the goal plane for each kind of shot. */
import { lerp } from '../../core/math';
import type { Goal, Vec3 } from '../field';
import type { ShotPlan, ShotTuning } from './model';

/**
 * Position of the ball at fraction `s` (0–1) of its flight time.
 * Direct: almost flat. Skip: down to the water, then up off the bounce. Lob: high arc.
 */
export function ballAt(plan: ShotPlan, goal: Goal, s: number, t: ShotTuning, out: Vec3): Vec3 {
  const endY = goal.y + plan.arrival.u;
  const z0 = plan.releaseHeight;
  const z1 = plan.arrival.v;
  let k = s;
  let z: number;

  if (plan.mode === 'skip' && plan.bounceAt !== undefined && plan.bounce) {
    const kBounce = Math.abs(plan.bounce.x - plan.from.x) / Math.max(1e-6, Math.abs(goal.x - plan.from.x));
    if (s < plan.bounceAt) {
      const w = s / plan.bounceAt;
      k = kBounce * w;
      z = z0 * (1 - w);
    } else {
      const w = (s - plan.bounceAt) / (1 - plan.bounceAt);
      k = kBounce + (1 - kBounce) * w;
      z = z1 * w + 0.12 * 4 * w * (1 - w);
    }
  } else if (plan.mode === 'lob') {
    z = lerp(z0, z1, s) + (t.vaselina.alturaMaxima - Math.max(z0, z1)) * 4 * s * (1 - s);
  } else {
    const reach = Math.hypot(goal.x - plan.from.x, endY - plan.from.y);
    z = lerp(z0, z1, s) + 0.035 * reach * 4 * s * (1 - s);
  }

  out.x = lerp(plan.from.x, goal.x, k);
  out.y = lerp(plan.from.y, endY, k);
  out.z = Math.max(0, z);
  return out;
}
