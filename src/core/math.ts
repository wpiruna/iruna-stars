export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Turns a 1–10 bar into a smooth 0–1 factor (GDD §11.1): an S-curve, so the gap between a 5 and
 * a 9 is obvious on screen while no value guarantees or forbids anything.
 */
export function barFactor(bar: number): number {
  const t = clamp((bar - 1) / 9, 0, 1);
  return t * t * (3 - 2 * t);
}
