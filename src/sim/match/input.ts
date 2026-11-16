/**
 * The control grammar across the whole match (GDD §5.2–5.3). One pad and two buttons mean
 * different things depending on the moment, and a gesture belongs to the moment it started in:
 * when the context changes the pad has to come back to rest before it counts again.
 */
import { PadGestures } from '../../input/gestures';
import { AttackInput, type AttackIntent, type PadState } from '../attack/control';
import type { AttackTuning } from '../attack/types';

/**
 * - attack: our player has the ball in a set attack (F2 grammar).
 * - carry: our player has the ball on the break: hold to swim with it, tap to pass.
 * - keeper: our keeper has the ball: tap to pass.
 * - defend: they have the ball (or it is loose): tap to switch defender, hold to swim.
 * - sprint: swim-off, mash HABILIDAD.
 */
export type ControlContext = 'none' | 'sprint' | 'attack' | 'carry' | 'keeper' | 'defend';

export type MatchIntent =
  | AttackIntent
  | { type: 'swim'; x: number; y: number }
  | { type: 'swimStop' }
  | { type: 'tap'; x: number; y: number }
  | { type: 'skillTap' }
  | { type: 'skillPress' }
  | { type: 'contactStart' }
  | { type: 'contactEnd' };

export class MatchInput {
  private readonly attack: AttackInput;
  private readonly gestures: PadGestures;
  private context: ControlContext = 'none';
  private latched = false;
  private shotPrev = false;
  private skillPrev = false;
  private skillDownAt = 0;
  private skillMoved = false;
  private swimming = false;
  private now = 0;

  constructor(
    private readonly t: AttackTuning['control'],
    tapMs: number,
  ) {
    this.attack = new AttackInput(t);
    this.gestures = new PadGestures(tapMs, t.zonaMuerta);
  }

  set tapMs(ms: number) {
    this.gestures.tapMs = ms;
  }

  get current(): ControlContext {
    return this.context;
  }

  update(pad: PadState, context: ControlContext, dtMs: number): MatchIntent[] {
    this.now += dtMs;
    const out: MatchIntent[] = [];
    const magnitude = Math.hypot(pad.x, pad.y);
    const active = magnitude > this.t.zonaMuerta;

    if (context !== this.context) {
      if (this.swimming) out.push({ type: 'swimStop' });
      this.swimming = false;
      this.attack.reset(pad.shot, pad.skill);
      this.gestures.cancel();
      this.latched = active;
      this.context = context;
      this.skillMoved = true;
    }

    const shotDown = pad.shot && !this.shotPrev;
    const shotUp = !pad.shot && this.shotPrev;
    const skillDown = pad.skill && !this.skillPrev;
    const skillUp = !pad.skill && this.skillPrev;
    this.shotPrev = pad.shot;
    this.skillPrev = pad.skill;

    switch (context) {
      case 'none':
        break;
      case 'attack':
        out.push(...this.attack.update(pad, dtMs));
        break;
      case 'sprint':
        if (skillDown) out.push({ type: 'skillPress' });
        break;
      case 'carry':
        if (shotDown) out.push({ type: 'shotStart' });
        if (shotUp) out.push({ type: 'shotRelease' });
        if (skillDown) {
          this.skillDownAt = this.now;
          this.skillMoved = active;
        }
        if (pad.skill && active) this.skillMoved = true;
        if (skillUp && !this.skillMoved && this.now - this.skillDownAt <= this.t.toqueHabilidadMs) out.push({ type: 'skillTap' });
        // While TIRO is held the pad aims the shot: no swimming, no passing.
        if (pad.shot || shotUp) {
          this.stopSwimming(out);
          this.gestures.cancel();
          if (active) this.latched = true;
          break;
        }
        this.readPad(pad, active, dtMs, out, true);
        break;
      case 'keeper':
        this.readPad(pad, active, dtMs, out, false);
        break;
      case 'defend':
        if (skillDown) out.push({ type: 'skillTap' });
        if (shotDown) out.push({ type: 'contactStart' });
        if (shotUp) out.push({ type: 'contactEnd' });
        this.readPad(pad, active, dtMs, out, true);
        break;
    }
    return out;
  }

  private stopSwimming(out: MatchIntent[]): void {
    if (!this.swimming) return;
    this.swimming = false;
    out.push({ type: 'swimStop' });
  }

  /** Swims from the very first frame; a short flick ends up as a tap. */
  private readPad(pad: PadState, active: boolean, dtMs: number, out: MatchIntent[], swim: boolean): void {
    if (this.latched) {
      if (!active) this.latched = false;
      return;
    }
    for (const g of this.gestures.update(pad.x, pad.y, dtMs)) {
      if (g.type === 'tap') out.push({ type: 'tap', x: g.x, y: g.y });
    }
    if (!swim) return;
    if (active) {
      this.swimming = true;
      out.push({ type: 'swim', x: pad.x, y: pad.y });
    } else {
      this.stopSwimming(out);
    }
  }
}
