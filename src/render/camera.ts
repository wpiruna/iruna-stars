/**
 * Camera: world metres → logical screen pixels.
 * The pool is seen from above with a slight tilt: y is squashed, and height above the water
 * lifts things up the screen (and a little towards the viewer) so a lob, a skip shot and the
 * goal frame read as different heights.
 */
import { clamp } from '../core/math';
import type { Rng } from '../core/rng';

export const TILT = 0.82;
/** Screen lift per metre of height, as a fraction of a metre on screen. */
export const HEIGHT_LIFT = 0.78;
/**
 * Perspective: things with height lean away from the middle of the pool, as seen by a camera
 * hanging above it. Metres of sideways shift per metre of height and per metre from the centre.
 * It is what opens the goal mouths towards the viewer at both ends.
 */
export const PERSPECTIVE = 0.036;

export interface Framing {
  /** World point at the centre of the screen. */
  x: number;
  y: number;
  /** Logical pixels per metre. */
  ppm: number;
}

export class Camera {
  x = 12.5;
  y = 10;
  ppm = 55;
  /** Logical viewport. */
  width = 1280;
  height = 720;
  private target: Framing = { x: 12.5, y: 10, ppm: 55 };
  private shakeAmount = 0;
  private shakeX = 0;
  private shakeY = 0;
  private punch = 0;

  constructor(
    private readonly rng: Rng,
    /** World x the perspective leans away from: the middle of the pool. */
    readonly focusX: number,
  ) {}

  setViewport(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  /** Where the camera should settle. `snap` skips the glide. */
  frame(target: Framing, snap = false): void {
    this.target = target;
    if (snap) {
      this.x = target.x;
      this.y = target.y;
      this.ppm = target.ppm;
    }
  }

  /** Framing that shows a world rectangle (with heights ignored) inside the viewport. */
  fit(minX: number, maxX: number, minY: number, maxY: number, maxPpm = 130): Framing {
    const ppm = Math.min(this.width / (maxX - minX), this.height / ((maxY - minY) * TILT), maxPpm);
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, ppm };
  }

  shake(amount: number): void {
    this.shakeAmount = Math.max(this.shakeAmount, amount);
  }

  /** A quick zoom-in that relaxes on its own (shot release, goal). */
  zoomPunch(amount: number): void {
    this.punch = Math.max(this.punch, amount);
  }

  update(dt: number): void {
    const k = 1 - Math.exp(-dt * 5);
    this.x += (this.target.x - this.x) * k;
    this.y += (this.target.y - this.y) * k;
    this.ppm += (this.target.ppm - this.ppm) * k;
    this.punch *= Math.exp(-dt * 6);
    if (this.shakeAmount > 0.01) {
      this.shakeX = this.rng.range(-1, 1) * this.shakeAmount;
      this.shakeY = this.rng.range(-1, 1) * this.shakeAmount;
      this.shakeAmount *= Math.exp(-dt * 9);
    } else {
      this.shakeAmount = this.shakeX = this.shakeY = 0;
    }
  }

  /** Effective pixels per metre, including the zoom punch. */
  get scale(): number {
    return this.ppm * (1 + this.punch);
  }

  get offsetX(): number {
    return this.width / 2 - this.x * this.scale + this.shakeX;
  }

  get offsetY(): number {
    return this.height / 2 - this.y * this.scale * TILT + this.shakeY;
  }

  projectX(x: number, z = 0): number {
    return (x + (x - this.focusX) * PERSPECTIVE * z) * this.scale + this.offsetX;
  }

  projectY(y: number, z = 0): number {
    return (y * TILT - z * HEIGHT_LIFT) * this.scale + this.offsetY;
  }

  /** Size multiplier for sprites: players are drawn larger than life, more so when zoomed out. */
  get actorScale(): number {
    return clamp(Math.sqrt(this.scale / 55), 0.85, 1.6);
  }
}
