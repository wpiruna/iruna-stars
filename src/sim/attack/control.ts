/**
 * Human input in the positional attack → intents (GDD §5.2–5.3, plan §6.1).
 * - Pad (no button): aim a pass; the preview is shown from the first frame and the pass goes on
 *   release. On touch, sliding back to the centre without lifting cancels it.
 * - HABILIDAD held + pad: choose a team-mate to drive (never passes). A short HABILIDAD tap with
 *   the pad at rest is the holder's own move (escape, or the centre's turn).
 * - TIRO: press and release (the simulation decides between quick and charged shot).
 * A gesture belongs to the moment it started: after any reset the pad must return to rest.
 */
import type { AttackTuning } from './types';

export type AttackIntent =
  | { type: 'aim'; x: number; y: number }
  | { type: 'aimClear' }
  | { type: 'pass'; x: number; y: number }
  | { type: 'select'; x: number; y: number }
  | { type: 'selectClear' }
  | { type: 'order'; x: number; y: number }
  | { type: 'skill' }
  | { type: 'shotStart' }
  | { type: 'shotRelease' };

export interface PadState {
  /** Screen-space pad, −1…1 (+y is down). */
  x: number;
  y: number;
  /** A finger is on the touch pad (even if it rests in the dead zone). False for keys and sticks. */
  touching: boolean;
  shot: boolean;
  skill: boolean;
}

export class AttackInput {
  private now = 0;
  private shotPrev = false;
  private skillPrev = false;
  private skillDownAt = 0;
  private skillMoved = false;
  private selecting = false;
  private selectDir = { x: 0, y: 0 };
  private aiming = false;
  private aimDir = { x: 0, y: 0 };
  private prevAimDir = { x: 0, y: 0 };
  private aimChangedAt = 0;
  private peak = 0;
  private deadSince = -1;
  private latched = false;
  private noPassUntil = 0;

  constructor(private readonly t: AttackTuning['control']) {}

  /**
   * Drops any gesture in progress silently; the pad has to come back to rest before it counts.
   * Passing the current buttons avoids reading a button that is already held as a new press.
   */
  reset(shot?: boolean, skill?: boolean): void {
    this.aiming = false;
    this.selecting = false;
    this.deadSince = -1;
    this.latched = true;
    if (shot !== undefined) this.shotPrev = shot;
    if (skill !== undefined) {
      this.skillPrev = skill;
      this.skillMoved = true;
    }
  }

  get isAiming(): boolean {
    return this.aiming;
  }

  update(input: PadState, dtMs: number): AttackIntent[] {
    this.now += dtMs;
    const out: AttackIntent[] = [];
    const now = this.now;
    const magnitude = Math.hypot(input.x, input.y);
    const active = magnitude > this.t.zonaMuerta;
    const shotDown = input.shot && !this.shotPrev;
    const shotUp = !input.shot && this.shotPrev;
    const skillDown = input.skill && !this.skillPrev;
    const skillUp = !input.skill && this.skillPrev;
    this.shotPrev = input.shot;
    this.skillPrev = input.skill;

    // --- TIRO: while it is held the pad aims the shot, so no pass or drive can start ----------
    if (shotDown) {
      this.clearAim(out);
      this.clearSelect(out);
      out.push({ type: 'shotStart' });
    }
    if (shotUp) out.push({ type: 'shotRelease' });
    if (input.shot || shotUp) {
      if (active) this.latched = true;
      return out;
    }

    // --- HABILIDAD ------------------------------------------------------------------------
    if (skillDown) {
      this.skillDownAt = now;
      this.skillMoved = active;
      // Aiming a pass and then pressing HABILIDAD turns that direction into a drive order.
      this.clearAim(out);
      this.latched = false;
    }
    if (input.skill) {
      if (active && !this.latched) {
        this.skillMoved = true;
        this.selecting = true;
        this.selectDir = { x: input.x / magnitude, y: input.y / magnitude };
        out.push({ type: 'select', ...this.selectDir });
      } else if (!active) {
        this.latched = false;
        if (this.selecting) {
          this.selecting = false;
          out.push({ type: 'selectClear' }, { type: 'order', ...this.selectDir });
        }
      }
      return out;
    }
    if (skillUp) {
      if (this.selecting) {
        this.selecting = false;
        out.push({ type: 'selectClear' }, { type: 'order', ...this.selectDir });
      } else if (!this.skillMoved && now - this.skillDownAt <= this.t.toqueHabilidadMs) {
        out.push({ type: 'skill' });
      }
      this.noPassUntil = now + this.t.sinPaseTrasHabilidadMs;
      if (active) this.latched = true;
      return out;
    }

    // --- Pass ------------------------------------------------------------------------------
    if (this.latched) {
      if (!active) this.latched = false;
      return out;
    }
    if (active) {
      if (!this.aiming) {
        if (now < this.noPassUntil) {
          this.latched = true;
          return out;
        }
        this.aiming = true;
        this.peak = 0;
        this.aimDir = { x: input.x / magnitude, y: input.y / magnitude };
        this.prevAimDir = this.aimDir;
        this.aimChangedAt = -Infinity;
      }
      this.deadSince = -1;
      // A thumb curling back towards the centre before lifting must not change the aim.
      if (magnitude >= Math.max(0.45, this.peak * 0.7)) {
        this.peak = Math.max(this.peak, magnitude);
        const next = { x: input.x / magnitude, y: input.y / magnitude };
        if (next.x * this.aimDir.x + next.y * this.aimDir.y < Math.cos((10 * Math.PI) / 180)) {
          this.prevAimDir = this.aimDir;
          this.aimChangedAt = now;
        }
        this.aimDir = next;
      }
      out.push({ type: 'aim', ...this.aimDir });
      return out;
    }
    if (this.aiming) {
      if (input.touching) {
        // Finger back in the centre without lifting: after a moment, that cancels the pass.
        if (this.deadSince < 0) this.deadSince = now;
        else if (now - this.deadSince >= this.t.cancelarTactilMs) this.clearAim(out);
        return out;
      }
      // Two keys of a diagonal never come up at the same instant: keep the diagonal.
      const aim = now - this.aimChangedAt < this.t.acordeMs ? this.prevAimDir : this.aimDir;
      this.aiming = false;
      out.push({ type: 'pass', ...aim });
    }
    return out;
  }

  private clearAim(out: AttackIntent[]): void {
    if (!this.aiming) return;
    this.aiming = false;
    this.deadSince = -1;
    out.push({ type: 'aimClear' });
  }

  private clearSelect(out: AttackIntent[]): void {
    if (!this.selecting) return;
    this.selecting = false;
    out.push({ type: 'selectClear' });
  }
}
