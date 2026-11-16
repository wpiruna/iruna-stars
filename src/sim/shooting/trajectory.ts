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

/** How deep a ball sits in the net (the drawn net is 0.85 m deep). */
export const NET_BACK = 0.78;
/** Beyond this, behind the goal line, the ball stops against the wall of the pool. */
export const POOL_WALL = 2.2;

/**
 * Speed of a ball just after it has gone in. Through the middle it carries on; off the inside of
 * a post it is turned towards the middle of the goal, so it never leaves sideways.
 */
export function goalVelocity(plan: ShotPlan, goal: Goal, ux: number, uy: number, viaPost: boolean): Vec3 {
  const speed = plan.arrivalSpeed;
  let y = uy * speed * 0.45;
  if (viaPost) y = -Math.sign(plan.arrival.u || 1) * Math.abs(y) * 0.5;
  return { x: ux * speed * 0.45, y, z: plan.mode === 'lob' ? -3 : 0.5 };
}

/**
 * A ball that has gone in stays in the goal: the side netting, the roof and the back of the net
 * stop it. Call it every step while the ball is free after a goal. Returns true when the ball
 * touches the netting (for the ripple on the net and the sound).
 */
export function keepInNet(b: Vec3, v: Vec3, goal: Goal): boolean {
  const behind = (b.x - goal.x) * goal.facing;
  if (behind <= 0) return false;
  let touched = false;
  const side = goal.halfWidth - 0.15;
  const lateral = b.y - goal.y;
  if (Math.abs(lateral) > side) {
    b.y = goal.y + Math.sign(lateral) * side;
    v.y *= -0.15;
    v.x *= 0.6;
    touched = true;
  }
  const roof = goal.height - 0.12;
  if (b.z > roof) {
    b.z = roof;
    if (v.z > 0) v.z *= -0.2;
  }
  if (behind > NET_BACK) {
    b.x = goal.x + goal.facing * NET_BACK;
    v.x = 0;
    v.y *= 0.3;
    touched = true;
  }
  return touched;
}
