/** Small 2D vector helpers for the attack simulation (plain objects, no classes). */
import type { Vec2 } from '../field';

export const v2 = (x = 0, y = 0): Vec2 => ({ x, y });
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const len = (a: Vec2): number => Math.hypot(a.x, a.y);
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;

/** Unit vector from a to b (zero vector when they coincide). */
export function dir(a: Vec2, b: Vec2): Vec2 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  return d > 1e-9 ? { x: dx / d, y: dy / d } : { x: 0, y: 0 };
}

export function norm(a: Vec2): Vec2 {
  const d = Math.hypot(a.x, a.y);
  return d > 1e-9 ? { x: a.x / d, y: a.y / d } : { x: 0, y: 0 };
}

export const add = (a: Vec2, b: Vec2, k = 1): Vec2 => ({ x: a.x + b.x * k, y: a.y + b.y * k });
export const lerp2 = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** Angle between two directions, in degrees (0–180). */
export function angleBetween(a: Vec2, b: Vec2): number {
  const la = len(a);
  const lb = len(b);
  if (la < 1e-9 || lb < 1e-9) return 180;
  const c = Math.max(-1, Math.min(1, dot(a, b) / (la * lb)));
  return (Math.acos(c) * 180) / Math.PI;
}

/** Distance from p to the segment a–b and the fraction (0–1) of the closest point along it. */
export function toSegment(p: Vec2, a: Vec2, b: Vec2): { distance: number; t: number } {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const l2 = abx * abx + aby * aby;
  const t = l2 > 1e-9 ? Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2)) : 0;
  return { distance: Math.hypot(a.x + abx * t - p.x, a.y + aby * t - p.y), t };
}

export const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));
