/**
 * The defending goalkeeper during an attack (GDD §10): slides along the line following the
 * ball, a little behind the ideal spot (Colocación), and dives when a shot is decided.
 */
import { barFactor, clamp, lerp } from '../../core/math';
import type { Rng } from '../../core/rng';
import type { Goal, Vec2 } from '../field';
import { keeperIdealU, type KeeperProfile, type KeeperTuning } from '../shooting/model';
import type { AttackTuning, Swimmer } from './types';

export class KeeperBody {
  /** Lateral position on the goal line (goal-plane `u`). */
  u = 0;
  prevU = 0;
  /** 0 = set, 1 = fully stretched. */
  stretch = 0;
  hands = 0.35;
  holding = false;
  private error = 0;
  private diving = false;
  private diveFrom = 0;
  private diveTo = 0;
  private diveStart = 0;
  private diveDuration = 0;

  constructor(
    readonly swimmer: Swimmer,
    readonly goal: Goal,
    readonly profile: KeeperProfile,
    private readonly keeperTuning: KeeperTuning,
    private readonly tuning: AttackTuning['portero'],
  ) {
    this.place();
  }

  get position(): Vec2 {
    return { x: this.goal.x - this.goal.facing * 0.35, y: this.goal.y + this.u };
  }

  /** A new positioning error each time the ball changes hands: nobody stands perfectly. */
  reroll(rng: Rng): void {
    const spread = lerp(this.keeperTuning.errorColocacion.max, this.keeperTuning.errorColocacion.min, barFactor(this.profile.positioning));
    this.error = rng.gauss() * spread * 0.6;
  }

  reset(): void {
    this.u = this.prevU = 0;
    this.stretch = 0;
    this.holding = false;
    this.diving = false;
    this.error = 0;
    this.place();
  }

  dive(targetU: number, duration: number, now: number): void {
    const limit = this.goal.halfWidth + 0.2;
    this.diving = true;
    this.diveFrom = this.u;
    this.diveTo = clamp(targetU, -limit, limit);
    this.diveStart = now;
    this.diveDuration = Math.max(0.05, duration);
  }

  /** One step. `ball` is where the ball is now, or null while the keeper has it. */
  step(ball: Vec2 | null, now: number, dt: number): void {
    this.prevU = this.u;
    if (this.diving) {
      const k = clamp((now - this.diveStart) / this.diveDuration, 0, 1);
      const eased = 1 - (1 - k) * (1 - k);
      this.u = this.diveFrom + (this.diveTo - this.diveFrom) * eased;
      this.stretch = Math.max(this.stretch, clamp(Math.abs(this.diveTo - this.diveFrom) / 1.2, 0, 1) * eased);
      if (k >= 1 && now - this.diveStart > this.diveDuration + 0.6) this.diving = false;
    } else {
      this.stretch = Math.max(0, this.stretch - dt * 2);
      if (ball) {
        const target = keeperIdealU(ball, this.goal) + this.error;
        const speed = lerp(this.tuning.velocidadLateral.min, this.tuning.velocidadLateral.max, barFactor(this.profile.positioning));
        const step = clamp(target - this.u, -speed * dt, speed * dt);
        this.u += step;
      }
    }
    this.place();
  }

  private place(): void {
    const p = this.position;
    this.swimmer.prev.x = this.swimmer.pos.x;
    this.swimmer.prev.y = this.swimmer.pos.y;
    this.swimmer.pos.x = p.x;
    this.swimmer.pos.y = p.y;
  }
}
