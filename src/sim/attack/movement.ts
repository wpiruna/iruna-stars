/**
 * Swimming: each swimmer heads for its target with water inertia (limited acceleration), keeps
 * some room from team-mates and cannot overlap anybody (GDD §6.3).
 */
import type { AttackTuning, Swimmer } from './types';

type SwimTuning = AttackTuning['nado'];

export function updateFacing(s: Swimmer, dt: number, t: SwimTuning): void {
  let delta = s.desiredFacing - s.facing;
  delta = Math.atan2(Math.sin(delta), Math.cos(delta));
  s.facing += delta * Math.min(1, dt * t.giro);
}

export function moveSwimmers(swimmers: readonly Swimmer[], dt: number, t: SwimTuning, length: number, width: number): void {
  for (const s of swimmers) {
    s.prev.x = s.pos.x;
    s.prev.y = s.pos.y;
    s.prevFacing = s.facing;
  }
  for (const s of swimmers) {
    if (s.keeper) continue;
    const dx = s.target.x - s.pos.x;
    const dy = s.target.y - s.pos.y;
    const d = Math.hypot(dx, dy);
    // Arrive gently instead of overshooting the spot.
    const want = Math.min(s.topSpeed * s.speedScale * s.speedPenalty, d * 2.2);
    let vx = d > 1e-4 ? (dx / d) * want : 0;
    let vy = d > 1e-4 ? (dy / d) * want : 0;
    for (const o of swimmers) {
      if (o === s || o.keeper) continue;
      const ox = s.pos.x - o.pos.x;
      const oy = s.pos.y - o.pos.y;
      const od = Math.hypot(ox, oy);
      // Team-mates keep their spacing; opponents only cannot overlap (a defender sits close).
      const range = o.team === s.team ? t.separacion : t.radio * 1.7;
      if (od < range && od > 1e-4) {
        const push = ((range - od) / range) * t.fuerzaSeparacion;
        vx += (ox / od) * push;
        vy += (oy / od) * push;
      }
    }
    const ax = vx - s.vel.x;
    const ay = vy - s.vel.y;
    const a = Math.hypot(ax, ay);
    const maxA = t.aceleracion * dt;
    const k = a > maxA ? maxA / a : 1;
    s.vel.x += ax * k;
    s.vel.y += ay * k;
    s.pos.x += s.vel.x * dt;
    s.pos.y += s.vel.y * dt;
    updateFacing(s, dt, t);
  }
  // Hard contact: two bodies never overlap.
  const minGap = t.radio * 1.5;
  for (let i = 0; i < swimmers.length; i++) {
    const a = swimmers[i] as Swimmer;
    if (a.keeper) continue;
    for (let j = i + 1; j < swimmers.length; j++) {
      const b = swimmers[j] as Swimmer;
      if (b.keeper) continue;
      const dx = b.pos.x - a.pos.x;
      const dy = b.pos.y - a.pos.y;
      const d = Math.hypot(dx, dy);
      if (d < minGap && d > 1e-6) {
        const push = (minGap - d) / 2;
        a.pos.x -= (dx / d) * push;
        a.pos.y -= (dy / d) * push;
        b.pos.x += (dx / d) * push;
        b.pos.y += (dy / d) * push;
      }
    }
    a.pos.x = Math.min(Math.max(a.pos.x, 0.3), length - 0.3);
    a.pos.y = Math.min(Math.max(a.pos.y, 0.4), width - 0.4);
  }
}
