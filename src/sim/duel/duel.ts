/**
 * One shooter against one goalkeeper: the whole life of a single shot, from the whistle to the
 * ball coming to rest. It is the core of the penalty shoot-out and of the shooting lab, and the
 * same shot code will serve full matches later.
 *
 * Pure simulation: fed with inputs each fixed step, it returns events. Humans and the AI drive
 * it through exactly the same inputs.
 */
import { STEP_MS } from '../../core/loop';
import { clamp } from '../../core/math';
import type { Rng } from '../../core/rng';
import type { Goal, Vec2, Vec3 } from '../field';
import {
  keeperPosition,
  planShot,
  resolveShot,
  type AimSide,
  type KeeperContext,
  type KeeperProfile,
  type KeeperTuning,
  type SaveEstimate,
  type ShooterProfile,
  type ShotMode,
  type ShotOutcome,
  type ShotPlan,
  type ShotTuning,
} from '../shooting/model';
import { ballAt, goalVelocity, keepInNet, POOL_WALL } from '../shooting/trajectory';

const DT = STEP_MS / 1000;
const GRAVITY = 9.8;
const PAD_THRESHOLD = 0.45;

export type DuelPhase = 'ready' | 'charging' | 'flight' | 'aftermath' | 'done';

export interface PadInput {
  /** −1 … 1, screen directions: +x right, +y down. */
  x: number;
  y: number;
}
export interface ShooterInput {
  shot: boolean;
  pad: PadInput;
}
export interface KeeperInput {
  pad: PadInput;
}

export interface PenaltyKeeperTuning {
  ventanaTrasDisparo: number;
  anticipoMaximo: number;
  calidadTardia: number;
}

export interface DuelConfig {
  goal: Goal;
  /** Where the shooter treads water. */
  position: Vec2;
  /** Throwing hand: +1 = the hand on the lower side of the screen (right-handed attacking right). */
  handSide?: 1 | -1;
  shooter: ShooterProfile;
  keeper: KeeperProfile;
  context: KeeperContext;
  /** Seconds the shooter has before the shot is forced (penalties). 0 = no limit. */
  timeLimit: number;
  /** Seconds the scene keeps running after the shot is decided. */
  aftermathSeconds: number;
  shot: ShotTuning & { alturaSuelta: { rapido: number; cargado: number }; segundosSubida: number };
  keeperTuning: KeeperTuning;
  penaltyKeeper: PenaltyKeeperTuning;
  rng: Rng;
}

export type DuelEvent =
  | { type: 'whistle' }
  | { type: 'chargeStart' }
  | { type: 'release'; plan: ShotPlan }
  | { type: 'bounce'; at: Vec2; speed: number }
  | { type: 'dive'; side: AimSide }
  | { type: 'outcome'; outcome: ShotOutcome; plan: ShotPlan; save: SaveEstimate | null }
  | { type: 'net'; at: Vec3 }
  | { type: 'frame'; at: Vec3 }
  | { type: 'splash'; at: Vec2; strength: number };

export interface Aim {
  side: AimSide;
  mode: ShotMode;
}

/** Pad direction → aim. Up/down pick the post; towards the goal skips it; away lobs it. */
export function aimFromPad(pad: PadInput, goal: Goal): Aim {
  const side: AimSide = pad.y <= -PAD_THRESHOLD ? -1 : pad.y >= PAD_THRESHOLD ? 1 : 0;
  const towards = pad.x * goal.facing;
  const mode: ShotMode = towards >= PAD_THRESHOLD ? 'skip' : towards <= -PAD_THRESHOLD ? 'lob' : 'direct';
  return { side, mode };
}

export class Duel {
  phase: DuelPhase = 'ready';
  /** Seconds since the whistle. */
  time = 0;

  // --- Shooter ---------------------------------------------------------------------------------
  /** Seconds the shot button has been held. */
  chargeTime = 0;
  /** Charge bar, 0–1. */
  charge = 0;
  aim: Aim = { side: 0, mode: 'direct' };
  /** 0 = low in the water, 1 = fully risen to shoot. */
  rise = 0;
  /** 0 → 1 during the throwing motion. */
  throwing = 0;
  /** What the shooter's body gives away, −1 … 1 (set by whoever controls the shooter). */
  tell = 0;

  // --- Shot ------------------------------------------------------------------------------------
  plan: ShotPlan | null = null;
  outcome: ShotOutcome | null = null;
  save: SaveEstimate | null = null;
  /** Seconds since the release. */
  flightTime = 0;
  /** Seconds between the release and the current moment, at the instant the shot was released. */
  releasedAt = -1;

  // --- Ball ------------------------------------------------------------------------------------
  readonly ball: Vec3 = { x: 0, y: 0, z: 0 };
  readonly prevBall: Vec3 = { x: 0, y: 0, z: 0 };
  readonly ballVelocity: Vec3 = { x: 0, y: 0, z: 0 };
  ballHolder: 'shooter' | 'keeper' | null = 'shooter';
  /** True once the ball is in the net. */
  inNet = false;

  // --- Keeper ----------------------------------------------------------------------------------
  /** Lateral position on the goal line (same axis as the goal-plane `u`). */
  keeperU = 0;
  prevKeeperU = 0;
  /** Height the keeper's hands are reaching for. */
  keeperHands = 0.35;
  /** 0 = set, 1 = fully stretched. */
  keeperStretch = 0;
  /** The side the keeper has committed to (penalties) and the duel time when it was chosen. */
  commit: { side: AimSide; time: number } | null = null;
  private keeperError: number;
  /** Where the keeper stood when the ball left: the save is judged from there, not mid-dive. */
  private keeperAtRelease = 0;
  private diveFrom = 0;
  private diveTo = 0;
  private diveStart = 0;
  private diveDuration = 0;
  private resolved = false;
  private bounced = false;
  private aftermath = 0;
  private started = false;

  constructor(readonly config: DuelConfig) {
    // The keeper's positioning error is fixed for the whole duel: they do not jitter.
    this.keeperError = config.context === 'open' ? keeperPosition(config.position, config.goal, config.keeper, config.rng, config.keeperTuning) : 0;
    this.keeperU = this.prevKeeperU = this.keeperError;
    this.placeBallInHand();
    this.prevBall.x = this.ball.x;
    this.prevBall.y = this.ball.y;
    this.prevBall.z = this.ball.z;
  }

  /** Seconds the keeper has already been committed to a side (0 when not committed). */
  get commitAge(): number {
    return this.commit ? this.time - this.commit.time : 0;
  }

  /** Seconds left before a penalty is forced; Infinity when there is no limit. */
  get timeLeft(): number {
    return this.config.timeLimit > 0 ? Math.max(0, this.config.timeLimit - this.time) : Infinity;
  }

  step(shooter: ShooterInput, keeper: KeeperInput): DuelEvent[] {
    const events: DuelEvent[] = [];
    this.prevBall.x = this.ball.x;
    this.prevBall.y = this.ball.y;
    this.prevBall.z = this.ball.z;
    this.prevKeeperU = this.keeperU;

    if (!this.started) {
      this.started = true;
      events.push({ type: 'whistle' });
    }
    if (this.phase === 'done') return events;
    this.time += DT;

    this.readKeeper(keeper, events);

    switch (this.phase) {
      case 'ready':
        this.rise = Math.max(0, this.rise - DT * 4);
        if (shooter.shot) {
          this.phase = 'charging';
          this.chargeTime = 0;
          events.push({ type: 'chargeStart' });
        } else if (this.config.timeLimit > 0 && this.time >= this.config.timeLimit) {
          // Out of time: the referee would give it away; here the shot goes off weak.
          this.release(null, events);
        }
        this.placeBallInHand();
        break;

      case 'charging': {
        const t = this.config.shot;
        this.chargeTime += DT;
        this.charge = clamp(this.chargeTime / t.segundosCarga, 0, 1);
        this.rise = clamp(this.chargeTime / t.segundosSubida, 0, 1);
        this.aim = aimFromPad(shooter.pad, this.config.goal);
        if (!shooter.shot) {
          this.release(this.chargeTime < t.segundosTiroRapido ? null : this.charge, events);
        } else if (this.chargeTime >= t.segundosMaximoCargado) {
          this.release(1, events);
        }
        if (this.phase === 'charging') this.placeBallInHand();
        break;
      }

      case 'flight':
        this.stepFlight(events);
        break;

      case 'aftermath':
        this.stepAftermath(events);
        break;
    }
    return events;
  }

  /** Reads the keeper's pad: in a penalty, the side to dive to and the moment it was chosen. */
  private readKeeper(keeper: KeeperInput, events: DuelEvent[]): void {
    if (this.config.context !== 'penalty' || this.resolved) return;
    if (this.phase !== 'charging' && this.phase !== 'flight' && this.phase !== 'ready') return;
    const side: AimSide = keeper.pad.y <= -PAD_THRESHOLD ? -1 : keeper.pad.y >= PAD_THRESHOLD ? 1 : 0;
    if (side === 0) return;
    // Once the ball is away the first choice stands: no changing sides in mid-air.
    if (this.phase === 'flight' && this.commit) return;
    if (this.commit?.side === side) return;
    this.commit = { side, time: this.time };
    if (this.phase === 'flight') {
      this.startDive(side * 1.0, this.config.penaltyKeeper.ventanaTrasDisparo);
      events.push({ type: 'dive', side });
    }
  }

  /** How good the timing of a penalty dive was: 1 = spot on, down to `calidadTardia` when late. */
  private commitTiming(): number {
    if (!this.commit) return 0;
    const p = this.config.penaltyKeeper;
    // Seconds after the release at which the side was chosen (negative: chosen beforehand).
    const at = this.commit.time - this.releasedAt;
    if (at <= 0.03) return 1;
    const late = clamp((at - 0.03) / Math.max(1e-6, p.ventanaTrasDisparo - 0.03), 0, 1);
    return 1 - (1 - p.calidadTardia) * late;
  }

  private release(charge: number | null, events: DuelEvent[]): void {
    const { config } = this;
    const t = config.shot;
    // The ball leaves from wherever the hand is, so there is no jump between hand and flight.
    this.placeBallInHand();
    this.keeperAtRelease = this.keeperU;
    this.plan = planShot(
      {
        from: { x: this.ball.x, y: this.ball.y },
        releaseHeight: this.ball.z,
        charge,
        side: this.aim.side,
        mode: this.aim.mode,
        pressure: 0,
      },
      config.shooter,
      config.goal,
      this.keeperU,
      config.rng,
      t,
    );
    this.phase = 'flight';
    this.flightTime = 0;
    this.releasedAt = this.time;
    this.throwing = 0;
    this.ballHolder = null;
    events.push({ type: 'release', plan: this.plan });
    // A dive chosen before the ball leaves starts exactly on the release.
    if (this.commit) {
      this.startDive(this.commit.side * 1.0, Math.min(0.22, this.plan.flightTime));
      events.push({ type: 'dive', side: this.commit.side });
    }
    // In open play the keeper reacts to the ball itself: the result is settled at once.
    if (config.context === 'open') this.resolve(events);
  }

  private resolve(events: DuelEvent[]): void {
    if (this.resolved || !this.plan) return;
    const { config, plan } = this;
    this.resolved = true;
    const state = {
      u: this.keeperAtRelease,
      set: clamp(this.chargeTime / 0.5, 0, 1),
      ...(config.context === 'penalty' ? { commit: { side: this.commit?.side ?? (0 as AimSide), timing: this.commitTiming() } } : {}),
    };
    const result = resolveShot(plan, config.goal, config.keeper, state, config.context, config.rng, config.shot, config.keeperTuning);
    this.outcome = result.outcome;
    this.save = result.save;

    // Send the keeper where the result needs them to be when the ball arrives.
    const remaining = Math.max(0.05, plan.flightTime - this.flightTime);
    const committedAway =
      config.context === 'penalty' &&
      this.commit !== null &&
      this.commit.side !== 0 &&
      Math.sign(plan.arrival.u - this.keeperAtRelease) !== this.commit.side;
    if (result.outcome.type === 'save') {
      this.keeperHands = clamp(plan.arrival.v, 0.1, config.goal.height + 0.2);
      this.startDive(plan.arrival.u, remaining);
    } else if (!committedAway && plan.landing === 'onTarget') {
      // Beaten: goes the right way but arrives short.
      const short = clamp(-(result.save?.margin ?? -0.4), 0.2, 0.9);
      const direction = Math.sign(plan.arrival.u - this.keeperAtRelease) || 1;
      this.keeperHands = clamp(plan.arrival.v, 0.1, config.goal.height);
      this.startDive(plan.arrival.u - direction * short, remaining);
      if (!this.commit) events.push({ type: 'dive', side: direction as AimSide });
    }
  }

  private startDive(targetU: number, duration: number): void {
    const limit = this.config.goal.halfWidth + 0.2;
    this.diveFrom = this.keeperU;
    this.diveTo = clamp(targetU, -limit, limit);
    this.diveStart = this.time;
    this.diveDuration = Math.max(0.05, duration);
  }

  private stepKeeperDive(): void {
    if (this.diveDuration <= 0) return;
    const k = clamp((this.time - this.diveStart) / this.diveDuration, 0, 1);
    const eased = 1 - (1 - k) * (1 - k);
    this.keeperU = this.diveFrom + (this.diveTo - this.diveFrom) * eased;
    this.keeperStretch = Math.max(this.keeperStretch, clamp(Math.abs(this.diveTo - this.diveFrom) / 1.2, 0, 1) * eased);
  }

  private stepFlight(events: DuelEvent[]): void {
    const { config } = this;
    const plan = this.plan as ShotPlan;
    this.flightTime += DT;
    this.throwing = clamp(this.flightTime / 0.18, 0, 1);
    this.rise = Math.max(0, this.rise - DT * 2.5);

    if (!this.resolved) {
      const window = Math.min(config.penaltyKeeper.ventanaTrasDisparo, plan.flightTime * 0.7);
      if (this.flightTime >= window) this.resolve(events);
    }
    this.stepKeeperDive();

    const s = clamp(this.flightTime / plan.flightTime, 0, 1);
    ballAt(plan, config.goal, s, config.shot, this.ball);
    if (!this.bounced && plan.bounce && plan.bounceAt !== undefined && s >= plan.bounceAt) {
      this.bounced = true;
      events.push({ type: 'bounce', at: plan.bounce, speed: plan.speed });
    }

    if (this.flightTime >= plan.flightTime) {
      if (!this.resolved) this.resolve(events);
      this.arrive(events);
    }
  }

  /** The ball reaches the goal plane: hand it over to free physics according to the result. */
  private arrive(events: DuelEvent[]): void {
    const { config } = this;
    const plan = this.plan as ShotPlan;
    const outcome = this.outcome as ShotOutcome;
    const goal = config.goal;
    const dirX = goal.facing;
    const dx = goal.x - plan.from.x;
    const dy = goal.y + plan.arrival.u - plan.from.y;
    const length = Math.hypot(dx, dy) || 1;
    const ux = dx / length;
    const uy = dy / length;
    const speed = plan.arrivalSpeed;
    const v = this.ballVelocity;
    this.ball.x = goal.x;
    this.ball.y = goal.y + plan.arrival.u;
    this.ball.z = plan.arrival.v;

    switch (outcome.type) {
      case 'goal': {
        const g = goalVelocity(plan, goal, ux, uy, outcome.viaPost);
        v.x = g.x;
        v.y = g.y;
        v.z = g.z;
        if (outcome.viaPost) events.push({ type: 'frame', at: { ...this.ball } });
        break;
      }
      case 'save':
        if (outcome.held) {
          this.ballHolder = 'keeper';
          v.x = v.y = v.z = 0;
        } else {
          // Pushed away: back into the pool and to the side it was stretched to.
          const away = Math.sign(plan.arrival.u - this.diveFrom) || (config.rng.chance(0.5) ? 1 : -1);
          v.x = -dirX * speed * config.rng.range(0.18, 0.32);
          v.y = away * config.rng.range(2, 4.5);
          v.z = config.rng.range(2, 4);
        }
        events.push({ type: 'splash', at: { x: goal.x - dirX * 0.3, y: goal.y + this.keeperU }, strength: 0.9 });
        break;
      case 'post':
        v.x = -dirX * speed * config.rng.range(0.3, 0.5);
        v.y = Math.sign(plan.arrival.u || 1) * config.rng.range(0.5, 3) * (plan.landing === 'bar' ? config.rng.range(-1, 1) : 1);
        v.z = plan.landing === 'bar' ? config.rng.range(2, 4.5) : config.rng.range(0.5, 2);
        events.push({ type: 'frame', at: { ...this.ball } });
        break;
      case 'miss':
        v.x = ux * speed * 0.8;
        v.y = uy * speed * 0.8;
        v.z = outcome.where === 'over' ? 1.5 : 0;
        break;
    }
    this.phase = 'aftermath';
    this.aftermath = 0;
    events.push({ type: 'outcome', outcome, plan, save: this.save });
  }

  private stepAftermath(events: DuelEvent[]): void {
    const { config } = this;
    const goal = config.goal;
    this.aftermath += DT;
    this.rise = Math.max(0, this.rise - DT * 2.5);
    this.throwing = Math.max(0, this.throwing - DT * 3);
    this.stepKeeperDive();
    if (this.aftermath > 0.6) this.keeperStretch = Math.max(0, this.keeperStretch - DT * 2);

    if (this.ballHolder === 'keeper') {
      this.ball.x = goal.x - goal.facing * 0.35;
      this.ball.y = goal.y + this.keeperU;
      this.ball.z = this.keeperHands;
    } else {
      const v = this.ballVelocity;
      const b = this.ball;
      b.x += v.x * DT;
      b.y += v.y * DT;
      b.z += v.z * DT;
      if (b.z > 0) v.z -= GRAVITY * DT;

      // Net: a goal stays inside it (side netting, roof and back); a miss goes on to the wall.
      const depth = (b.x - goal.x) * goal.facing;
      if (this.outcome?.type === 'goal' && keepInNet(b, v, goal) && !this.inNet) {
        this.inNet = true;
        events.push({ type: 'net', at: { ...b } });
      }
      // Pool wall behind the goal: a wide shot dies against the deck.
      if (depth > POOL_WALL) {
        b.x = goal.x + goal.facing * POOL_WALL;
        v.x = 0;
        v.y *= 0.5;
      }
      if (b.z <= 0 && v.z <= 0) {
        const impact = Math.abs(v.z) + Math.hypot(v.x, v.y) * 0.3;
        if (impact > 1.2 && depth < 1) events.push({ type: 'splash', at: { x: b.x, y: b.y }, strength: clamp(impact / 8, 0.2, 1) });
        b.z = 0;
        v.z = 0;
        v.x *= 0.5;
        v.y *= 0.5;
      }
      if (b.z === 0) {
        v.x *= 0.93;
        v.y *= 0.93;
      }
    }
    if (this.aftermath >= config.aftermathSeconds) this.phase = 'done';
  }

  /** Before the release the ball sits in the shooter's hand, raised and cocked back as the charge grows. */
  private placeBallInHand(): void {
    const { config } = this;
    const heights = config.shot.alturaSuelta;
    this.ball.x = config.position.x - config.goal.facing * (0.12 + 0.5 * this.rise);
    this.ball.y = config.position.y + (config.handSide ?? 1) * 0.62;
    this.ball.z = heights.rapido + (heights.cargado - heights.rapido) * this.rise;
  }
}
