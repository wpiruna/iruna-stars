/** Shared types of the positional-attack simulation (GDD §6–7). */
import type { Player } from '../../data/model';
import type { Vec2, Vec3 } from '../field';
import type { SaveEstimate, ShotOutcome, ShotPlan } from '../shooting/model';

export type AttackTuning = (typeof import('../../../data/tuning.json'))['ataque'];

/** 0 = the attacking team (ours), 1 = the defending team. */
export type TeamSide = 0 | 1;

export type Slot = 'boya' | 'extremoIzq' | 'extremoDer' | 'lateralIzq' | 'lateralDer' | 'cierre';
export const SLOTS: readonly Slot[] = ['boya', 'extremoIzq', 'extremoDer', 'lateralIzq', 'lateralDer', 'cierre'];

export interface Swimmer {
  readonly id: string;
  readonly player: Player;
  readonly team: TeamSide;
  readonly keeper: boolean;
  /** Top swimming speed in m/s, from Velocidad. */
  readonly topSpeed: number;
  pos: Vec2;
  prev: Vec2;
  vel: Vec2;
  /** Where the AI wants this swimmer to be, and the fraction of top speed it uses to get there. */
  target: Vec2;
  speedScale: number;
  /** Direction the chest points to, radians (0 = +x). */
  facing: number;
  prevFacing: number;
  desiredFacing: number;
  /** Attackers: their slot. Defenders: the slot of the attacker they mark. */
  slot: Slot | null;
  /** Defenders: the attacker they mark. */
  mark: Swimmer | null;
  /** 0–1: risen out of the water to shoot. */
  rise: number;
  /** 0–1: arm raised to block. */
  armUp: number;
  /** Seconds holding the ball; −1 when not holding it. */
  holdTime: number;
  /** Escapada: burst in `burstDir` until this time, protected from steals until `protectUntil`. */
  burstUntil: number;
  burstDir: Vec2;
  protectUntil: number;
  cooldownUntil: number;
  /** 0–1: wrestling (post fight, turn), for the animation. */
  struggle: number;
  /** 0–1: a defender reading a passing lane (cuts passes out more easily). Set each step. */
  anticipation: number;
  /** Multiplier on the top speed (held, beaten, bursting). Set each step; 1 = normal. */
  speedPenalty: number;
  /** 0–1: extra pressure on this swimmer's shot from a defender's contact. Set each step. */
  contactPressure: number;
  /** 0–1: energy bar (GDD §11.2). Only the match spends it; drills and shoot-outs stay at 1. */
  energy: number;
  /** Sent off for a while: swimming to (or waiting in) the re-entry area, out of the play. */
  excluded?: boolean;
  /** Not in the pool (on the bench, or gone for the rest of the match). */
  away?: boolean;
}

export type PassType = 'dry' | 'wet' | 'lead' | 'long';

export interface PassFlight {
  kind: 'pass';
  type: PassType;
  passer: Swimmer;
  receiver: Swimmer;
  from: Vec3;
  to: Vec3;
  arc: number;
  /** Seconds for the whole flight from `from` to `to`. */
  duration: number;
  t: number;
  /** Set when the roll at release decided that a defender cuts it out, at fraction `endAt` of the flight. */
  interceptor: Swimmer | null;
  endAt: number;
}

export interface ShotFlight {
  kind: 'shot';
  shooter: Swimmer;
  plan: ShotPlan;
  outcome: ShotOutcome;
  save: SaveEstimate | null;
  t: number;
  bounced: boolean;
}

export interface BallState {
  pos: Vec3;
  prev: Vec3;
  vel: Vec3;
  holder: Swimmer | null;
  flight: PassFlight | ShotFlight | null;
  /** Free physics (rebound, loose pass, after a shot). */
  free: boolean;
  /** Out of play: in the net, out over the line or held by the keeper. Nobody can pick it up. */
  dead: boolean;
  inNet: boolean;
  /** Last swimmer who touched the ball (decides corner or goal throw). */
  lastTouch: Swimmer | null;
}

export type AttackResult = 'goal' | 'save' | 'miss' | 'steal' | 'intercept' | 'clock' | 'loose';

export type AttackEvent =
  | { type: 'attackStart'; number: number }
  | { type: 'whistle' }
  | { type: 'pass'; passer: Swimmer; receiver: Swimmer; passType: PassType; risk: number; intercepted: boolean }
  | { type: 'noReceiver'; at: Vec2 }
  | { type: 'catch'; by: Swimmer; passType: PassType }
  | { type: 'intercept'; by: Swimmer }
  | { type: 'driveStart'; driver: Swimmer; destination: Vec2 }
  | { type: 'driveFree'; driver: Swimmer }
  | { type: 'driveEnd'; driver: Swimmer; result: 'free' | 'drag' | 'fail' }
  | { type: 'noDrive'; at: Vec2 }
  | { type: 'postFight'; boya: Swimmer; won: boolean }
  | { type: 'turn'; boya: Swimmer; won: boolean }
  | { type: 'escape'; who: Swimmer }
  | { type: 'steal'; by: Swimmer; from: Swimmer }
  | { type: 'chargeStart'; who: Swimmer }
  | { type: 'release'; plan: ShotPlan; who: Swimmer }
  | { type: 'block'; by: Swimmer }
  | { type: 'bounce'; at: Vec2; speed: number }
  | { type: 'dive'; side: -1 | 0 | 1 }
  | { type: 'outcome'; outcome: ShotOutcome; plan: ShotPlan; save: SaveEstimate | null }
  | { type: 'net'; at: Vec3 }
  | { type: 'frame'; at: Vec3 }
  | { type: 'splash'; at: Vec2; strength: number }
  | { type: 'looseWon'; by: Swimmer }
  | { type: 'attackEnd'; result: AttackResult };
