/**
 * Pad gesture recogniser (GDD §5.2): turns the raw pad vector into "tap" (choose) and "hold"
 * (swim / preview). Device-agnostic: a keyboard tap, a stick flick and a thumb flick on the
 * floating touch pad all arrive here as the same thing.
 */

export type Dir8 = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
/** Unit vectors of the eight directions, clockwise from "right". Screen axes: +y is down. */
export const DIR_VECTORS: readonly { x: number; y: number }[] = Array.from({ length: 8 }, (_, i) => ({
  x: Math.cos((i * Math.PI) / 4),
  y: Math.sin((i * Math.PI) / 4),
}));

/**
 * Snaps a vector to eight directions. `previous` adds hysteresis: the current direction is kept
 * until the stick is clearly inside another sector, so diagonals do not flicker.
 */
export function quantize8(x: number, y: number, previous: Dir8 | null = null, hysteresis = (10 * Math.PI) / 180): Dir8 {
  const angle = Math.atan2(y, x);
  if (previous !== null) {
    let delta = angle - (previous * Math.PI) / 4;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    if (Math.abs(delta) <= Math.PI / 8 + hysteresis) return previous;
  }
  return ((Math.round(angle / (Math.PI / 4)) + 8) % 8) as Dir8;
}

export type PadGesture =
  | { type: 'tap'; dir: Dir8; x: number; y: number }
  | { type: 'holdStart'; dir: Dir8 }
  | { type: 'hold'; dir: Dir8; x: number; y: number }
  | { type: 'holdEnd'; dir: Dir8 };

export class PadGestures {
  private active = false;
  private heldMs = 0;
  private holding = false;
  private dir: Dir8 | null = null;
  /** The furthest the pad got during the gesture: a flick is read there, not where it ends. */
  private peakX = 0;
  private peakY = 0;
  private peak = 0;
  /** Keys pressed within this window of each other count as one diagonal. */
  private static readonly CHORD_MS = 60;

  constructor(
    /** Longest press that still counts as a tap, in milliseconds. */
    public tapMs: number,
    /** Pad deflection (0–1) below which the pad is considered at rest. */
    public deadZone: number,
  ) {}

  /** Call once per simulation step with the current pad vector. */
  update(x: number, y: number, dtMs: number, out: PadGesture[] = []): PadGesture[] {
    const magnitude = Math.hypot(x, y);
    if (magnitude > this.deadZone) {
      if (!this.active) {
        this.active = true;
        this.heldMs = 0;
        this.holding = false;
        this.dir = null;
        this.peak = 0;
      }
      this.heldMs += dtMs;
      this.dir = quantize8(x, y, this.dir);
      // While the gesture is young the peak may still grow or rotate (second key of a diagonal).
      if (magnitude >= this.peak - 1e-6 || this.heldMs <= PadGestures.CHORD_MS) {
        if (magnitude >= this.peak - 1e-6) this.peak = magnitude;
        this.peakX = x;
        this.peakY = y;
      }
      if (!this.holding && this.heldMs > this.tapMs) {
        this.holding = true;
        out.push({ type: 'holdStart', dir: this.dir });
      }
      if (this.holding) out.push({ type: 'hold', dir: this.dir, x, y });
    } else if (this.active) {
      this.active = false;
      if (this.holding) out.push({ type: 'holdEnd', dir: this.dir ?? 0 });
      else out.push({ type: 'tap', dir: quantize8(this.peakX, this.peakY), x: this.peakX, y: this.peakY });
      this.holding = false;
    }
    return out;
  }

  /**
   * Drops the gesture in progress without emitting anything. Used when the game state changes
   * under the player's thumb, so a hold that began as "swim" never ends as an accidental pass.
   */
  cancel(): void {
    this.active = false;
    this.holding = false;
  }

  get isHolding(): boolean {
    return this.holding;
  }
}
