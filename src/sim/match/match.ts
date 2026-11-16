/**
 * A full match (GDD §4): swim-off, counter-attack and retreat, set attack, goal throws, corners,
 * restarts after a goal, shot clock and periods; and since F4 the referee: contacts, ordinary
 * fouls and free throws, exclusions with superiority and inferiority, penalties, personal fouls,
 * cards and substitutes for players sent off for good. Both teams attack and defend; either can
 * be played by a human (team 0 in the game) or by the AI. Pure simulation at 60 Hz with seeded
 * randomness, so whole matches can be played without a screen (tests and `npm run sim`).
 */
import { STEP_MS } from '../../core/loop';
import { barFactor, clamp, lerp } from '../../core/math';
import type { Rng } from '../../core/rng';
import type { Player, Team } from '../../data/model';
import type { FormationsData, RulesData } from '../../data/schema';
import type { Charging, DefenseStyle, Selection } from '../attack/drill';
import { driveDestination, insidePoint, startDrive, stepDrive, type Drive } from '../attack/drive';
import { assign, slotCost, slotPoint, toGoal } from '../attack/formation';
import { KeeperBody } from '../attack/keeper';
import { moveSwimmers, updateFacing } from '../attack/movement';
import { chooseDriver, choosePass, type DriveInfo, type PassCandidate, type PassChoice, type PassWorld } from '../attack/passing';
import { SLOTS, type AttackTuning, type BallState, type Slot, type Swimmer, type TeamSide } from '../attack/types';
import { add, dir, dist, dot, lerp2, norm, sigmoid, toSegment, v2 } from '../attack/vec';
import { AiKeeper, AiShooter, type Difficulty } from '../duel/ai';
import { aimFromPad, Duel, type Aim, type DuelConfig, type DuelEvent } from '../duel/duel';
import { shooterProfile } from '../duel/shootout';
import { Referee, type RefereeProfile, type RefereeTuning } from '../referee/referee';
import {
  brutalitySeconds,
  classify,
  directShotAllowed,
  freeThrowSpot,
  goalAreaOffence,
  isPersonal,
  overGoalLine,
  shotClockAfterExclusion,
  type Contact,
  type ContactKind,
  type ExclusionEnd,
  type Motive,
} from '../rules/rules';
import { fromGoal, type Field, type Goal, type Vec2 } from '../field';
import { estimateSave, planShot, resolveShot, type AimSide, type KeeperTuning, type ShotMode, type ShotPlan } from '../shooting/model';
import { ballAt } from '../shooting/trajectory';
import { Brain, type BrainAction } from './brain';
import { MatchInput, type ControlContext, type MatchIntent } from './input';
import { assignMarks, bestMatching, countAdvantage, defenceSettled } from './roles';
import {
  emptyStats,
  type Exclusion,
  type FreeThrowReason,
  type MatchEvent,
  type MatchPhase,
  type MatchTuning,
  type PadMode,
  type PossessionReason,
  type SetPiece,
  type SetPieceKind,
  type TeamStats,
} from './types';
import type { PadState } from '../attack/control';

const DT = STEP_MS / 1000;
const LIVE: readonly MatchPhase[] = ['transition', 'positional'];

export type PenaltyTuning = (typeof import('../../../data/tuning.json'))['penalti'];

/** Where each attacking slot stands with a man more: the 4-2, or the 3-3 after a rotation (GDD §9). */
const SUP42: Record<Slot, string> = {
  boya: 'posteIzq',
  lateralDer: 'posteDer',
  extremoIzq: 'extremoIzq',
  extremoDer: 'extremoDer',
  lateralIzq: 'exteriorIzq',
  cierre: 'exteriorDer',
};
const SUP33: Record<Slot, string> = {
  boya: 'poste',
  cierre: 'cierre',
  extremoIzq: 'extremoIzq',
  extremoDer: 'extremoDer',
  lateralIzq: 'exteriorIzq',
  lateralDer: 'exteriorDer',
};

/** A penalty in the match: the shooter–keeper duel of the shoot-out, played inside the match. */
interface PenaltyState {
  side: TeamSide;
  shooter: Swimmer;
  keeper: KeeperBody;
  startAt: number;
  duel: Duel | null;
  aiShooter: AiShooter | null;
  aiKeeper: AiKeeper | null;
  /** The human's TIRO has been released since the whistle (a press from before does not count). */
  armed: boolean;
}

/** A call the referee holds back while the attack shoots (advantage): applied unless it is a goal. */
interface HeldCall {
  by: Swimmer;
  on: Swimmer;
  sanction: 'exclusion' | 'penalty' | 'violent';
  motive: Motive;
  card: 'yellow' | 'red' | null;
  teamWarning: boolean;
}

export interface MatchSideSetup {
  team: Team;
  /** Field players in the water (up to six). */
  field: Player[];
  keeper: Player;
  human: boolean;
  /** Substitutes, for players sent off for the rest of the match (changes arrive in F5). */
  bench?: Player[];
}

export interface MatchSetup {
  field: Field;
  formations: FormationsData;
  sides: [MatchSideSetup, MatchSideSetup];
  periods: number;
  /** Scoreboard seconds per period, and how many of them pass per real second. */
  periodSeconds: number;
  clockSpeed: number;
  possession: { first: number; second: number; clockSpeed: number };
  tuning: AttackTuning;
  match: MatchTuning;
  shot: DuelConfig['shot'];
  keeperTuning: KeeperTuning;
  tilt: number;
  rng: Rng;
  difficulty: Difficulty;
  /** Pad tap threshold of the device in use, in milliseconds. */
  tapMs: number;
  /** The defender you control follows the ball by itself. */
  autoSwitch: boolean;
  /**
   * Counter-attack lab (GDD §20): our attackers break against fewer defenders, over and over.
   * Each side's `field` holds only the players in the drill.
   */
  counter?: { attackers: number; defenders: number };
  /** Man-up lab: we attack 6 against 5 ('attack') or defend 5 against 6 ('defend'), over and over. */
  manUp?: 'attack' | 'defend';
  /** The rulebook (data/reglas.json). */
  rules: RulesData;
  /** The referee of the match and how referees whistle (data/tuning.json → arbitro). */
  referee: RefereeProfile;
  refereeTuning: RefereeTuning;
  /** Penalty duel: the shoot-out tuning (data/tuning.json → penalti). */
  penalty: PenaltyTuning;
}

interface Side {
  index: TeamSide;
  team: Team;
  human: boolean;
  field: Swimmer[];
  keeper: Swimmer;
  keeperBody: KeeperBody;
  attacks: Goal;
  defends: Goal;
  defenseStyle: DefenseStyle;
  brain: Brain;
  /** Swim-off: extra speed from mashing HABILIDAD. */
  sprintBonus: number;
  /** Not in the pool: substitutes for players sent off for good. */
  bench: Swimmer[];
  /** Players sent off for now. */
  out: Exclusion[];
  /** With a man more: rotated from the 4-2 to the 3-3. */
  rotated: boolean;
}

export interface MatchCharging extends Charging {
  /** AI shots release by themselves after `hold` seconds. */
  ai: { hold: number; side: AimSide; mode: ShotMode } | null;
}

type Buffered = { kind: 'pass'; aim: Vec2; at: number } | { kind: 'shot'; at: number; released: number | null };

interface HumanDefence {
  swim: Vec2 | null;
  manual: boolean;
  burstUntil: number;
  burstReady: number;
  anticipateUntil: number;
  anticipateReady: number;
  blockUntil: number;
  stealReady: number;
  beatenUntil: number;
  contact: { on: Swimmer; start: number; held: boolean; until: number; checks: number; nextCheck: number; urgent: boolean } | null;
}

function makeSwimmer(player: Player, team: TeamSide, keeper: boolean, t: AttackTuning): Swimmer {
  return {
    id: `${team}-${player.id}`,
    player,
    team,
    keeper,
    topSpeed: lerp(t.nado.velocidad.min, t.nado.velocidad.max, barFactor(player.stats.speed)),
    pos: v2(),
    prev: v2(),
    vel: v2(),
    target: v2(),
    speedScale: 0.5,
    facing: 0,
    prevFacing: 0,
    desiredFacing: 0,
    slot: null,
    mark: null,
    rise: 0,
    armUp: 0,
    holdTime: -1,
    burstUntil: 0,
    burstDir: v2(),
    protectUntil: 0,
    cooldownUntil: 0,
    struggle: 0,
    anticipation: 0,
    speedPenalty: 1,
    contactPressure: 0,
  };
}

const angleTo = (from: Vec2, to: Vec2): number => Math.atan2(to.y - from.y, to.x - from.x);

export class Match {
  phase: MatchPhase = 'swimOffReady';
  time = 0;
  period = 1;
  /** Scoreboard seconds left in the period. */
  clock: number;
  /** Shot-clock seconds as the scoreboard shows them. */
  shotClock: number;
  /** Team with the ball (or that last had it). */
  possession: TeamSide | null = null;
  readonly score: [number, number] = [0, 0];
  readonly stats: [TeamStats, TeamStats] = [emptyStats(), emptyStats()];
  readonly sides: [Side, Side];
  readonly all: Swimmer[];
  readonly ball: BallState;
  readonly keepers: KeeperBody[];
  readonly drives = new Map<Swimmer, Drive>();
  /** The attacking centre's position against their defender, −1 fronted … +1 won. */
  post = 0;
  preview: PassChoice | null = null;
  selection: Selection | null = null;
  charging: MatchCharging | null = null;
  /** The defender the human controls while defending. */
  selected: Swimmer | null = null;
  padMode: PadMode = 'none';
  advantage: { attackers: number; defenders: number } | null = null;
  setPiece: SetPiece | null = null;
  lastScorer: Swimmer | null = null;
  /** Counter-attack lab: breaks started so far. */
  counterAttempts = 0;
  /** The penalty being taken. */
  penalty: PenaltyState | null = null;
  readonly referee: Referee;
  /** Personal fouls (exclusions and penalties) of each player (WP 17). */
  readonly personal = new Map<Swimmer, number>();

  private readonly t: AttackTuning;
  private readonly m: MatchTuning;
  private readonly input: MatchInput;
  /** Field players in the water and in the play (not the excluded, not the bench). */
  private movers: Swimmer[] = [];
  private readonly xg: Rng;
  private phaseTimer = 0;
  private previewTarget: Swimmer | null = null;
  private buffer: Buffered | null = null;
  private postFight: { until: number; won: boolean } | null = null;
  private boyaTurn: { at: number; won: boolean; resolved: boolean } | null = null;
  private crossedHalfAt = -1;
  private settleSince = -1;
  private advantageSince = -1;
  private nextMarking = 0;
  private periodEndPending = false;
  private pendingRestart: { kind: SetPieceKind; side: TeamSide; at: number; spot: Vec2 } | null = null;
  private mashTimes: number[] = [];
  private carrySwim: Vec2 | null = null;
  private mustPass: Swimmer | null = null;
  private lastHolder: Swimmer | null = null;
  private keeperHeldSince = -1;
  /** The loose ball comes from a shot (post, parry or block): keeping it is a second possession. */
  private afterShot = false;
  private lastGoalSide: TeamSide = 0;
  /** When the last numerical advantage ended (so a flickering count is not announced twice). */
  private advantageEndedAt = -Infinity;
  private counterResetAt = -1;
  /** A call held back while the attack shoots. */
  private heldCall: HeldCall | null = null;
  /** After a foul the taker must pass (inside 6 m, or once the moment to shoot directly is gone). */
  private noShot: Swimmer | null = null;
  private directUntil = -1;
  /** Seconds each attacker has spent in the goal area ahead of the ball (WP 8.2.8). */
  private readonly areaTime = new Map<Swimmer, number>();
  /** Inferiority: the zone each defender holds, as (distance from the goal line, lateral). */
  private readonly zones = new Map<Swimmer, Vec2>();
  /** The short-handed defender who steps out to the ball. */
  private presser: Swimmer | null = null;
  /** The shot being taken was blocked by this field player (for corner or goal throw). */
  private lastBlocker: Swimmer | null = null;
  private readonly fouls: Rng;
  private readonly human: HumanDefence = {
    swim: null,
    manual: false,
    burstUntil: 0,
    burstReady: 0,
    anticipateUntil: 0,
    anticipateReady: 0,
    blockUntil: 0,
    stealReady: 0,
    beatenUntil: 0,
    contact: null,
  };

  constructor(readonly setup: MatchSetup) {
    this.t = setup.tuning;
    this.m = setup.match;
    this.input = new MatchInput(this.t.control, setup.tapMs);
    this.xg = setup.rng.fork('xg');
    this.fouls = setup.rng.fork('faltas');
    this.referee = new Referee(setup.referee, setup.refereeTuning, setup.rules.modoTarjetas, setup.rules.tarjetas.amarillasParaRoja, setup.rng.fork('arbitro'));
    const { field } = setup;
    const goals: [Goal, Goal] = [field.goalRight, field.goalLeft];
    this.sides = [0, 1].map((index) => {
      const s = setup.sides[index as TeamSide];
      const side = index as TeamSide;
      const keeper = makeSwimmer(s.keeper, side, true, this.t);
      const defends = goals[(1 - index) as TeamSide];
      return {
        index: side,
        team: s.team,
        human: s.human,
        field: s.field.slice(0, 6).map((p) => makeSwimmer(p, side, false, this.t)),
        keeper,
        keeperBody: new KeeperBody(
          keeper,
          defends,
          { reflexes: s.keeper.keeperStats?.reflexes ?? 3, positioning: s.keeper.keeperStats?.positioning ?? 3, energy: 1 },
          setup.keeperTuning,
          this.t.portero,
        ),
        attacks: goals[side],
        defends,
        defenseStyle: s.team.style === 'defensive' ? 'zone' : 'press',
        brain: new Brain(setup.rng.fork(`brain-${index}`), this.m, this.t.pase, setup.shot, s.team.style, setup.difficulty),
        sprintBonus: 0,
        bench: (s.bench ?? []).map((p) => {
          const b = makeSwimmer(p, side, false, this.t);
          b.away = true;
          return b;
        }),
        out: [] as Exclusion[],
        rotated: false as boolean,
      } satisfies Side;
    }) as [Side, Side];
    this.refreshMovers();
    this.all = [...this.movers, ...this.sides[0].bench, ...this.sides[1].bench, this.sides[0].keeper, this.sides[1].keeper];
    this.keepers = [this.sides[0].keeperBody, this.sides[1].keeperBody];
    this.ball = {
      pos: { x: field.length / 2, y: field.width / 2, z: 0 },
      prev: { x: field.length / 2, y: field.width / 2, z: 0 },
      vel: { x: 0, y: 0, z: 0 },
      holder: null,
      flight: null,
      free: false,
      dead: false,
      inNet: false,
      lastTouch: null,
    };
    this.clock = setup.periodSeconds;
    this.shotClock = setup.possession.first;
    if (setup.counter) this.startCounter([]);
    else if (setup.manUp) this.startManUp([]);
    else this.startPeriod([]);
  }

  /** Labs: every attempt starts at full strength and with no personal fouls. */
  private labReset(events: MatchEvent[]): void {
    for (const side of this.sides) {
      for (const ex of [...side.out]) {
        ex.forGame = false;
        ex.replaced = false;
        this.bringBack(side, ex, 'time', events, true);
      }
      side.rotated = false;
    }
    this.personal.clear();
  }

  private get lab(): boolean {
    return this.setup.counter !== undefined || this.setup.manUp !== undefined;
  }

  private refreshMovers(): void {
    this.movers = [...this.sides[0].field, ...this.sides[1].field];
  }

  /**
   * Man-up lab: a set attack with one of the defenders already sent off, from the free throw
   * that follows the exclusion.
   */
  private startManUp(events: MatchEvent[]): void {
    this.counterResetAt = -1;
    this.counterAttempts++;
    this.labReset(events);
    this.resetPlayState();
    this.ball.flight = null;
    this.ball.free = this.ball.dead = this.ball.inNet = false;
    this.ball.vel = { x: 0, y: 0, z: 0 };
    const attIndex: TeamSide = this.setup.manUp === 'attack' ? 0 : 1;
    const att = this.sides[attIndex];
    const def = this.sides[(1 - attIndex) as TeamSide];
    for (const side of this.sides) {
      side.keeperBody.reset();
      side.keeperBody.holding = false;
    }
    const goal = att.attacks;
    this.possession = null;
    this.shotClock = this.setup.possession.first;
    this.assignSlots(att.field);
    for (const a of att.field) this.place(a, this.slotAt(a.slot ?? 'cierre', att), angleTo(a.pos, goal));
    def.field.forEach((d, i) => this.place(d, fromGoal(goal, 3 + (i % 3) * 1.4, (i % 2 === 0 ? 1 : -1) * (1 + i * 0.8)), angleTo(goal, fromGoal(goal, 6, 0))));
    const holder = att.field.find((a) => a.slot === 'cierre') ?? (att.field[0] as Swimmer);
    this.giveBall(attIndex, holder, 'restart', events);
    this.clock = Math.max(this.clock, 60);
    this.setPhase('positional', events);
    // The defender nearest the ball goes out, and the attack restarts with a free throw.
    const offender = [...def.field].sort((a, b) => dist(a.pos, holder.pos) - dist(b.pos, holder.pos))[0];
    if (offender) {
      this.exclude(offender, false, false, events);
      this.stats[attIndex].manUp++;
      this.beginFreeThrow(attIndex, { x: holder.pos.x, y: holder.pos.y }, 'positional', 'exclusion', events);
    }
  }

  /** Counter-attack lab: a fresh break from the halfway line, with the ball in our hands. */
  private startCounter(events: MatchEvent[]): void {
    this.labReset(events);
    this.resetPlayState();
    this.counterResetAt = -1;
    this.counterAttempts++;
    this.ball.flight = null;
    this.ball.free = this.ball.dead = this.ball.inNet = false;
    this.ball.vel = { x: 0, y: 0, z: 0 };
    const att = this.sides[0];
    const def = this.sides[1];
    for (const side of this.sides) {
      side.keeperBody.reset();
      side.keeperBody.holding = false;
    }
    const goal = att.attacks;
    const lanes = att.field.length === 2 ? [1.5, -2.5] : [0, 4, -4, 2, -2, 0];
    att.field.forEach((s, i) => this.place(s, fromGoal(goal, 9.5 + (i === 0 ? 0 : -1), lanes[i] ?? 0), angleTo(fromGoal(goal, 9.5, 0), goal)));
    // The defenders are already back, but there are fewer of them.
    def.field.forEach((s, i) => this.place(s, fromGoal(goal, 5.5 + i * 1.5, (i % 2 === 0 ? 1 : -1) * (i === 0 ? 0.5 : 2)), angleTo(goal, fromGoal(goal, 9.5, 0))));
    const holder = att.field[0] as Swimmer;
    this.possession = null;
    this.giveBall(0, holder, 'restart', events);
    this.clock = Math.max(this.clock, 60);
    this.setPhase('transition', events);
  }

  // ------------------------------------------------------------------------------------------
  // What the view and the session read
  // ------------------------------------------------------------------------------------------

  goalOf(team: TeamSide): Goal {
    return this.sides[team].attacks;
  }

  /** The swimmer the human controls (ring in the water). */
  get controlled(): Swimmer | null {
    const p = this.penalty;
    if (p && this.phase === 'penalty') {
      if (this.sides[p.side].human) return p.shooter;
      return this.sides[(1 - p.side) as TeamSide].human ? p.keeper.swimmer : null;
    }
    const context = this.input.current;
    if (context === 'defend') return this.selected;
    if (context === 'attack' || context === 'carry' || context === 'keeper') {
      const holder = this.ball.holder;
      if (holder && holder.team === 0) return holder;
      const flight = this.ball.flight;
      if (flight?.kind === 'pass' && flight.receiver.team === 0) return flight.receiver;
    }
    return null;
  }

  get attackingSide(): Side | null {
    return this.possession === null ? null : this.sides[this.possession];
  }

  get defendingSide(): Side | null {
    return this.possession === null ? null : this.sides[(1 - this.possession) as TeamSide];
  }

  /** The attacking team's player in the centre spot (with a man more there is no centre fight). */
  get boya(): Swimmer | null {
    if (this.phase !== 'positional') return null;
    const att = this.attackingSide;
    if (!att || this.manUpOf(att) > 0) return null;
    return att.field.find((s) => s.slot === 'boya') ?? null;
  }

  /** How many more players this side has in the play than the other (exclusions). */
  manUpOf(side: Side): number {
    return side.field.length - this.sides[(1 - side.index) as TeamSide].field.length;
  }

  /** A team's attacking shape right now (HUD, debug layer, tests). */
  shapeOf(team: TeamSide): '3-3' | '4-2' | '3-3 rotado' {
    const side = this.sides[team];
    if (this.manUpOf(side) <= 0) return '3-3';
    return side.rotated ? '3-3 rotado' : '4-2';
  }

  /** Substitutes left on a team's bench. */
  benchOf(team: TeamSide): readonly Swimmer[] {
    return this.sides[team].bench;
  }

  /** Exclusions running, for the HUD: who, which team and the scoreboard seconds left. */
  get exclusions(): readonly Exclusion[] {
    return [...this.sides[0].out, ...this.sides[1].out];
  }

  /** Players of a team in the play right now. */
  inPlay(team: TeamSide): readonly Swimmer[] {
    return this.sides[team].field;
  }

  defenderOf(attacker: Swimmer): Swimmer | null {
    return this.sides[(1 - attacker.team) as TeamSide].field.find((d) => d.mark === attacker) ?? null;
  }

  set tapMs(ms: number) {
    this.input.tapMs = ms;
  }

  // ------------------------------------------------------------------------------------------
  // Step
  // ------------------------------------------------------------------------------------------

  step(pad: PadState): MatchEvent[] {
    const events: MatchEvent[] = [];
    this.time += DT;
    for (const s of this.all) {
      s.speedPenalty = 1;
      s.contactPressure = 0;
      s.anticipation = 0;
    }

    const context = this.context();
    this.padMode = PAD_MODE[context];
    if (this.phase === 'penalty' && this.penalty) {
      this.padMode = this.sides[this.penalty.side].human ? 'shoot' : this.sides[(1 - this.penalty.side) as TeamSide].human ? 'save' : 'none';
    }
    const intents = this.input.update(pad, context, STEP_MS);
    // A call held back for the advantage: once the shot is over, it stands (unless it was a goal).
    if (this.heldCall && LIVE.includes(this.phase) && !this.charging && this.ball.flight?.kind !== 'shot') this.applyHeldCall(events);

    switch (this.phase) {
      case 'swimOffReady':
        this.phaseTimer -= DT;
        if (this.phaseTimer <= 0) {
          events.push({ type: 'whistle' });
          this.setPhase('swimOff', events);
        }
        break;
      case 'swimOff':
        this.stepSwimOff(intents, events);
        break;
      case 'transition':
      case 'positional':
        this.stepPlay(intents, pad, context, events);
        break;
      case 'setPiece':
        this.stepSetPiece(events);
        break;
      case 'penalty':
        this.stepPenalty(pad, events);
        break;
      case 'goal':
        this.phaseTimer -= DT;
        this.idle();
        if (this.phaseTimer <= 0 && !this.lab) {
          if (this.periodEndPending || this.clock <= 0) this.endPeriod(events);
          else if (this.possession !== null) this.startRestart((1 - this.lastGoalSide) as TeamSide, events);
        }
        break;
      case 'periodEnd':
        this.phaseTimer -= DT;
        this.idle();
        if (this.phaseTimer <= 0) {
          if (this.period < this.setup.periods) {
            this.period++;
            this.clock = this.setup.periodSeconds;
            this.startPeriod(events);
          } else {
            this.setPhase('fullTime', events);
            events.push({ type: 'fullTime', score: [this.score[0], this.score[1]] });
          }
        }
        break;
      case 'fullTime':
        this.idle();
        break;
    }

    this.stepExclusions(events);
    moveSwimmers(this.movers, DT, this.t.nado, this.setup.field.length, this.setup.field.width);
    const leaving = this.sides.flatMap((side) => side.out.map((ex) => ex.swimmer));
    if (leaving.length > 0) moveSwimmers(leaving, DT, this.t.nado, this.setup.field.length, this.setup.field.width);
    for (const side of this.sides) {
      const body = side.keeperBody;
      if (this.penalty?.duel && this.penalty.keeper === body) this.mirrorPenaltyKeeper(this.penalty.duel, body);
      else body.step(body.holding ? null : this.ball.pos, this.time, DT);
      side.keeper.desiredFacing = angleTo(side.keeper.pos, this.ball.pos);
      updateFacing(side.keeper, DT, this.t.nado);
    }
    if (this.phase === 'penalty' && this.penalty?.duel) this.mirrorPenaltyBall(this.penalty.duel);
    else this.stepBall(events);
    if (this.phase === 'transition' || this.phase === 'positional' || this.phase === 'swimOff') this.tickClocks(events);
    if (this.lab) this.checkCounterEnd(events);
    return events;
  }

  /**
   * Labs: once the attack is over (goal, save, shot wide, ball lost; in the man-up lab also the
   * end of the exclusion) start another one.
   */
  private checkCounterEnd(events: MatchEvent[]): void {
    if (this.counterResetAt < 0) {
      // A penalty is played out first.
      if (this.phase === 'penalty') return;
      let over: boolean;
      if (this.setup.manUp) {
        const attIndex: TeamSide = this.setup.manUp === 'attack' ? 0 : 1;
        const shortSide = this.sides[(1 - attIndex) as TeamSide];
        over =
          this.possession !== attIndex ||
          this.phase === 'goal' ||
          this.pendingRestart !== null ||
          (this.phase !== 'setPiece' && shortSide.out.length === 0 && this.manUpOf(this.sides[attIndex]) <= 0);
      } else {
        over = this.possession === 1 || this.phase === 'goal' || this.phase === 'setPiece' || this.pendingRestart !== null;
      }
      if (over) this.counterResetAt = this.time + 1.6;
      return;
    }
    if (this.time >= this.counterResetAt) {
      if (this.setup.manUp) this.startManUp(events);
      else this.startCounter(events);
    }
  }

  private setPhase(phase: MatchPhase, events: MatchEvent[]): void {
    if (phase === this.phase) return;
    const previous = this.phase;
    this.phase = phase;
    events.push({ type: 'phase', phase, previous });
  }

  /** Nobody does anything in particular: everybody treads water where they are. */
  private idle(): void {
    for (const s of this.movers) {
      s.target = { ...s.pos };
      s.speedScale = 0.3;
      s.rise = Math.max(0, s.rise - DT * 2.5);
      s.armUp = Math.max(0, s.armUp - DT * 3);
    }
  }

  private context(): ControlContext {
    const humanSide = this.sides[0].human ? 0 : this.sides[1].human ? 1 : null;
    if (humanSide === null) return 'none';
    if (this.phase === 'swimOff') return 'sprint';
    if (this.phase === 'penalty') return 'none';
    if (!LIVE.includes(this.phase) && !(this.phase === 'setPiece' && this.setPiece?.whistled)) return 'none';
    if (this.ball.dead || this.pendingRestart) return 'none';
    const holder = this.ball.holder;
    const flight = this.ball.flight;
    const positional = this.phase === 'positional' || this.setPiece?.kind === 'corner';
    if (holder && holder.team === humanSide) return holder.keeper ? 'keeper' : positional ? 'attack' : 'carry';
    if (flight?.kind === 'pass' && flight.receiver.team === humanSide && !flight.receiver.keeper) return positional ? 'attack' : 'carry';
    if (flight?.kind === 'shot' || this.charging?.shooter.team === humanSide) return positional ? 'attack' : 'carry';
    return 'defend';
  }

  // ------------------------------------------------------------------------------------------
  // Periods, swim-off, restarts and set pieces
  // ------------------------------------------------------------------------------------------

  private startPeriod(events: MatchEvent[]): void {
    const { field } = this.setup;
    // A new period starts at full strength: exclusions are over and substitutes come in
    // (arcade: the rulebook carries the time over). After a violent action they still wait.
    for (const side of this.sides) {
      for (const ex of [...side.out]) if (!ex.brutal) this.bringBack(side, ex, 'time', events, true);
      side.rotated = false;
    }
    this.resetPlayState();
    this.possession = null;
    this.ball.holder = null;
    this.ball.flight = null;
    this.ball.free = this.ball.dead = this.ball.inNet = false;
    this.ball.pos = { x: field.length / 2, y: field.width / 2, z: 0 };
    this.ball.prev = { ...this.ball.pos };
    this.ball.vel = { x: 0, y: 0, z: 0 };
    this.ball.lastTouch = null;
    this.shotClock = this.setup.possession.first;
    for (const side of this.sides) {
      side.keeperBody.reset();
      side.keeperBody.holding = false;
      // Lined up on their own goal line, the fastest in the middle for the sprint.
      const ordered = [...side.field].sort((a, b) => b.topSpeed - a.topSpeed || a.player.number - b.player.number);
      const lanes = [0, -1.6, 1.6, -3.2, 3.2, -4.8];
      ordered.forEach((s, i) => {
        const p = fromGoal(side.attacks, field.length - 1.2, lanes[i] ?? 0);
        this.place(s, p, angleTo(p, this.ball.pos));
      });
      side.sprintBonus = 0;
    }
    this.mashTimes = [];
    this.phaseTimer = this.m.sprint.preparacion;
    this.setPhase('swimOffReady', events);
  }

  private place(s: Swimmer, p: Vec2, facing: number): void {
    s.pos = { ...p };
    s.prev = { ...p };
    s.target = { ...p };
    s.vel = v2();
    s.facing = s.prevFacing = s.desiredFacing = facing;
    s.rise = s.armUp = s.struggle = 0;
    s.holdTime = -1;
    s.burstUntil = s.protectUntil = s.cooldownUntil = 0;
  }

  private resetPlayState(): void {
    this.drives.clear();
    this.charging = null;
    this.preview = null;
    this.previewTarget = null;
    this.selection = null;
    this.buffer = null;
    this.postFight = null;
    this.boyaTurn = null;
    this.post = 0;
    this.advantage = null;
    this.crossedHalfAt = -1;
    this.settleSince = -1;
    this.advantageSince = -1;
    this.setPiece = null;
    this.mustPass = null;
    this.pendingRestart = null;
    this.carrySwim = null;
    this.human.contact = null;
    this.human.swim = null;
    this.keeperHeldSince = -1;
    this.penalty = null;
    this.heldCall = null;
    this.noShot = null;
    this.directUntil = -1;
    this.areaTime.clear();
    this.lastBlocker = null;
    for (const side of this.sides) side.brain.reset();
  }

  private sprinter(side: Side): Swimmer {
    return [...side.field].sort((a, b) => b.topSpeed - a.topSpeed || a.player.number - b.player.number)[0] as Swimmer;
  }

  private stepSwimOff(intents: MatchIntent[], events: MatchEvent[]): void {
    const sp = this.m.sprint;
    for (const intent of intents) if (intent.type === 'skillPress') this.mashTimes.push(this.time);
    this.mashTimes = this.mashTimes.filter((t) => this.time - t <= 1);
    for (const side of this.sides) {
      // Mashing helps, but only so much: the fastest swimmer should usually win.
      const rate = side.human ? this.mashTimes.length : this.m.sprint.pulsacionesIa[this.setup.difficulty];
      side.sprintBonus = sp.bonusMax * Math.min(1, rate / sp.pulsacionesMax);
      const runner = this.sprinter(side);
      for (const s of side.field) {
        if (s === runner) {
          s.target = { ...this.ball.pos };
          s.speedScale = sp.velocidad + side.sprintBonus;
        } else {
          // The rest swim up to support, behind the sprinter.
          const lateral = toGoal(side.attacks, s.pos).lateral;
          s.target = fromGoal(side.attacks, this.setup.field.length / 2 + 2.5, lateral);
          s.speedScale = 0.85;
        }
        s.desiredFacing = angleTo(s.pos, s.target);
      }
    }
    // First to the ball keeps it.
    let winner: Swimmer | null = null;
    let best: number = sp.recoger;
    for (const side of this.sides) {
      const runner = this.sprinter(side);
      const d = dist(runner.pos, this.ball.pos);
      if (d < best) {
        best = d;
        winner = runner;
      }
    }
    if (winner) {
      events.push({ type: 'swimOffWon', by: winner });
      this.giveBall(winner.team, winner, 'swimOff', events);
      this.setPhase('transition', events);
    }
  }

  /** After a goal: the team that conceded restarts from the centre (GDD §12). */
  private startRestart(side: TeamSide, events: MatchEvent[]): void {
    const { field } = this.setup;
    this.resetPlayState();
    const centre = { x: field.length / 2, y: field.width / 2 };
    const lanes = [-5, -2.5, 0, 2.5, 5, 0];
    for (const s of this.sides) {
      s.keeperBody.reset();
      s.keeperBody.holding = false;
      s.field.forEach((p, i) => {
        const back = i === 5 ? 6 : 3;
        this.place(p, fromGoal(s.attacks, field.length / 2 + back, lanes[i] ?? 0), angleTo(fromGoal(s.attacks, 12.5, 0), s.attacks));
      });
    }
    const taker = [...this.sides[side].field].sort((a, b) => dist(a.pos, centre) - dist(b.pos, centre))[0] as Swimmer;
    this.place(taker, centre, angleTo(centre, this.sides[side].attacks));
    this.ball.inNet = false;
    this.beginSetPiece('restart', side, taker, centre, events);
  }

  private beginSetPiece(
    kind: SetPieceKind,
    side: TeamSide,
    taker: Swimmer,
    spot: Vec2,
    events: MatchEvent[],
    options: { reason?: FreeThrowReason; resume?: 'transition' | 'positional'; prep?: number; direct?: boolean } = {},
  ): void {
    const s = this.m.saque;
    const reason = kind === 'freeThrow' ? (options.reason ?? 'clock') : null;
    this.pendingRestart = null;
    this.charging = null;
    this.drives.clear();
    this.buffer = null;
    this.preview = null;
    this.selection = null;
    this.ball.flight = null;
    this.ball.free = this.ball.dead = false;
    this.ball.vel = { x: 0, y: 0, z: 0 };
    for (const k of this.keepers) k.holding = false;
    const possession: PossessionReason = kind === 'goalThrow' ? 'goalThrow' : kind === 'corner' ? 'corner' : kind === 'restart' ? 'restart' : reason === 'foul' ? 'foul' : 'clock';
    this.giveBall(side, taker, possession, events);
    if (!taker.keeper) this.place(taker, spot, angleTo(spot, this.sides[side].attacks));
    if (kind === 'corner') this.shotClock = this.setup.rules.posesion.trasCorner;
    const prep = options.prep ?? s.preparacion;
    const resume = options.resume ?? (kind === 'corner' ? 'positional' : 'transition');
    this.setPiece = { kind, reason, side, taker, spot, readyAt: this.time + prep, deadline: this.time + prep + s.plazo, whistled: false, resume };
    this.mustPass = kind === 'corner' || reason === 'foul' ? taker : null;
    this.noShot = reason === 'foul' ? taker : null;
    this.directUntil = reason === 'foul' && options.direct ? Infinity : -1;
    // A throw for the team of an excluded player lets him back in (WP 10.5.2.4).
    if (kind === 'freeThrow' || kind === 'goalThrow') this.endExclusions(side, 'throw', events);
    this.setPhase('setPiece', events);
    events.push({ type: 'setPiece', kind, side, reason });
  }

  private stepSetPiece(events: MatchEvent[]): void {
    const sp = this.setPiece;
    if (!sp) return;
    // Everybody takes position while the taker waits for the whistle.
    if (sp.resume === 'positional') this.positionalTargets();
    else this.transitionTargets();
    sp.taker.target = { ...sp.taker.pos };
    sp.taker.speedScale = 0.2;
    // Defenders back off to a metre from the ball (WP 12.7).
    for (const d of this.sides[(1 - sp.side) as TeamSide].field) {
      if (dist(d.target, sp.taker.pos) < 1.1) d.target = add(sp.taker.pos, dir(sp.taker.pos, d.pos), 1.2);
    }
    if (this.time >= sp.readyAt && !sp.whistled) {
      sp.whistled = true;
      events.push({ type: 'whistle' });
      this.setPiece = null;
      this.setPhase(sp.resume, events);
      // From a free throw outside 6 m the taker may shoot at once, "sin demora" (WP 7.5.1.2).
      if (sp.reason === 'foul' && this.directUntil === Infinity) this.directUntil = this.time + this.setup.rules.tiroDirectoSegundos;
      if (sp.resume === 'positional') {
        this.assignSlots(this.sides[sp.side].field);
        this.assignAllMarks();
      }
    }
  }

  private endPeriod(events: MatchEvent[]): void {
    this.periodEndPending = false;
    this.resetPlayState();
    // Whatever is in the air when the horn sounds does not count any more.
    this.ball.holder = null;
    this.ball.flight = null;
    this.ball.free = false;
    this.ball.dead = true;
    for (const k of this.keepers) k.holding = false;
    this.phaseTimer = this.period === this.setup.periods / 2 ? this.m.periodo.mitad : this.m.periodo.descanso;
    events.push({ type: 'horn' }, { type: 'periodEnd', period: this.period });
    this.setPhase('periodEnd', events);
  }

  // ------------------------------------------------------------------------------------------
  // Possession
  // ------------------------------------------------------------------------------------------

  private giveBall(side: TeamSide, holder: Swimmer, reason: PossessionReason, events: MatchEvent[]): void {
    const changed = this.possession !== side;
    this.lastBlocker = null;
    if (changed && this.possession !== null && ['steal', 'intercept', 'loose', 'clock', 'block'].includes(reason)) {
      this.stats[this.possession].turnovers++;
      if (reason === 'steal' || reason === 'intercept') this.stats[side].steals++;
    }
    this.possession = side;
    this.ball.holder = holder;
    this.ball.flight = null;
    this.ball.free = false;
    this.ball.lastTouch = holder;
    holder.holdTime = 0;
    if (holder.keeper) {
      this.sides[side].keeperBody.holding = true;
      this.keeperHeldSince = this.time;
    }
    if (changed) {
      this.afterShot = false;
      this.noShot = null;
      this.directUntil = -1;
      this.shotClock = this.setup.possession.first;
      this.drives.clear();
      this.charging = null;
      this.post = 0;
      this.postFight = null;
      this.boyaTurn = null;
      this.buffer = null;
      this.preview = null;
      this.selection = null;
      this.advantage = null;
      this.crossedHalfAt = -1;
      this.settleSince = -1;
      this.advantageSince = -1;
      for (const s of this.sides) s.brain.reset();
      // The excluded players of the team that gets the ball may come back (WP 10.5.2.3).
      this.endExclusions(side, 'possession', events);
      this.assignSlots(this.sides[side].field);
      this.assignAllMarks();
      events.push({ type: 'possession', side, reason });
    }
    for (const k of this.keepers) k.reroll(this.setup.rng);
    this.placeBallInHand(holder);
  }

  /** Slots for the attacking team by who is nearest (plus their natural position). */
  private assignSlots(field: Swimmer[]): void {
    const first = field[0];
    if (!first) return;
    const side = this.sides[first.team];
    const slots = SLOTS.slice(0, field.length);
    const points = new Map(slots.map((s) => [s, this.slotAt(s, side)]));
    const result = assign(field, slots, (a, slot) => dist(a.pos, points.get(slot) as Vec2) * 0.6 + slotCost(a.player, slot));
    for (const [a, slot] of result) a.slot = slot;
  }

  /**
   * World point of an attacking slot: the 3-3, or with a man more the 4-2 (3-3 after a rotation),
   * kept out of the goal area (GDD §6.3, §9).
   */
  private slotAt(slot: Slot, side: Side): Vec2 {
    const f = this.setup.formations;
    const up = this.manUpOf(side) > 0;
    const base = up ? (side.rotated ? f.superioridad33?.puestos[SUP33[slot]] : f.superioridad42?.puestos[SUP42[slot]]) : f.ataque33?.puestos[slot];
    if (!base) return slotPoint(f, slot, side.attacks, this.t.zona.distanciaMinima);
    return fromGoal(side.attacks, Math.max(this.t.zona.distanciaMinima, base.x), base.y);
  }

  private assignAllMarks(): void {
    const att = this.attackingSide;
    const def = this.defendingSide;
    if (!att || !def) return;
    const marks = assignMarks(def.field, att.field, att.attacks, this.ball.holder, this.m.transicion.peligro);
    for (const [d, a] of marks) {
      d.mark = a;
      d.slot = a?.slot ?? null;
    }
    this.nextMarking = this.time + this.m.transicion.reparto;
    this.assignZones(def, att.attacks);
  }

  /** Short-handed: each defender takes a zone of the inferiority shape (GDD §9), the nearest one. */
  private assignZones(def: Side, goal: Goal): void {
    this.zones.clear();
    if (this.manUpOf(def) >= 0) return;
    const shape = this.setup.formations.inferioridad5;
    if (!shape) return;
    const points = Object.values(shape.puestos).slice(0, def.field.length);
    const pick = bestMatching(def.field.length, points.length, (r, c) => {
      const p = points[c] as { x: number; y: number };
      return dist((def.field[r] as Swimmer).pos, fromGoal(goal, p.x, p.y));
    });
    pick.forEach((c, r) => {
      const p = points[c];
      const d = def.field[r];
      if (p && d) this.zones.set(d, { x: p.x, y: p.y });
    });
  }

  // ------------------------------------------------------------------------------------------
  // Live play
  // ------------------------------------------------------------------------------------------

  private stepPlay(intents: MatchIntent[], pad: PadState, context: ControlContext, events: MatchEvent[]): void {
    const att = this.attackingSide;
    if (!att) return;
    if (this.pendingRestart) {
      this.idle();
      if (this.time >= this.pendingRestart.at) this.takeRestart(events);
      return;
    }
    this.stats[att.index].possession += DT;

    this.handleHuman(intents, context, events);
    if (this.phase === 'transition') {
      // Arcade: the break is swum faster, so most attacks get to the set play with time left.
      for (const s of this.movers) s.speedPenalty *= this.m.transicion.velocidad;
      if (this.time >= this.nextMarking) this.assignAllMarks();
      this.transitionTargets();
      this.checkSettle(events);
    } else {
      this.positionalTargets();
      this.stepDrives(events);
      this.updateCentre(events);
    }
    this.keepOutOfGoalArea();
    this.humanDefence(events);
    if (this.phase !== 'transition' && this.phase !== 'positional') return;
    this.aiContacts(events);
    if (this.phase !== 'transition' && this.phase !== 'positional') return;
    this.checkGoalArea(events);
    if (this.phase !== 'transition' && this.phase !== 'positional') return;
    this.aiAttack(events);
    if (this.charging) this.updateCharging(pad, events);
    this.checkSteal(events);
  }

  /** The break: forwards go deep in their lanes, defenders sprint back inside their men. */
  private transitionTargets(): void {
    const att = this.attackingSide;
    const def = this.defendingSide;
    if (!att || !def) return;
    const goal = att.attacks;
    const tr = this.m.transicion;
    const holder = this.ball.holder;
    const ballDistance = toGoal(goal, this.ball.pos).distance;
    // First wave: only the two most advanced attackers ahead of the ball go deep to the posts.
    const firstWave = new Set(
      att.field
        .filter((a) => a !== holder && toGoal(goal, a.pos).distance < ballDistance - 1)
        .sort((a, b) => toGoal(goal, a.pos).distance - toGoal(goal, b.pos).distance)
        .slice(0, tr.primeraOleada),
    );
    for (const a of att.field) {
      a.rise = a === this.charging?.shooter ? a.rise : Math.max(0, a.rise - DT * 2.5);
      if (a === holder) {
        this.holderMove(a, true);
        continue;
      }
      const flight = this.ball.flight;
      if (flight?.kind === 'pass' && flight.receiver === a) {
        a.target = { x: flight.to.x, y: flight.to.y };
        a.speedScale = 1;
        continue;
      }
      if (this.chaseLoose(a)) continue;
      const here = toGoal(goal, a.pos);
      if (firstWave.has(a)) {
        // First wave: straight down the lane to the post.
        a.target = fromGoal(goal, tr.profundidad, clamp(here.lateral, -tr.carrilMax, tr.carrilMax));
      } else {
        a.target = this.slotAt(a.slot ?? 'cierre', att);
      }
      a.speedScale = 1;
      a.desiredFacing = angleTo(a.pos, a.target);
    }
    for (const d of def.field) {
      this.updateArm(d);
      if (this.chaseLoose(d)) continue;
      const flight = this.ball.flight;
      if (flight?.kind === 'pass' && flight.interceptor === d) {
        d.target = { x: flight.from.x + (flight.to.x - flight.from.x) * flight.endAt, y: flight.from.y + (flight.to.y - flight.from.y) * flight.endAt };
        d.speedScale = 1.3;
        continue;
      }
      const m = d.mark;
      if (m) {
        const ahead = { x: m.pos.x + m.vel.x * 0.3, y: m.pos.y + m.vel.y * 0.3 };
        d.target = insidePoint(ahead, goal, this.t.defensa.distancia);
        d.speedScale = dist(d.pos, d.target) > 2 ? 1 : 0.85;
      } else {
        d.target = fromGoal(goal, 3.5, 0);
        d.speedScale = 0.9;
      }
      d.desiredFacing = angleTo(d.pos, m ? m.pos : this.ball.pos);
    }
  }

  /** Set attack (F2): slots, inside-water marking, the centre's fight. */
  private positionalTargets(): void {
    const att = this.attackingSide;
    const def = this.defendingSide;
    if (!att || !def) return;
    const holder = this.ball.holder;
    const ballXY = { x: this.ball.pos.x, y: this.ball.pos.y };
    const flight = this.ball.flight?.kind === 'pass' ? this.ball.flight : null;
    for (const a of att.field) {
      if (a !== this.charging?.shooter) a.rise = Math.max(0, a.rise - DT * 2.5);
      a.struggle = Math.max(0, a.struggle - DT * 3);
      if (a === holder) {
        this.holderMove(a, false);
        continue;
      }
      if (this.chaseLoose(a)) continue;
      if (flight && flight.receiver === a && !this.drives.has(a)) {
        a.target = { x: flight.to.x, y: flight.to.y };
        a.speedScale = 0.9;
      } else if (!this.drives.has(a)) {
        this.zoneTarget(a, att, holder);
      }
      if (!this.drives.has(a)) a.desiredFacing = angleTo(a.pos, ballXY);
    }
    const driveDefenders = new Set([...this.drives.values()].map((d) => d.defender));
    const short = this.zones.size > 0;
    // Short-handed, the defender whose zone is nearest to the ball steps out to it.
    this.presser = null;
    if (short && holder && holder.team === att.index && !holder.keeper) {
      let best = this.m.superioridad.alcancePresion;
      for (const [d, z] of this.zones) {
        const distance = dist(fromGoal(att.attacks, z.x, z.y), holder.pos);
        if (distance < best) {
          best = distance;
          this.presser = d;
        }
      }
    }
    for (const d of def.field) {
      this.updateArm(d);
      d.struggle = Math.max(0, d.struggle - DT * 3);
      if (this.chaseLoose(d)) continue;
      if (flight && flight.interceptor === d) {
        d.target = { x: flight.from.x + (flight.to.x - flight.from.x) * flight.endAt, y: flight.from.y + (flight.to.y - flight.from.y) * flight.endAt };
        d.speedScale = 1.3;
      } else if (short && this.zones.has(d)) {
        this.zoneDefence(d, att, holder, ballXY);
      } else if (!driveDefenders.has(d)) {
        this.markTarget(d, att.attacks, def.defenseStyle, holder, ballXY);
      }
    }
  }

  /**
   * Inferiority (GDD §9): hold the zone, lean towards the ball, cover the posts; the one nearest
   * to the ball goes out to it with the arm ready.
   */
  private zoneDefence(d: Swimmer, att: Side, holder: Swimmer | null, ballXY: Vec2): void {
    const goal = att.attacks;
    const z = this.zones.get(d) as Vec2;
    const sup = this.m.superioridad;
    const home = fromGoal(goal, z.x, z.y);
    const towards = { x: (ballXY.x - home.x) * sup.desplazamiento, y: (ballXY.y - home.y) * sup.desplazamiento };
    const shift = Math.hypot(towards.x, towards.y);
    let target = shift > 1.2 ? add(home, norm(towards), 1.2) : add(home, towards, 1);
    if (d === this.presser && holder) {
      target = insidePoint(holder.pos, goal, sup.distanciaPresion);
      d.mark = holder;
    } else {
      // Nearest attacker to the zone, for steals and the arm.
      let nearest: Swimmer | null = null;
      for (const a of att.field) if (!nearest || dist(a.pos, target) < dist(nearest.pos, target)) nearest = a;
      d.mark = nearest;
    }
    d.target = target;
    d.speedScale = 0.95;
    d.desiredFacing = angleTo(d.pos, ballXY);
  }

  /**
   * Loose ball: the nearest defender goes for it; the attacking team crashes the rebound with
   * its two nearest players.
   */
  private chaseLoose(s: Swimmer): boolean {
    if (!this.ball.free || this.ball.dead) return false;
    const team = this.sides[s.team].field;
    const chasers = s.team === this.possession ? this.m.suelto.atacantes : 1;
    const ranked = [...team].sort((a, b) => dist(a.pos, this.ball.pos) - dist(b.pos, this.ball.pos));
    if (!ranked.slice(0, chasers).includes(s)) return false;
    s.target = { x: this.ball.pos.x + this.ball.vel.x * 0.3, y: this.ball.pos.y + this.ball.vel.y * 0.3 };
    s.speedScale = this.t.suelto.persecucion;
    s.desiredFacing = angleTo(s.pos, s.target);
    return true;
  }

  private holderMove(a: Swimmer, breaking: boolean): void {
    a.holdTime += DT;
    const goal = this.sides[a.team].attacks;
    if (this.time < a.burstUntil) {
      a.target = add(a.pos, a.burstDir, 1.5);
      a.speedScale = this.t.escapada.impulso / a.topSpeed;
    } else if (this.sides[a.team].human && this.carrySwim && !this.charging) {
      a.target = add(a.pos, this.carrySwim, 2);
      a.speedScale = this.m.transicion.conBalon;
      a.desiredFacing = Math.atan2(this.carrySwim.y, this.carrySwim.x);
      return;
    } else if (breaking && !this.sides[a.team].human && !a.keeper && this.mustPass !== a) {
      // AI on the break: down its lane towards the 5 m.
      const here = toGoal(goal, a.pos);
      const tr = this.m.transicion;
      a.target = fromGoal(goal, Math.max(4.5, here.distance - 3), clamp(here.lateral, -tr.carrilMax, tr.carrilMax));
      a.speedScale = tr.conBalon;
    } else {
      a.target = { ...a.pos };
      a.speedScale = 0.3;
    }
    const best = this.preview?.best;
    a.desiredFacing = this.charging ? angleTo(a.pos, goal) : best ? angleTo(a.pos, best.point) : breaking ? angleTo(a.pos, a.target) : angleTo(a.pos, goal);
  }

  private zoneTarget(a: Swimmer, side: Side, holder: Swimmer | null): void {
    let target = this.slotAt(a.slot ?? 'cierre', side);
    const defender = this.defenderOf(a);
    if (holder && holder.team === a.team && defender) {
      const lane = toSegment(defender.pos, holder.pos, a.pos);
      if (lane.distance < 0.6 && lane.t > 0.3) {
        const across = norm({ x: -(a.pos.y - holder.pos.y), y: a.pos.x - holder.pos.x });
        const side = dot(across, dir(defender.pos, a.pos)) >= 0 ? 1 : -1;
        target = add(target, across, side * this.t.zona.abrirLinea);
      }
    }
    a.target = target;
    // Far from the spot (just settled): swim there; once there, small moves.
    a.speedScale = dist(a.pos, target) > this.m.transicion.lejosDelPuesto ? 1 : this.t.nado.zona;
  }

  private markTarget(d: Swimmer, goal: Goal, style: DefenseStyle, holder: Swimmer | null, ballXY: Vec2): void {
    const m = d.mark;
    const t = this.t.defensa;
    d.speedScale = 0.85;
    if (!m) {
      d.target = fromGoal(goal, 3.5, 0);
      return;
    }
    d.desiredFacing = angleTo(d.pos, m.pos);
    const boya = this.boya;
    if (m === boya && m !== holder) {
      const distance = this.t.boya.distanciaDefensor;
      const behind = dir(m.pos, goal);
      const front = dir(m.pos, ballXY);
      let side = norm({ x: -front.y, y: front.x });
      if (dot(side, dir(m.pos, d.pos)) < 0) side = { x: -side.x, y: -side.y };
      const blend = norm(this.post >= 0 ? lerp2(side, behind, this.post) : lerp2(side, front, -this.post));
      const current = Math.atan2(d.pos.y - m.pos.y, d.pos.x - m.pos.x);
      let delta = Math.atan2(blend.y, blend.x) - current;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      const angle = current + clamp(delta, -0.9, 0.9);
      d.target = { x: m.pos.x + Math.cos(angle) * distance, y: m.pos.y + Math.sin(angle) * distance };
      return;
    }
    let target = insidePoint(m.pos, goal, m === holder ? t.distanciaPoseedor : t.distancia);
    const sag = style === 'zone' ? t.hundimiento.zona : t.hundimiento.presion;
    const perimeter = m.slot === 'lateralIzq' || m.slot === 'lateralDer' || m.slot === 'cierre';
    if (boya && m !== holder && perimeter && sag > 0) target = lerp2(target, add(boya.pos, dir(boya.pos, ballXY), 1.2), sag);
    d.target = target;
    if (dist(d.pos, target) > this.m.transicion.lejosDelPuesto) d.speedScale = 1;
  }

  private updateArm(d: Swimmer): void {
    const c = this.charging;
    let up = false;
    if (c && c.shooter.team !== d.team) {
      const shooter = c.shooter;
      const goal = this.sides[shooter.team].attacks;
      const inFront = dot(dir(shooter.pos, d.pos), dir(shooter.pos, goal)) > 0.2;
      up = d.mark === shooter || (inFront && dist(d.pos, shooter.pos) < this.t.defensa.brazo.distancia);
    }
    // Short-handed, the one on the ball keeps the arm up against a shooter within range.
    const holder = this.ball.holder;
    if (!up && d === this.presser && holder && toGoal(this.sides[holder.team].attacks, holder.pos).distance < 7.5) up = true;
    if (d === this.selected && this.time < this.human.blockUntil) {
      d.armUp = 1;
      d.rise = 0.4;
      return;
    }
    const rate = lerp(this.t.defensa.brazo.subida.min, this.t.defensa.brazo.subida.max, barFactor(d.player.stats.defense));
    d.armUp = clamp(d.armUp + (up ? rate : -3) * DT, 0, 1);
    d.rise = d.armUp * 0.4;
  }

  /** Transition → set attack once the attack settles (GDD §4). A break with an extra man stays a break. */
  private checkSettle(events: MatchEvent[]): void {
    const att = this.attackingSide;
    const def = this.defendingSide;
    const holder = this.ball.holder;
    if (!att || !def) return;
    if (!holder || holder.keeper || this.ball.flight || this.ball.free) {
      this.settleSince = -1;
      return;
    }
    const tr = this.m.transicion;
    const goal = att.attacks;
    const distance = toGoal(goal, this.ball.pos).distance;
    if (distance < this.setup.field.length / 2 && this.crossedHalfAt < 0) this.crossedHalfAt = this.time;
    // More attackers than defenders ahead of the ball keeps it a break (GDD §4); it is announced
    // ("¡CONTRA 2x1!") once somebody within shooting range is really free.
    const raw = countAdvantage(att.field, def.field, this.ball.pos, goal, tr.ventajaDesde, 0);
    if (raw && (this.advantageSince < 0 || this.time - this.advantageSince < tr.maxVentaja)) {
      if (this.advantageSince < 0) this.advantageSince = this.time;
      const free = countAdvantage(att.field, def.field, this.ball.pos, goal, tr.ventajaDesde, tr.libre);
      if (free && !this.advantage && this.time - this.advantageSince >= tr.ventajaMinima) {
        this.advantage = free;
        if (this.time - this.advantageEndedAt > 1) {
          this.stats[att.index].counterattacks++;
          events.push({ type: 'advantage', attackers: free.attackers, defenders: free.defenders });
        }
      } else if (this.advantage && free) this.advantage = free;
      this.settleSince = -1;
      return;
    }
    if (this.advantage) this.advantageEndedAt = this.time;
    if (!raw) this.advantageSince = -1;
    this.advantage = null;
    const close = distance < tr.distanciaPosicional;
    const long = this.crossedHalfAt >= 0 && this.time - this.crossedHalfAt >= tr.segundosTrasMedio;
    const settled = distance < this.setup.field.length / 2 && defenceSettled(def.field, tr.llegada);
    if (close || long || settled) {
      if (this.settleSince < 0) this.settleSince = this.time;
      if (this.time - this.settleSince >= tr.estable) {
        this.setPhase('positional', events);
        this.assignSlots(att.field);
        this.assignAllMarks();
        this.drives.clear();
        this.post = 0;
        this.settleSince = -1;
      }
    } else {
      this.settleSince = -1;
    }
  }

  // ------------------------------------------------------------------------------------------
  // The human: attack and defence
  // ------------------------------------------------------------------------------------------

  private worldAim(x: number, y: number): Vec2 {
    return norm({ x, y: y / this.setup.tilt });
  }

  private handleHuman(intents: MatchIntent[], context: ControlContext, events: MatchEvent[]): void {
    const att = this.attackingSide;
    const holder = this.ball.holder && this.sides[this.ball.holder.team].human ? this.ball.holder : null;
    for (const intent of intents) {
      switch (intent.type) {
        case 'aim':
          if (holder && !this.charging) {
            this.preview = choosePass(this.passWorld(holder), this.worldAim(intent.x, intent.y), this.previewTarget, this.t.pase);
            this.previewTarget = this.preview.best?.receiver ?? null;
          } else this.preview = null;
          break;
        case 'aimClear':
          this.preview = null;
          this.previewTarget = null;
          break;
        case 'pass':
        case 'tap':
          if (context === 'defend') {
            if (intent.type === 'tap') this.switchDefender(this.worldAim(intent.x, intent.y), events);
          } else if (holder && !this.charging) {
            this.passFrom(holder, this.worldAim(intent.x, intent.y), events);
          } else if (this.incomingFor(true)) {
            this.buffer = { kind: 'pass', aim: this.worldAim(intent.x, intent.y), at: this.time };
          }
          this.preview = null;
          break;
        case 'select':
          this.selection = holder && att ? this.selectFor(holder, this.worldAim(intent.x, intent.y)) : null;
          break;
        case 'selectClear':
          this.selection = null;
          break;
        case 'order':
          if (holder) this.order(holder, this.worldAim(intent.x, intent.y), events);
          this.selection = null;
          break;
        case 'skill':
          if (holder && !this.charging) this.skill(holder, events);
          break;
        case 'skillTap':
          if (context === 'carry' && holder && !this.charging) this.skill(holder, events);
          else if (context === 'defend') this.defenceSkill(events);
          break;
        case 'shotStart':
          if (holder && !holder.keeper) this.startCharge(holder, null, events);
          else if (this.incomingFor(true)) this.buffer = { kind: 'shot', at: this.time, released: null };
          break;
        case 'shotRelease':
          if (this.charging && this.sides[this.charging.shooter.team].human) this.releaseShot(events);
          else if (this.buffer?.kind === 'shot' && this.buffer.released === null) this.buffer.released = this.time;
          break;
        case 'swim':
          if (context === 'carry') this.carrySwim = this.worldAim(intent.x, intent.y);
          else if (context === 'defend') this.human.swim = this.worldAim(intent.x, intent.y);
          break;
        case 'swimStop':
          this.carrySwim = null;
          this.human.swim = null;
          break;
        case 'contactStart':
          this.startContact(events);
          break;
        case 'contactEnd':
          if (this.human.contact) {
            this.human.contact.held = false;
            this.human.contact.until = Math.min(this.human.contact.until, this.time);
          }
          break;
        case 'skillPress':
          break;
      }
    }
    if (context !== 'carry') this.carrySwim = null;
    if (context !== 'defend') this.human.swim = null;
  }

  private incomingFor(human: boolean): boolean {
    const flight = this.ball.flight;
    return flight !== null && flight.kind === 'pass' && this.sides[flight.receiver.team].human === human;
  }

  /** Which of our players the human controls in defence, and what they do with it. */
  private humanDefence(events: MatchEvent[]): void {
    const our = this.sides.find((s) => s.human);
    if (!our || this.input.current !== 'defend') {
      this.human.contact = null;
      return;
    }
    const h = this.human;
    const holder = this.ball.holder;
    if (holder !== this.lastHolder) {
      this.lastHolder = holder;
      h.manual = false;
    }
    // Auto: in a set defence, the one marking the ball; otherwise the nearest to the ball.
    if (!this.selected || this.selected.team !== our.index || (this.setup.autoSwitch && !h.manual && !h.swim)) {
      const marker = holder && holder.team !== our.index && this.phase === 'positional' ? our.field.find((d) => d.mark === holder) : undefined;
      const next = marker ?? our.field.reduce((best, s) => (dist(s.pos, this.ball.pos) < dist(best.pos, this.ball.pos) ? s : best));
      if (next !== this.selected) {
        this.selected = next;
        events.push({ type: 'switch', to: next });
      }
    }
    const sel = this.selected;
    if (!sel) return;
    if (h.swim) {
      if (this.phase === 'positional' && !this.ball.free) {
        // A nudge from where the AI would put them: help, float on the centre, close a lane.
        sel.target = add(sel.target, h.swim, this.m.defensa.empujon);
        sel.speedScale = 0.95;
      } else {
        sel.target = add(sel.pos, h.swim, 2);
        sel.speedScale = 1;
      }
      sel.desiredFacing = Math.atan2(h.swim.y, h.swim.x);
    }
    const d = this.m.defensa;
    if (this.time < h.burstUntil) sel.speedPenalty *= d.aceleron.factor;
    if (this.time < h.beatenUntil) sel.speedPenalty *= 0.5;
    if (this.time < h.anticipateUntil) sel.anticipation = 1;
    const c = h.contact;
    if (c) {
      if (c.held && this.time - c.start > d.contacto.toqueMs / 1000) c.until = Math.max(c.until, Math.min(this.time + DT, c.start + d.contacto.segundosFuerte));
      const strong = c.held && this.time - c.start > d.contacto.toqueMs / 1000;
      if (this.time > c.until || dist(sel.pos, c.on.pos) > d.contacto.distancia + 0.6) {
        h.contact = null;
      } else if (this.judgeHumanContact(sel, c, strong, events)) {
        // Whistled: the play has stopped.
        h.contact = null;
        return;
      } else {
        c.on.speedPenalty *= strong ? d.contacto.fuerte : d.contacto.leve;
        c.on.contactPressure = Math.max(c.on.contactPressure, d.contacto.presion * (strong ? 1 : 0.5));
        sel.speedPenalty *= 0.8;
        sel.struggle = 1;
        c.on.struggle = 1;
        sel.target = { ...c.on.pos };
        if (strong && c.on === this.ball.holder && !this.charging && this.setup.rng.chance(d.contacto.perdida * DT)) {
          // Wrestled off the ball: it squirts loose.
          const holderNow = c.on;
          this.ball.holder = null;
          holderNow.holdTime = -1;
          this.ball.free = true;
          this.ball.vel = { x: this.setup.rng.range(-1.5, 1.5), y: this.setup.rng.range(-1.5, 1.5), z: 0.5 };
          this.ball.lastTouch = holderNow;
          events.push({ type: 'splash', at: { ...holderNow.pos }, strength: 0.4 });
        }
      }
    }
  }

  private switchDefender(aim: Vec2, events: MatchEvent[]): void {
    const our = this.sides.find((s) => s.human);
    const from = this.selected;
    if (!our || !from) return;
    let best: Swimmer | null = null;
    let bestCost = Infinity;
    for (const s of our.field) {
      if (s === from) continue;
      const error = (Math.acos(clamp(dot(aim, dir(from.pos, s.pos)), -1, 1)) * 180) / Math.PI;
      if (error > this.m.defensa.cambioCono) continue;
      const cost = error + 4 * dist(from.pos, s.pos);
      if (cost < bestCost) {
        bestCost = cost;
        best = s;
      }
    }
    if (!best) {
      events.push({ type: 'noReceiver', at: { ...from.pos } });
      return;
    }
    this.selected = best;
    this.human.manual = true;
    this.human.contact = null;
    events.push({ type: 'switch', to: best });
  }

  /** HABILIDAD in defence: burst on the break; steal, block or read the lane in a set defence. */
  private defenceSkill(events: MatchEvent[]): void {
    const sel = this.selected;
    if (!sel) return;
    const h = this.human;
    const d = this.m.defensa;
    const holder = this.ball.holder;
    if (this.phase === 'transition' || this.ball.free) {
      if (this.time < h.burstReady) return;
      h.burstUntil = this.time + d.aceleron.duracion;
      h.burstReady = this.time + d.aceleron.enfriamiento;
      events.push({ type: 'burst', who: sel });
      return;
    }
    if (holder && holder.team !== sel.team && !holder.keeper && dist(sel.pos, holder.pos) < d.robo.distancia) {
      if (this.time < h.stealReady) return;
      h.stealReady = this.time + d.robo.enfriamiento;
      let p = d.robo.base + d.robo.escala * sigmoid(d.robo.pendiente * (barFactor(sel.player.stats.defense) - barFactor(holder.player.stats.skill)));
      if (this.time < holder.protectUntil) p *= 0.3;
      const won = this.setup.rng.chance(p);
      events.push({ type: 'stealTry', by: sel, won });
      if (won) this.steal(sel, holder, events);
      else {
        // Missed: left behind, and the attacker gets away.
        h.beatenUntil = this.time + d.robo.castigo;
        holder.protectUntil = this.time + 0.6;
      }
      return;
    }
    const c = this.charging;
    if (c && c.shooter.team !== sel.team && dist(sel.pos, c.shooter.pos) < d.bloqueo.distancia) {
      h.blockUntil = this.time + d.bloqueo.duracion;
      return;
    }
    if (this.time < h.anticipateReady) return;
    h.anticipateUntil = this.time + d.anticipacion.duracion;
    h.anticipateReady = this.time + d.anticipacion.enfriamiento;
    events.push({ type: 'anticipate', by: sel });
  }

  /** TIRO in defence: contact with the nearest attacker (sanctions arrive in F4). */
  private startContact(events: MatchEvent[]): void {
    const sel = this.selected;
    if (!sel) return;
    const rivals = this.sides[(1 - sel.team) as TeamSide].field;
    const holder = this.ball.holder;
    let target: Swimmer | null = null;
    for (const r of rivals) {
      const d = dist(r.pos, sel.pos);
      if (d > this.m.defensa.contacto.distancia) continue;
      if (!target || r === holder || (target !== holder && d < dist(target.pos, sel.pos))) target = r;
    }
    if (!target) return;
    this.human.contact = {
      on: target,
      start: this.time,
      held: true,
      until: this.time + this.m.defensa.contacto.segundosLeve,
      checks: 0,
      nextCheck: this.time + this.m.defensa.contacto.toqueMs / 1000,
      urgent: false,
    };
    events.push({ type: 'contact', by: sel, on: target, strong: false });
  }

  /**
   * The referee looks at the human's contact: when it turns out to be a touch or a hold, again
   * every so often while it lasts, and at once if the victim is about to receive or to shoot.
   * Returns true when it was whistled.
   */
  private judgeHumanContact(sel: Swimmer, c: NonNullable<HumanDefence['contact']>, strong: boolean, events: MatchEvent[]): boolean {
    const f = this.m.faltas.humano;
    const flight = this.ball.flight;
    const urgent = !c.urgent && ((flight?.kind === 'pass' && flight.receiver === c.on) || this.charging?.shooter === c.on);
    if (urgent) c.urgent = true;
    if (!urgent && (this.time < c.nextCheck || c.checks >= 3)) return false;
    c.checks++;
    c.nextCheck = this.time + f.revision;
    const a = barFactor(sel.player.stats.aggression);
    const held = Math.min(this.time - c.start, this.m.defensa.contacto.segundosFuerte);
    const intensity = strong ? f.fuerte + f.fuertePorSegundo * held + f.fuertePorAgresividad * a : f.toque + f.toquePorAgresividad * a;
    const hasBall = this.ball.holder === c.on;
    const behind = this.isBehind(sel, c.on);
    const kind: ContactKind = hasBall ? 'hold' : behind ? 'pullBack' : strong ? 'sink' : 'grab';
    return this.contactFoul(sel, c.on, kind, clamp(intensity, 0, 1), events);
  }

  // ------------------------------------------------------------------------------------------
  // The AI with the ball
  // ------------------------------------------------------------------------------------------

  private aiAttack(events: MatchEvent[]): void {
    const att = this.attackingSide;
    const holder = this.ball.holder;
    if (!att || !holder || holder.team !== att.index || this.charging) return;
    const humanHolder = att.human;
    // A human side only gets help from the AI with its keeper (if the player waits) and slow throws.
    if (humanHolder) {
      const waiting = holder.keeper && this.time - this.keeperHeldSince >= this.m.portero.esperaHumano;
      if (!waiting) return;
    }
    const keeper = this.sides[(1 - att.index) as TeamSide].keeperBody;
    const action: BrainAction = att.brain.decide({
      time: this.time,
      phase: this.phase === 'positional' ? 'positional' : 'transition',
      holder,
      world: this.passWorld(holder),
      goal: att.attacks,
      shotClock: this.shotClock,
      drivesActive: this.drives.size,
      keeperU: keeper.u,
      goalChance: (s) => this.goalChance(s),
      advantage: this.advantage !== null,
      mustPass: this.mustPass === holder || holder.keeper,
      directShot: this.noShot === holder && this.time < this.directUntil,
      manUp: this.manUpOf(att) > 0,
    });
    switch (action.type) {
      case 'pass':
        this.launchPass(holder, action.to, events);
        break;
      case 'shoot':
        this.startCharge(holder, { hold: action.hold, side: action.side, mode: action.mode }, events);
        break;
      case 'drive':
        if (action.driver === this.boya) this.fight(action.driver, events);
        else this.orderDrive(action.driver, events);
        break;
      case 'none':
        break;
    }
  }

  /** Estimated chance that a shot by this player right now is a goal (what the AI weighs up). */
  goalChance(shooter: Swimmer): number {
    const team = shooter.team;
    const goal = this.sides[team].attacks;
    const keeper = this.sides[(1 - team) as TeamSide].keeperBody;
    const shotT = this.setup.shot;
    const b = this.t.boya.presion;
    const pressure = shooter === this.boya ? lerp(b.rosca.perdida, b.rosca.ganada, (this.post + 1) / 2) : Math.max(this.shotPressure(shooter), shooter.contactPressure);
    const samples = this.m.ia.muestrasTiro;
    let sum = 0;
    for (let i = 0; i < samples; i++) {
      const plan = planShot(
        { from: shooter.pos, releaseHeight: 0.8, charge: shotT.zonaOptimaCentro, side: keeper.u > 0 ? -1 : 1, mode: 'direct', pressure },
        { power: shooter.player.stats.power, accuracy: shooter.player.stats.accuracy, energy: 1 },
        goal,
        keeper.u,
        this.xg,
        shotT,
      );
      if (plan.landing === 'onTarget') sum += 1 - estimateSave(plan, keeper.profile, { u: keeper.u, set: 1 }, 'open', this.setup.keeperTuning).probability;
      else if (plan.landing === 'post' || plan.landing === 'bar') sum += shotT.paloYDentro * 0.5;
    }
    return sum / samples;
  }

  // ------------------------------------------------------------------------------------------
  // Passing, drives and the centre (shared by the human and the AI)
  // ------------------------------------------------------------------------------------------

  passWorld(holder: Swimmer): PassWorld {
    const side = this.sides[holder.team];
    const other = this.sides[(1 - holder.team) as TeamSide];
    const drives = new Map<Swimmer, DriveInfo>();
    for (const drive of this.drives.values()) {
      if (drive.driver.team !== holder.team) continue;
      drives.set(drive.driver, { destination: drive.destination, free: drive.phase === 'free', speed: drive.driver.topSpeed * this.t.entrada.velocidad });
    }
    return {
      holder,
      from: { ...this.ball.pos },
      teammates: [...side.field, side.keeper].filter((s) => s !== holder),
      defenders: other.field,
      goal: side.attacks,
      drives,
      boya: this.boya?.team === holder.team ? this.boya : null,
      post: this.post,
      // On the break the defenders are swimming back: they react later to a pass (shown and rolled alike).
      reactionExtra: this.phase === 'transition' ? this.m.transicion.reaccionPase : 0,
    };
  }

  private passFrom(holder: Swimmer, aim: Vec2, events: MatchEvent[]): void {
    const choice = choosePass(this.passWorld(holder), aim, this.previewTarget, this.t.pase);
    this.previewTarget = null;
    if (!choice.best) {
      events.push({ type: 'noReceiver', at: { ...holder.pos } });
      return;
    }
    this.launchPass(holder, choice.best, events);
  }

  private launchPass(holder: Swimmer, c: PassCandidate, events: MatchEvent[]): void {
    const rng = this.setup.rng;
    const t = this.t.pase;
    const from = { ...this.ball.pos };
    let interceptor: Swimmer | null = null;
    let endAt = 1;
    for (const share of c.shares) {
      if (rng.chance(share.risk)) {
        interceptor = share.defender;
        endAt = share.s;
        break;
      }
    }
    const sigma = lerp(t.error.max, t.error.min, barFactor(holder.player.stats.passing)) * Math.pow(Math.max(1, c.distance) / 6, 0.8);
    const across = norm({ x: -(c.point.y - from.y), y: c.point.x - from.x });
    const error = interceptor ? 0 : rng.gauss() * sigma;
    const to = { x: c.point.x + across.x * error, y: c.point.y + across.y * error, z: c.endZ };
    this.ball.flight = {
      kind: 'pass',
      type: c.type,
      passer: holder,
      receiver: c.receiver,
      from,
      to,
      arc: c.arc,
      duration: Math.max(0.08, dist(from, to) / c.speed),
      t: 0,
      interceptor,
      endAt,
    };
    this.ball.holder = null;
    this.ball.lastTouch = holder;
    holder.holdTime = -1;
    if (holder.keeper) this.sides[holder.team].keeperBody.holding = false;
    if (this.mustPass === holder) this.mustPass = null;
    if (this.noShot === holder) this.noShot = null;
    this.sides[holder.team].brain.passedBy(holder);
    events.push({ type: 'pass', passer: holder, receiver: c.receiver, passType: c.type, risk: c.risk, intercepted: interceptor !== null });
    // The ball is going into the centre: his defender holds on (the classic exclusion).
    const boya = this.boya;
    if (!interceptor && c.receiver === boya) {
      const defender = this.defenderOf(boya);
      if (defender && this.aiFouls(defender)) {
        const kind: ContactKind = this.post > 0.3 ? (this.fouls.chance(0.5) ? 'pullBack' : 'sink') : 'grab';
        this.maybeFoul(defender, boya, kind, this.m.faltas.boyaPase * (this.post > 0.3 ? 1.4 : 0.8), events);
      }
    }
  }

  private selectFor(holder: Swimmer, aim: Vec2): Selection | null {
    const swimmer = chooseDriver(this.passWorld(holder), aim, this.t.pase);
    if (!swimmer) return null;
    const goal = this.sides[holder.team].attacks;
    const destination = swimmer === this.boya ? null : driveDestination(swimmer, goal, this.sides[holder.team].field, this.t.entrada);
    return { swimmer, destination };
  }

  private order(holder: Swimmer, aim: Vec2, events: MatchEvent[]): void {
    if (this.phase !== 'positional') return;
    const side = this.sides[holder.team];
    if (this.manUpOf(side) > 0) {
      // With a man more, HABILIDAD + direction rotates the shape: 4-2 ⇄ 3-3 (GDD §9).
      side.rotated = !side.rotated;
      this.assignSlots(side.field);
      this.assignAllMarks();
      events.push({ type: 'rotation', shape: side.rotated ? '3-3' : '4-2' });
      return;
    }
    const target = chooseDriver(this.passWorld(holder), aim, this.t.pase);
    if (!target) {
      events.push({ type: 'noDrive', at: { ...holder.pos } });
      return;
    }
    if (target === this.boya) {
      this.fight(target, events);
      return;
    }
    if (this.drives.has(target) || this.drives.size >= this.t.entrada.maxSimultaneas) {
      events.push({ type: 'noDrive', at: { ...target.pos } });
      return;
    }
    this.orderDrive(target, events);
  }

  orderDrive(target: Swimmer, events: MatchEvent[] = []): Drive | null {
    if (this.drives.has(target) || this.phase !== 'positional') return null;
    const side = this.sides[target.team];
    const drive = startDrive(target, this.defenderOf(target), side.attacks, side.field, this.ball.pos, this.time, this.setup.rng, this.t.entrada);
    this.drives.set(target, drive);
    events.push({ type: 'driveStart', driver: target, destination: drive.destination });
    return drive;
  }

  private stepDrives(events: MatchEvent[]): void {
    const att = this.attackingSide;
    if (!att) return;
    for (const drive of [...this.drives.values()]) {
      const result = stepDrive(drive, att.attacks, this.time, this.t.entrada, this.t.defensa.distancia);
      if (result === 'free') {
        events.push({ type: 'driveFree', driver: drive.driver });
        // Beaten on the drive: the defender may grab him rather than let him go.
        const d = drive.defender;
        if (d && this.aiFouls(d) && dist(d.pos, drive.driver.pos) < this.m.defensa.contacto.distancia + 0.6) {
          this.maybeFoul(d, drive.driver, this.isBehind(d, drive.driver) ? 'pullBack' : 'grab', this.m.faltas.entrada, events);
          if (!LIVE.includes(this.phase)) return;
        }
      }
      else if (result) this.finishDrive(drive, result === 'end-free' ? 'free' : result === 'end-drag' ? 'drag' : 'fail', events);
    }
  }

  private finishDrive(drive: Drive, result: 'free' | 'drag' | 'fail', events: MatchEvent[]): void {
    this.drives.delete(drive.driver);
    events.push({ type: 'driveEnd', driver: drive.driver, result });
    this.reassignSlots();
  }

  /** After a drive or a rebound: the free slots are shared out again by who is nearest. */
  private reassignSlots(): void {
    const att = this.attackingSide;
    if (!att) return;
    const free = att.field.filter((a) => !this.drives.has(a));
    const slots = free.map((a) => a.slot).filter((x): x is Slot => x !== null);
    if (slots.length !== free.length || new Set(slots).size !== slots.length) {
      this.assignSlots(att.field);
      return;
    }
    const points = new Map(slots.map((x) => [x, this.slotAt(x, att)]));
    const result = assign(free, slots, (a, slot) => dist(a.pos, points.get(slot) as Vec2) + slotCost(a.player, slot));
    for (const [a, slot] of result) a.slot = slot;
  }

  private centreStrength(boya: Swimmer, defender: Swimmer | null): { attack: number; defence: number } {
    const attack = 0.8 * barFactor(boya.player.stats.skill) + 0.2;
    const defence = defender ? (barFactor(defender.player.stats.defense) + barFactor(defender.player.stats.aggression)) / 2 : 0;
    return { attack, defence };
  }

  private fight(boya: Swimmer, events: MatchEvent[] = []): void {
    if (this.postFight) return;
    const defender = this.defenderOf(boya);
    const { attack, defence } = this.centreStrength(boya, defender);
    const l = this.t.boya.lucha;
    this.postFight = { until: this.time + l.segundos, won: this.setup.rng.chance(sigmoid(l.pendiente * (attack - defence) + l.base)) };
    // Fighting for the spot, the centre may push off his defender: foul against the attack.
    if (defender) this.maybeFoul(boya, defender, 'push', this.m.faltas.empujonBoya, events);
  }

  private turnChance(boya: Swimmer): number {
    const { attack, defence } = this.centreStrength(boya, this.defenderOf(boya));
    const g = this.t.boya.giro;
    return sigmoid(g.pendiente * (attack - defence) + g.peso * this.post + g.base);
  }

  private skill(holder: Swimmer, events: MatchEvent[]): void {
    if (holder === this.boya) {
      if (!this.boyaTurn) {
        this.boyaTurn = { at: this.time + this.t.boya.giro.segundos, won: this.setup.rng.chance(this.turnChance(holder)), resolved: false };
        this.turnFoul(holder, events);
      }
      return;
    }
    if (this.time < holder.cooldownUntil) return;
    const e = this.t.escapada;
    const defender = this.defenderOf(holder);
    const goal = this.sides[holder.team].attacks;
    const away = defender ? dir(defender.pos, holder.pos) : dir(goal, holder.pos);
    holder.burstDir = norm(lerp2(away, dir(holder.pos, goal), 0.4));
    holder.burstUntil = this.time + e.duracion;
    holder.protectUntil = this.time + e.proteccion;
    holder.cooldownUntil = this.time + e.enfriamiento;
    holder.vel = add(holder.vel, holder.burstDir, e.impulso * 0.6);
    events.push({ type: 'escape', who: holder });
  }

  private updateCentre(events: MatchEvent[]): void {
    const boya = this.boya;
    if (!boya) return;
    const defender = this.defenderOf(boya);
    const b = this.t.boya;
    const { attack, defence } = this.centreStrength(boya, defender);
    this.post = clamp(this.post + (b.deriva * (attack - defence) - b.retorno * this.post) * DT + this.setup.rng.gauss() * b.ruido * Math.sqrt(DT), -1, 1);
    if (this.postFight) {
      boya.struggle = 1;
      if (defender) defender.struggle = 1;
      if (this.time >= this.postFight.until) {
        this.post = clamp(this.post + (this.postFight.won ? b.lucha.empuje : -b.lucha.castigo), -1, 1);
        events.push({ type: 'postFight', boya, won: this.postFight.won });
        this.postFight = null;
      }
    }
    const turn = this.boyaTurn;
    if (turn && !turn.resolved) {
      boya.struggle = 1;
      if (defender) defender.struggle = 1;
      if (this.time >= turn.at) {
        turn.resolved = true;
        events.push({ type: 'turn', boya, won: turn.won });
        this.post = turn.won ? 1 : Math.min(this.post, -0.2);
        if (!turn.won && !this.charging && this.ball.holder === boya && defender && this.setup.rng.chance(b.giro.robo)) {
          this.steal(defender, boya, events);
          return;
        }
        if (!this.charging) this.boyaTurn = null;
      }
    }
  }

  // ------------------------------------------------------------------------------------------
  // Shooting
  // ------------------------------------------------------------------------------------------

  private startCharge(holder: Swimmer, ai: MatchCharging['ai'], events: MatchEvent[]): void {
    if (this.charging || holder.keeper) return;
    // After a foul inside 6 m (or once the moment to shoot directly has gone) the ball must be passed.
    if (this.noShot === holder && this.time >= this.directUntil) {
      events.push({ type: 'mustPass', who: holder });
      return;
    }
    this.noShot = null;
    this.charging = { shooter: holder, time: 0, charge: 0, aim: ai ? { side: ai.side, mode: ai.mode } : { side: 0, mode: 'direct' }, ai };
    this.preview = null;
    this.selection = null;
    this.carrySwim = null;
    events.push({ type: 'chargeStart', who: holder });
    if (holder === this.boya && !this.boyaTurn) {
      this.boyaTurn = { at: this.time + this.t.boya.giro.segundos, won: this.setup.rng.chance(this.turnChance(holder)), resolved: false };
      this.turnFoul(holder, events);
      return;
    }
    // A shooter inside 6 m with a defender behind: he may be pulled back (penalty, WP 11.1.1.4).
    const goal = this.sides[holder.team].attacks;
    if (toGoal(goal, holder.pos).distance > this.setup.rules.campo.lineas.seisMetros) return;
    for (const d of this.sides[(1 - holder.team) as TeamSide].field) {
      if (dist(d.pos, holder.pos) > this.m.defensa.contacto.distancia || !this.isBehind(d, holder) || !this.aiFouls(d)) continue;
      this.maybeFoul(d, holder, 'pullBack', this.m.faltas.tiro, events);
      return;
    }
  }

  private updateCharging(pad: PadState, events: MatchEvent[]): void {
    const c = this.charging;
    if (!c) return;
    const t = this.setup.shot;
    const goal = this.sides[c.shooter.team].attacks;
    c.time += DT;
    c.charge = clamp(c.time / t.segundosCarga, 0, 1);
    c.shooter.rise = clamp(c.time / t.segundosSubida, 0, 1);
    c.shooter.desiredFacing = angleTo(c.shooter.pos, goal);
    c.shooter.target = { ...c.shooter.pos };
    if (c.ai) {
      if (c.time >= c.ai.hold) this.releaseShot(events);
      return;
    }
    c.aim = aimFromPad({ x: pad.x, y: pad.y }, goal) as Aim;
    if (c.time >= t.segundosMaximoCargado) this.releaseShot(events);
  }

  shotPressure(shooter: Swimmer): number {
    const p = this.t.defensa.presion;
    const goal = this.sides[shooter.team].attacks;
    const towardsGoal = dir(shooter.pos, goal);
    let pressure = 0;
    for (const d of this.sides[(1 - shooter.team) as TeamSide].field) {
      const distance = dist(d.pos, shooter.pos);
      if (distance > p.lejos) continue;
      const closeness = clamp(1 - (distance - p.cerca) / (p.lejos - p.cerca), 0, 1);
      const front = dot(dir(shooter.pos, d.pos), towardsGoal);
      pressure = Math.max(pressure, closeness * (front > 0.3 ? 1 : front > -0.3 ? 0.55 : 0.25));
    }
    // A defence a man short cannot close everybody down.
    if (this.manUpOf(this.sides[shooter.team]) > 0) pressure *= this.m.superioridad.presionTiro;
    return pressure;
  }

  private releaseShot(events: MatchEvent[]): void {
    const c = this.charging;
    if (!c) return;
    this.charging = null;
    const { shooter } = c;
    const team = shooter.team;
    const goal = this.sides[team].attacks;
    const keeper = this.sides[(1 - team) as TeamSide].keeperBody;
    const shotTuning = this.setup.shot;
    const quick = c.time < shotTuning.segundosTiroRapido;
    let pressure = Math.max(this.shotPressure(shooter), shooter.contactPressure);
    if (shooter === this.boya) {
      const b = this.t.boya.presion;
      pressure = quick ? lerp(b.rosca.perdida, b.rosca.ganada, (this.post + 1) / 2) : this.boyaTurn?.resolved && this.boyaTurn.won ? b.ganada : b.perdida;
    }
    this.boyaTurn = null;
    const rng = this.setup.rng;
    const plan = planShot(
      { from: { x: this.ball.pos.x, y: this.ball.pos.y }, releaseHeight: this.ball.pos.z, charge: quick ? null : c.charge, side: c.aim.side, mode: c.aim.mode, pressure },
      { power: shooter.player.stats.power, accuracy: shooter.player.stats.accuracy, energy: 1 },
      goal,
      keeper.u,
      rng,
      shotTuning,
    );
    this.stats[team].shots++;
    this.ball.holder = null;
    this.ball.lastTouch = shooter;
    shooter.holdTime = -1;
    this.drives.clear();
    events.push({ type: 'release', plan, who: shooter });

    const blocker = this.rollBlock(shooter, plan);
    if (blocker) {
      const back = dir(blocker.pos, shooter.pos);
      this.ball.pos = { x: blocker.pos.x + back.x * 0.35, y: blocker.pos.y + back.y * 0.35, z: 0.9 };
      this.ball.vel = { x: back.x * rng.range(1.5, 3) + rng.range(-1.5, 1.5), y: back.y * rng.range(1.5, 3) + rng.range(-1.5, 1.5), z: 2 };
      this.ball.free = true;
      this.ball.lastTouch = blocker;
      this.lastBlocker = blocker;
      this.afterShot = true;
      events.push({ type: 'block', by: blocker });
      return;
    }
    const result = resolveShot(plan, goal, keeper.profile, { u: keeper.u, set: clamp(c.time / 0.5, 0, 1) }, 'open', rng, shotTuning, this.setup.keeperTuning);
    this.ball.flight = { kind: 'shot', shooter, plan, outcome: result.outcome, save: result.save, t: 0, bounced: false };
    if (result.outcome.type === 'save') {
      keeper.hands = clamp(plan.arrival.v, 0.1, goal.height + 0.2);
      keeper.dive(plan.arrival.u, plan.flightTime, this.time);
    } else if (plan.landing === 'onTarget') {
      const short = clamp(-(result.save?.margin ?? -0.4), 0.2, 0.9);
      const direction = Math.sign(plan.arrival.u - keeper.u) || 1;
      keeper.hands = clamp(plan.arrival.v, 0.1, goal.height);
      keeper.dive(plan.arrival.u - direction * short, plan.flightTime, this.time);
    }
    const side = Math.sign(plan.arrival.u - keeper.u);
    if (plan.landing === 'onTarget') events.push({ type: 'dive', side: side === 0 ? 0 : side > 0 ? 1 : -1 });
  }

  private rollBlock(shooter: Swimmer, plan: ShotPlan): Swimmer | null {
    if (plan.mode === 'lob') return null;
    const b = this.t.defensa.bloqueo;
    const goal = this.sides[shooter.team].attacks;
    const aim = { x: goal.x, y: goal.y + plan.arrival.u };
    for (const d of this.sides[(1 - shooter.team) as TeamSide].field) {
      if (d.armUp < 0.05 || dist(d.pos, shooter.pos) > b.distancia) continue;
      const along = toSegment(d.pos, shooter.pos, aim);
      if (along.distance > b.pasillo || along.t <= 0) continue;
      let p = lerp(b.prob.min, b.prob.max, barFactor(d.player.stats.defense)) * d.armUp * (1 - along.distance / b.pasillo);
      if (plan.mode === 'skip') p *= b.factorBote;
      if (this.manUpOf(this.sides[shooter.team]) > 0) p *= this.m.superioridad.bloqueo;
      if (this.setup.rng.chance(p)) return d;
    }
    return null;
  }

  // ------------------------------------------------------------------------------------------
  // Ball
  // ------------------------------------------------------------------------------------------

  private placeBallInHand(s: Swimmer): void {
    if (s.keeper) {
      const body = this.sides[s.team].keeperBody;
      this.ball.pos = { x: body.position.x - body.goal.facing * 0.1, y: body.position.y, z: body.hands + 0.2 };
      return;
    }
    const hand = s.player.hand === 'left' ? -1 : 1;
    const fx = Math.cos(s.facing);
    const fy = Math.sin(s.facing);
    const heights = this.setup.shot.alturaSuelta;
    const back = 0.12 + 0.5 * s.rise;
    this.ball.pos.x = s.pos.x - fx * back - fy * 0.55 * hand;
    this.ball.pos.y = s.pos.y - fy * back + fx * 0.55 * hand;
    this.ball.pos.z = heights.rapido + (heights.cargado - heights.rapido) * s.rise;
  }

  private stepBall(events: MatchEvent[]): void {
    const ball = this.ball;
    ball.prev = { ...ball.pos };
    if (ball.holder) {
      this.placeBallInHand(ball.holder);
      return;
    }
    const flight = ball.flight;
    // The ball only travels while the game is on (not after the horn, nor during a celebration).
    if (flight && !LIVE.includes(this.phase) && this.phase !== 'setPiece') ball.flight = null;
    else if (flight?.kind === 'pass') {
      flight.t += DT;
      const s = Math.min(flight.endAt, flight.t / flight.duration);
      ball.pos.x = flight.from.x + (flight.to.x - flight.from.x) * s;
      ball.pos.y = flight.from.y + (flight.to.y - flight.from.y) * s;
      ball.pos.z = flight.from.z + (flight.to.z - flight.from.z) * s + flight.arc * 4 * s * (1 - s);
      if (s >= flight.endAt) this.arrivePass(events);
      return;
    }
    else if (flight?.kind === 'shot') {
      flight.t += DT;
      const goal = this.sides[flight.shooter.team].attacks;
      const s = clamp(flight.t / flight.plan.flightTime, 0, 1);
      ballAt(flight.plan, goal, s, this.setup.shot, ball.pos);
      const plan = flight.plan;
      if (!flight.bounced && plan.bounce && plan.bounceAt !== undefined && s >= plan.bounceAt) {
        flight.bounced = true;
        events.push({ type: 'bounce', at: plan.bounce, speed: plan.speed });
      }
      if (flight.t >= plan.flightTime) this.arriveShot(events);
      return;
    }
    if (ball.free) this.stepFreeBall(events);
  }

  private arrivePass(events: MatchEvent[]): void {
    const ball = this.ball;
    const flight = ball.flight;
    if (!flight || flight.kind !== 'pass') return;
    ball.flight = null;
    if (flight.interceptor) {
      events.push({ type: 'intercept', by: flight.interceptor });
      this.giveBall(flight.interceptor.team, flight.interceptor, 'intercept', events);
      this.setPhase('transition', events);
      return;
    }
    const receiver = flight.receiver;
    if (dist(receiver.pos, flight.to) <= this.t.pase.alcanceRecepcion || receiver.keeper) {
      this.catchBall(receiver, flight.type, events);
      return;
    }
    const along = dir(flight.from, flight.to);
    ball.free = true;
    ball.vel = { x: along.x * 1.2, y: along.y * 1.2, z: 0 };
    events.push({ type: 'splash', at: { x: ball.pos.x, y: ball.pos.y }, strength: 0.3 });
  }

  private catchBall(receiver: Swimmer, passType: 'dry' | 'wet' | 'lead' | 'long', events: MatchEvent[]): void {
    this.ball.holder = receiver;
    this.ball.free = false;
    this.ball.lastTouch = receiver;
    receiver.holdTime = 0;
    if (receiver.keeper) {
      this.sides[receiver.team].keeperBody.holding = true;
      this.keeperHeldSince = this.time;
    }
    for (const k of this.keepers) k.reroll(this.setup.rng);
    events.push({ type: 'catch', by: receiver, passType });
    const drive = this.drives.get(receiver);
    if (drive) this.finishDrive(drive, drive.phase === 'free' ? 'free' : 'fail', events);
    const buffered = this.buffer;
    this.buffer = null;
    if (!buffered || !this.sides[receiver.team].human || receiver.keeper) return;
    const windowS = this.t.control.bufferMs / 1000;
    if (buffered.kind === 'pass' && this.time - buffered.at <= windowS) this.passFrom(receiver, buffered.aim, events);
    else if (buffered.kind === 'shot') {
      if (buffered.released === null) this.startCharge(receiver, null, events);
      else if (this.time - buffered.released <= windowS) {
        this.startCharge(receiver, null, events);
        this.releaseShot(events);
      }
    }
  }

  private arriveShot(events: MatchEvent[]): void {
    const ball = this.ball;
    const flight = ball.flight;
    if (!flight || flight.kind !== 'shot') return;
    ball.flight = null;
    const { plan, outcome, shooter } = flight;
    const team = shooter.team;
    const goal = this.sides[team].attacks;
    const keeper = this.sides[(1 - team) as TeamSide].keeperBody;
    const rng = this.setup.rng;
    const dx = goal.x - plan.from.x;
    const dy = goal.y + plan.arrival.u - plan.from.y;
    const length = Math.hypot(dx, dy) || 1;
    const ux = dx / length;
    const uy = dy / length;
    const speed = plan.arrivalSpeed;
    ball.pos = { x: goal.x, y: goal.y + plan.arrival.u, z: plan.arrival.v };
    ball.free = true;
    events.push({ type: 'outcome', outcome, plan, save: flight.save });
    if (outcome.type !== 'miss') this.stats[team].onTarget += outcome.type === 'post' ? 0 : 1;

    switch (outcome.type) {
      case 'goal':
        ball.dead = true;
        ball.vel = { x: ux * speed * 0.45, y: uy * speed * 0.45, z: plan.mode === 'lob' ? -3 : 0.5 };
        if (outcome.viaPost) events.push({ type: 'frame', at: { ...ball.pos } });
        this.scoreGoal(team, shooter, events);
        break;
      case 'save':
        this.stats[(1 - team) as TeamSide].saves++;
        ball.lastTouch = keeper.swimmer;
        events.push({ type: 'splash', at: { x: goal.x - goal.facing * 0.3, y: goal.y + keeper.u }, strength: 0.9 });
        if (outcome.held) {
          this.giveBall(keeper.swimmer.team, keeper.swimmer, 'save', events);
          this.setPhase('transition', events);
        } else {
          const away = Math.sign(plan.arrival.u) || (rng.chance(0.5) ? 1 : -1);
          ball.vel = { x: -goal.facing * speed * rng.range(0.18, 0.32), y: away * rng.range(2, 4.5), z: rng.range(2, 4) };
          this.afterShot = true;
        }
        break;
      case 'post':
        this.afterShot = true;
        ball.vel = {
          x: -goal.facing * speed * rng.range(0.3, 0.5),
          y: Math.sign(plan.arrival.u || 1) * rng.range(0.5, 3) * (plan.landing === 'bar' ? rng.range(-1, 1) : 1),
          z: plan.landing === 'bar' ? rng.range(2, 4.5) : rng.range(0.5, 2),
        };
        events.push({ type: 'frame', at: { ...ball.pos } });
        break;
      case 'miss':
        ball.dead = true;
        ball.vel = { x: ux * speed * 0.8, y: uy * speed * 0.8, z: outcome.where === 'over' ? 1.5 : 0 };
        this.scheduleRestart('goalThrow', (1 - team) as TeamSide, ball.pos, 0.6);
        break;
    }
    if (this.periodEndPending && outcome.type !== 'goal' && outcome.type !== 'miss') this.endPeriod(events);
  }

  private scoreGoal(team: TeamSide, scorer: Swimmer | null, events: MatchEvent[]): void {
    this.score[team]++;
    this.stats[team].goals++;
    if (this.manUpOf(this.sides[team]) > 0) this.stats[team].manUpGoals++;
    // A call held for the advantage is forgotten: the goal was the advantage (WP 11.2.2).
    if (this.heldCall) {
      events.push({ type: 'advantagePlayed', on: this.heldCall.on });
      this.heldCall = null;
    }
    // A goal lets every excluded player back in, from anywhere (WP 10.5.2.2).
    for (const side of this.sides) this.endExclusions(side.index, 'goal', events);
    this.lastScorer = scorer;
    this.lastGoalSide = team;
    this.charging = null;
    this.drives.clear();
    this.ball.holder = null;
    this.ball.dead = true;
    this.phaseTimer = this.m.gol.celebracion;
    events.push({ type: 'goal', side: team, scorer, score: [this.score[0], this.score[1]] });
    this.setPhase('goal', events);
  }

  private scheduleRestart(kind: SetPieceKind, side: TeamSide, at: Vec2, delay: number): void {
    this.pendingRestart = { kind, side, at: this.time + delay, spot: { x: at.x, y: at.y } };
  }

  private takeRestart(events: MatchEvent[]): void {
    const r = this.pendingRestart;
    if (!r) return;
    this.pendingRestart = null;
    if (this.periodEndPending || this.clock <= 0) {
      this.endPeriod(events);
      return;
    }
    const side = this.sides[r.side];
    if (r.kind === 'goalThrow') {
      this.beginSetPiece('goalThrow', r.side, side.keeper, side.keeperBody.position, events);
      return;
    }
    const { width } = this.setup.field;
    let spot = { x: clamp(r.spot.x, 1, this.setup.field.length - 1), y: clamp(r.spot.y, 1, width - 1) };
    if (r.kind === 'corner') {
      const goal = side.attacks;
      const lateralSign = Math.sign(r.spot.y - goal.y) || 1;
      spot = { x: goal.x - goal.facing * 2, y: goal.y + lateralSign * (width / 2 - 0.8) };
    }
    const taker = [...side.field].sort((a, b) => dist(a.pos, spot) - dist(b.pos, spot))[0] as Swimmer;
    this.beginSetPiece(r.kind, r.side, taker, spot, events);
  }

  private stepFreeBall(events: MatchEvent[]): void {
    const ball = this.ball;
    const b = ball.pos;
    const v = ball.vel;
    const { field } = this.setup;
    const prevX = b.x;
    b.x += v.x * DT;
    b.y += v.y * DT;
    b.z += v.z * DT;
    if (b.z > 0) v.z -= 9.8 * DT;
    // Over a goal line: goal, corner or goal throw.
    for (const goal of [field.goalLeft, field.goalRight]) {
      const before = (prevX - goal.x) * goal.facing;
      const after = (b.x - goal.x) * goal.facing;
      const scorerSide = this.sides.find((s) => s.attacks === goal) as Side;
      if (before < 0 && after >= 0 && !ball.dead) {
        const inMouth = Math.abs(b.y - goal.y) < goal.halfWidth && b.z < goal.height;
        if (inMouth) {
          ball.dead = true;
          this.scoreGoal(scorerSide.index, null, events);
        } else {
          ball.dead = true;
          const last = ball.lastTouch;
          const kind = overGoalLine(last ? { defender: last.team !== scorerSide.index, keeper: last.keeper, blockedShot: last === this.lastBlocker } : null);
          this.scheduleRestart(kind, kind === 'corner' ? scorerSide.index : ((1 - scorerSide.index) as TeamSide), b, 0.6);
        }
      }
      const scoredHere = this.phase === 'goal' && this.sides[this.lastGoalSide].attacks === goal;
      if (scoredHere && after >= 0.75 && !ball.inNet && Math.abs(b.y - goal.y) < goal.halfWidth + 0.2) {
        ball.inNet = true;
        events.push({ type: 'net', at: { ...b } });
        v.x = v.y = 0;
      }
      if (ball.inNet && scoredHere) {
        b.x = goal.x + goal.facing * 0.78;
        b.y = clamp(b.y, goal.y - goal.halfWidth + 0.15, goal.y + goal.halfWidth - 0.15);
      }
      if (after > 2.2) {
        b.x = goal.x + goal.facing * 2.2;
        v.x = 0;
        v.y *= 0.5;
      }
    }
    b.y = clamp(b.y, 0.2, field.width - 0.2);
    if (b.z <= 0 && v.z <= 0) {
      const impact = Math.abs(v.z) + Math.hypot(v.x, v.y) * 0.3;
      if (impact > 1.2) events.push({ type: 'splash', at: { x: b.x, y: b.y }, strength: clamp(impact / 8, 0.2, 1) });
      b.z = 0;
      v.z = 0;
      v.x *= 0.5;
      v.y *= 0.5;
    }
    if (b.z === 0) {
      const k = Math.exp(-this.t.suelto.frenado * DT);
      v.x *= k;
      v.y *= k;
    }
    if (ball.dead || !LIVE.includes(this.phase)) return;

    // Up for grabs: a keeper first if it is at hand, then the nearest player within reach.
    for (const side of this.sides) {
      const body = side.keeperBody;
      if (b.z < 1.2 && dist(b, body.position) < this.t.suelto.recogerPortero) {
        events.push({ type: 'looseWon', by: side.keeper });
        this.giveBall(side.index, side.keeper, 'loose', events);
        this.setPhase('transition', events);
        return;
      }
    }
    if (b.z > 0.6) return;
    let winner: Swimmer | null = null;
    let best = this.t.suelto.recoger;
    for (const s of this.movers) {
      const d = dist(s.pos, b);
      if (d < best) {
        best = d;
        winner = s;
      }
    }
    if (!winner) return;
    events.push({ type: 'looseWon', by: winner });
    const keepsIt = winner.team === this.possession;
    const shotRebound = this.afterShot;
    this.afterShot = false;
    this.giveBall(winner.team, winner, 'loose', events);
    if (keepsIt) {
      // Second possession for the same team (GDD §12).
      if (shotRebound) this.shotClock = this.setup.possession.second;
      if (this.phase === 'positional') this.reassignSlots();
    } else {
      this.setPhase('transition', events);
    }
  }

  // ------------------------------------------------------------------------------------------
  // Fouls, exclusions and penalties (GDD §12–13)
  // ------------------------------------------------------------------------------------------

  /** Whether the AI may make a contact with this player (never the defender the human holds). */
  private aiFouls(s: Swimmer): boolean {
    if (s.excluded || s.away) return false;
    return !(s === this.selected && this.sides[s.team].human && this.input.current === 'defend');
  }

  /** How much more often an aggressive player makes contact. */
  private aggressionRate(s: Swimmer): number {
    const f = this.m.faltas.agresividad;
    return lerp(f.min, f.max, barFactor(s.player.stats.aggression));
  }

  private aiIntensity(s: Swimmer): number {
    const f = this.m.faltas.intensidad;
    return clamp(f.base + f.porAgresividad * barFactor(s.player.stats.aggression) + this.fouls.gauss() * f.ruido, 0, 1);
  }

  /** With probability `chance` (times the aggression) the AI makes the contact. True if whistled. */
  private maybeFoul(by: Swimmer, on: Swimmer, kind: ContactKind, chance: number, events: MatchEvent[], counter?: boolean): boolean {
    if (!this.fouls.chance(clamp(chance * this.aggressionRate(by), 0, 1))) return false;
    events.push({ type: 'contact', by, on, strong: true });
    return this.contactFoul(by, on, kind, this.aiIntensity(by), events, counter);
  }

  /** `a` is behind `b`: further from the goal that `b` attacks. */
  private isBehind(a: Swimmer, b: Swimmer): boolean {
    const goal = this.sides[b.team].attacks;
    return dot(dir(b.pos, goal), dir(b.pos, a.pos)) < -0.2;
  }

  /** Without the foul a goal would probably have come (WP 11.1.1.1). */
  private probableGoal(victim: Swimmer): boolean {
    const goal = this.sides[victim.team].attacks;
    const distance = toGoal(goal, victim.pos).distance;
    if (distance > this.setup.rules.campo.lineas.seisMetros) return false;
    if (this.charging?.shooter === victim) return true;
    const flight = this.ball.flight;
    if (flight?.kind === 'pass' && flight.receiver === victim && distance < 4.5) {
      return this.drives.get(victim)?.phase === 'free' || (victim === this.boya && this.post > 0.5);
    }
    if (this.ball.holder === victim && this.phase === 'transition') {
      // Through on goal: no defender closer to the goal near him.
      return !this.sides[(1 - victim.team) as TeamSide].field.some((d) => toGoal(goal, d.pos).distance < distance && dist(d.pos, victim.pos) < 2.5);
    }
    return false;
  }

  /** A break with more attackers than defenders is on: stopping it is a tactical foul (WP 10.1.5). */
  private get breakOn(): boolean {
    return this.phase === 'transition' && (this.advantage !== null || this.advantageSince >= 0);
  }

  /** A contact goes through the rules and the referee; what is whistled is applied. True if whistled. */
  private contactFoul(by: Swimmer, on: Swimmer, kind: ContactKind, intensity: number, events: MatchEvent[], counter?: boolean): boolean {
    if (!LIVE.includes(this.phase) || this.ball.dead || this.pendingRestart || this.heldCall) return false;
    const goal = this.sides[on.team].attacks;
    const byAttacker = by.team === this.possession;
    const contact: Contact = {
      kind,
      intensity,
      byAttacker,
      victimHasBall: this.ball.holder === on,
      victimShooting: this.charging?.shooter === on,
      fromBehind: this.isBehind(by, on),
      inSixMetres: !byAttacker && toGoal(goal, on.pos).distance <= this.setup.rules.campo.lineas.seisMetros,
      probableGoal: !byAttacker && this.probableGoal(on),
      counterAttack: !byAttacker && (counter ?? (this.breakOn && on.team === this.possession)),
    };
    const classified = classify(contact, this.setup.refereeTuning.clasificacion);
    if (classified.sanction === 'none') return false;
    const call = this.referee.judge(classified, contact, { id: by.id, side: by.team, aggression: by.player.stats.aggression });
    if (call.sanction === 'none') return false;
    // Advantage: while the attack shoots, a defensive foul waits for the shot (WP 11.1.1.4.2, 11.2.2).
    if (!byAttacker && (this.charging !== null || this.ball.flight?.kind === 'shot')) {
      if (call.sanction === 'ordinary') return false;
      this.heldCall = { by, on, sanction: call.sanction, motive: call.motive, card: call.card, teamWarning: call.teamWarning };
      events.push({ type: 'heldCall', on });
      return true;
    }
    this.applyCall(by, on, call.sanction, call.motive, call.card, call.teamWarning, events);
    return true;
  }

  /** Forces a call, as if the referee had just whistled it (tests and debug tools). */
  forceCall(
    by: Swimmer,
    on: Swimmer | null,
    sanction: 'ordinary' | 'exclusion' | 'penalty' | 'violent',
    motive: Motive = 'AGARRÓN',
    card: 'yellow' | 'red' | null = null,
  ): MatchEvent[] {
    const events: MatchEvent[] = [];
    this.applyCall(by, on, sanction, motive, card, false, events);
    return events;
  }

  private applyHeldCall(events: MatchEvent[]): void {
    const h = this.heldCall;
    if (!h) return;
    this.heldCall = null;
    this.applyCall(h.by, h.on, h.sanction, h.motive, h.card, h.teamWarning, events);
  }

  /** The whistle: personal fouls, cards, and the throw, exclusion or penalty that follows. */
  private applyCall(
    by: Swimmer,
    on: Swimmer | null,
    sanction: 'ordinary' | 'exclusion' | 'penalty' | 'violent',
    motive: Motive,
    card: 'yellow' | 'red' | null,
    teamWarning: boolean,
    events: MatchEvent[],
  ): void {
    const r = this.setup.rules;
    const awarded = (1 - by.team) as TeamSide;
    const offensive = by.team === this.possession;
    let personal = this.personal.get(by) ?? 0;
    if (isPersonal(sanction)) personal++;
    this.personal.set(by, personal);
    const out = sanction === 'violent' || card === 'red' || personal >= r.exclusion.faltasPersonalesMax;
    const stats = this.stats[by.team];
    if (sanction === 'ordinary') stats.fouls++;
    else if (sanction === 'exclusion') stats.exclusions++;
    else stats.penalties++;
    if (card === 'yellow') stats.yellows++;
    if (card === 'red' || sanction === 'violent') stats.reds++;
    this.human.contact = null;
    events.push({ type: 'whistle' }, { type: 'foul', sanction, motive, by, on, awarded, card, teamWarning, personal, out });

    const ball = { x: this.ball.pos.x, y: this.ball.pos.y };
    const spot = freeThrowSpot(ball, this.sides[awarded].attacks, !offensive, r);
    if (sanction === 'ordinary') {
      if (out) this.exclude(by, true, false, events);
      this.beginFreeThrow(awarded, spot, !offensive && this.phase === 'positional' ? 'positional' : 'transition', 'ordinary', events);
      return;
    }
    if (sanction === 'exclusion') {
      const kept = this.possession === awarded;
      const remaining = this.shotClock;
      this.exclude(by, out, false, events);
      this.stats[awarded].manUp++;
      this.beginFreeThrow(awarded, spot, 'positional', 'exclusion', events);
      // 18 seconds, or what was left if that is more (WP 9.9).
      if (kept) this.shotClock = shotClockAfterExclusion(remaining, r);
      return;
    }
    // Penalty (a violent action also gives one). A third personal foul that is a penalty foul
    // brings the substitute in at once (WP 17.4.1).
    if (out) this.exclude(by, true, sanction === 'violent', events, sanction === 'penalty');
    this.startPenalty(awarded, events);
  }

  /** A free throw after a foul: the player with the ball (or the nearest) puts it in play. */
  private beginFreeThrow(side: TeamSide, spot: Vec2, resume: 'transition' | 'positional', kind: 'ordinary' | 'exclusion', events: MatchEvent[]): void {
    const team = this.sides[side];
    const holder = this.ball.holder;
    const taker = holder && holder.team === side && !holder.keeper ? holder : [...team.field].sort((a, b) => dist(a.pos, spot) - dist(b.pos, spot))[0];
    if (!taker) return;
    // The ball goes to him where he is if the spot is not at hand (a pass in the air, say).
    const at = dist(taker.pos, spot) > 1.5 ? { x: taker.pos.x, y: taker.pos.y } : spot;
    const f = this.m.faltas.preparacion;
    this.beginSetPiece('freeThrow', side, taker, at, events, {
      reason: 'foul',
      resume,
      prep: kind === 'exclusion' ? f.exclusion : f.ordinaria,
      direct: directShotAllowed(at, team.attacks, this.setup.rules),
    });
  }

  /** Sends a player off: out of the play, swimming to the re-entry area behind his goal line (WP 10.4). */
  private exclude(s: Swimmer, forGame: boolean, brutal: boolean, events: MatchEvent[], subNow = false): void {
    const side = this.sides[s.team];
    const index = side.field.indexOf(s);
    if (index < 0) return;
    side.field.splice(index, 1);
    s.excluded = true;
    s.mark = null;
    s.slot = null;
    s.armUp = s.rise = s.struggle = 0;
    for (const [driver, drive] of [...this.drives]) if (driver === s || drive.defender === s) this.drives.delete(driver);
    if (this.selected === s) this.selected = null;
    if (this.human.contact?.on === s) this.human.contact = null;
    this.zones.delete(s);
    this.areaTime.delete(s);
    const r = this.setup.rules;
    const ex: Exclusion = {
      swimmer: s,
      left: r.exclusion.segundos,
      forGame,
      brutal,
      subLeft: brutal ? brutalitySeconds(r) : 0,
      canReturn: false,
      anywhere: false,
      replaced: false,
      reason: null,
    };
    side.out.push(ex);
    this.refreshMovers();
    if (forGame && subNow) this.substitute(side, ex, events);
  }

  /** The excluded swim to their re-entry area; their time runs while the ball is in play. */
  private stepExclusions(events: MatchEvent[]): void {
    const live = LIVE.includes(this.phase) && !this.ball.dead && !this.pendingRestart;
    const speed = this.setup.rules.velocidadRelojes.exclusion;
    const arrive = this.m.superioridad.reentrada.llegada;
    for (const side of this.sides) {
      for (const ex of [...side.out]) {
        const s = ex.swimmer;
        const zone = this.reentry(side);
        s.target = { ...zone };
        s.speedScale = 0.9;
        s.desiredFacing = angleTo(s.pos, zone);
        if (live) {
          ex.left = Math.max(0, ex.left - DT * speed);
          if (ex.brutal) ex.subLeft = Math.max(0, ex.subLeft - DT * speed);
        }
        if (!ex.canReturn && (ex.brutal ? ex.subLeft <= 0 : ex.left <= 0)) {
          ex.canReturn = true;
          ex.reason = 'time';
        }
        const arrived = dist(s.pos, zone) < arrive;
        if (ex.replaced) {
          // Already replaced: once at the side of the pool, he is gone.
          if (arrived) {
            side.out.splice(side.out.indexOf(ex), 1);
            s.away = true;
            s.excluded = false;
          }
          continue;
        }
        if (ex.canReturn && (arrived || ex.anywhere) && this.phase !== 'penalty') this.bringBack(side, ex, ex.reason ?? 'time', events);
      }
    }
  }

  /** Re-entry area: behind the team's own goal line, at the side of the pool (WP 20.7). */
  private reentry(side: Side): Vec2 {
    const goal = side.defends;
    const r = this.m.superioridad.reentrada;
    return { x: goal.x - goal.facing * r.x, y: r.y };
  }

  /** The way back opens for a team's excluded players (WP 10.5.2). A violent action keeps its 4 minutes. */
  private endExclusions(team: TeamSide, reason: ExclusionEnd, events: MatchEvent[]): void {
    for (const ex of this.sides[team].out) {
      if (ex.brutal || ex.replaced) continue;
      if (reason === 'goal') ex.anywhere = true;
      if (ex.canReturn) continue;
      ex.canReturn = true;
      ex.reason = reason;
    }
    if (reason === 'goal') this.stepExclusionsNow(team, events);
  }

  /** After a goal the excluded come straight back (they may re-enter from anywhere). */
  private stepExclusionsNow(team: TeamSide, events: MatchEvent[]): void {
    const side = this.sides[team];
    for (const ex of [...side.out]) if (ex.canReturn && ex.anywhere && !ex.replaced) this.bringBack(side, ex, 'goal', events);
  }

  /** Back in the play: the same player, or a substitute if he is out for good. */
  private bringBack(side: Side, ex: Exclusion, reason: ExclusionEnd, events: MatchEvent[], silent = false): void {
    const index = side.out.indexOf(ex);
    if (index < 0) return;
    side.out.splice(index, 1);
    const s = ex.swimmer;
    s.excluded = false;
    if (ex.forGame) {
      if (!ex.replaced) this.substitute(side, ex, events);
      s.away = true;
    } else {
      side.field.push(s);
      if (!silent) events.push({ type: 'exclusionEnd', who: s, reason });
    }
    this.refreshMovers();
    this.afterRosterChange();
  }

  /** A substitute comes in from the re-entry area (if there is anybody left on the bench). */
  private substitute(side: Side, ex: Exclusion, events: MatchEvent[]): void {
    if (ex.replaced) return;
    ex.replaced = true;
    const sub = side.bench.shift();
    if (!sub) return;
    sub.away = false;
    sub.excluded = false;
    const zone = this.reentry(side);
    this.place(sub, zone, angleTo(zone, side.attacks));
    side.field.push(sub);
    events.push({ type: 'substitution', out: ex.swimmer, in: sub });
    this.refreshMovers();
    this.afterRosterChange();
  }

  /** Somebody left or came back: slots, marks and zones are shared out again. */
  private afterRosterChange(): void {
    if (this.possession === null) return;
    const att = this.sides[this.possession];
    if (this.manUpOf(att) <= 0) att.rotated = false;
    this.assignSlots(att.field);
    this.assignAllMarks();
  }

  /** The AI's contacts in open play: tactical fouls on a break, and tackling the player with the ball. */
  private aiContacts(events: MatchEvent[]): void {
    const att = this.attackingSide;
    const def = this.defendingSide;
    if (!att || !def || this.ball.dead || this.pendingRestart || this.heldCall) return;
    const f = this.m.faltas;
    const reach = this.m.defensa.contacto.distancia;
    if (this.breakOn) {
      // Beaten for pace on a break with a man free: pull back the man in front rather than let him through.
      if (!this.advantage) return;
      for (const d of def.field) {
        if (!this.aiFouls(d)) continue;
        const a = att.field.find((x) => dist(x.pos, d.pos) <= reach && this.isBehind(d, x));
        if (a && this.maybeFoul(d, a, 'pullBack', f.tacticaPorSegundo * DT, events, true)) return;
      }
      return;
    }
    const holder = this.ball.holder;
    if (this.phase !== 'positional' || !holder || holder.team !== att.index || holder.keeper || holder.holdTime < 0.6 || this.charging) return;
    const d = this.defenderOf(holder);
    if (d && this.aiFouls(d) && dist(d.pos, holder.pos) < this.t.defensa.robo.distancia) this.maybeFoul(d, holder, 'hold', f.poseedorPorSegundo * DT, events);
  }

  /** The centre turning with the ball: his defender may hang on to him. */
  private turnFoul(boya: Swimmer, events: MatchEvent[]): void {
    const d = this.defenderOf(boya);
    if (d && this.aiFouls(d)) this.maybeFoul(d, boya, this.isBehind(d, boya) ? 'pullBack' : 'hold', this.m.faltas.boyaGiro, events);
  }

  /** The AI keeps its attackers out of the goal area while they are ahead of the ball (WP 8.2.8). */
  private keepOutOfGoalArea(): void {
    const att = this.attackingSide;
    if (!att || this.ball.free) return;
    const goal = att.attacks;
    const r = this.setup.rules;
    const ballDistance = toGoal(goal, this.ball.pos).distance;
    const flight = this.ball.flight;
    for (const a of att.field) {
      if (a === this.ball.holder || (flight?.kind === 'pass' && flight.receiver === a)) continue;
      const t = toGoal(goal, a.target);
      if (t.distance >= this.m.faltas.areaGolSalida || Math.abs(t.lateral) > r.areaGol.ancho / 2 + 0.3 || t.distance > ballDistance) continue;
      a.target = fromGoal(goal, this.m.faltas.areaGolSalida, t.lateral);
    }
  }

  /** An attacker waiting in the goal area ahead of the ball line: ordinary foul (WP 8.2.8). */
  private checkGoalArea(events: MatchEvent[]): void {
    const att = this.attackingSide;
    if (!att || this.ball.free || this.ball.dead || this.pendingRestart) {
      this.areaTime.clear();
      return;
    }
    for (const a of att.field) {
      const margin = this.m.faltas.areaGolMargen;
      const deep = toGoal(att.attacks, a.pos).distance < this.setup.rules.campo.lineas.dosMetros - margin;
      if (a === this.ball.holder || !deep || !goalAreaOffence(a.pos, this.ball.pos, att.attacks, this.setup.rules)) {
        this.areaTime.delete(a);
        continue;
      }
      const t = (this.areaTime.get(a) ?? 0) + DT;
      this.areaTime.set(a, t);
      if (t >= this.m.faltas.areaGolSegundos) {
        this.areaTime.clear();
        this.applyCall(a, null, 'ordinary', '2 METROS', null, false, events);
        return;
      }
    }
  }

  /** Penalty: the best shooter in the water from the 5 m, everybody else outside the 6 m (WP 16). */
  private startPenalty(side: TeamSide, events: MatchEvent[]): void {
    const att = this.sides[side];
    const def = this.sides[(1 - side) as TeamSide];
    const goal = att.attacks;
    const shooter = [...att.field].sort(
      (a, b) => b.player.stats.power + b.player.stats.accuracy - (a.player.stats.power + a.player.stats.accuracy) || a.player.number - b.player.number,
    )[0];
    if (!shooter) return;
    this.resetPlayState();
    this.ball.flight = null;
    this.ball.free = this.ball.dead = false;
    this.ball.vel = { x: 0, y: 0, z: 0 };
    for (const k of this.keepers) k.holding = false;
    this.giveBall(side, shooter, 'penalty', events);
    this.endExclusions(side, 'throw', events);
    const spot = fromGoal(goal, this.setup.rules.penaltiDesde, 0);
    this.place(shooter, spot, angleTo(spot, goal));
    const defenceLanes = [-3, 3, -5, 5, -7, 7];
    def.field.forEach((d, i) => {
      const p = fromGoal(goal, 6.4, defenceLanes[i] ?? 0);
      this.place(d, p, angleTo(p, spot));
    });
    const attackSpots: [number, number][] = [
      [7.4, -4],
      [7.4, 4],
      [7.6, -6.2],
      [7.6, 6.2],
      [8.3, 0],
    ];
    att.field
      .filter((a) => a !== shooter)
      .forEach((a, i) => {
        const [x, y] = attackSpots[i] ?? [8.5, 0];
        const p = fromGoal(goal, x, y);
        this.place(a, p, angleTo(p, goal));
      });
    def.keeperBody.reset();
    this.penalty = { side, shooter, keeper: def.keeperBody, startAt: this.time + this.m.faltas.preparacion.penalti, duel: null, aiShooter: null, aiKeeper: null, armed: false };
    this.setPhase('penalty', events);
    events.push({ type: 'penalty', shooter, keeper: def.keeper });
  }

  private stepPenalty(pad: PadState, events: MatchEvent[]): void {
    const p = this.penalty;
    this.idle();
    if (!p) return;
    const goal = this.sides[p.side].attacks;
    p.shooter.desiredFacing = angleTo(p.shooter.pos, goal);
    if (!p.duel) {
      if (this.time < p.startAt) return;
      const player = p.shooter.player;
      const rng = this.setup.rng;
      const pen = this.setup.penalty;
      p.duel = new Duel({
        goal,
        position: { ...p.shooter.pos },
        handSide: ((player.hand === 'left' ? -1 : 1) * goal.facing) as 1 | -1,
        shooter: shooterProfile(player),
        keeper: p.keeper.profile,
        context: 'penalty',
        timeLimit: pen.segundosLimite,
        aftermathSeconds: pen.segundosDesenlace,
        shot: this.setup.shot,
        keeperTuning: this.setup.keeperTuning,
        penaltyKeeper: pen.portero,
        rng,
      });
      p.aiShooter = this.sides[p.side].human ? null : new AiShooter(rng, { accuracy: player.stats.accuracy, skill: player.stats.skill }, pen, this.setup.difficulty, this.setup.shot);
      p.aiKeeper = this.sides[(1 - p.side) as TeamSide].human ? null : new AiKeeper(rng, p.keeper.profile.reflexes, pen, this.setup.difficulty);
    }
    const duel = p.duel;
    // Only a press of TIRO after the whistle counts (gesture tied to its moment).
    if (!pad.shot) p.armed = true;
    const shooter = p.aiShooter ? p.aiShooter.next(duel) : { shot: p.armed && pad.shot, pad: { x: pad.x, y: pad.y } };
    const keeper = p.aiKeeper ? p.aiKeeper.next(duel) : { pad: { x: pad.x, y: pad.y } };
    for (const e of duel.step(shooter, keeper)) {
      this.penaltyEvent(p, duel, e, events);
      if (this.penalty !== p) return;
    }
    p.shooter.rise = duel.rise;
    this.charging = duel.phase === 'charging' ? { shooter: p.shooter, time: duel.chargeTime, charge: duel.charge, aim: { ...duel.aim }, ai: null } : null;
  }

  private penaltyEvent(p: PenaltyState, duel: Duel, e: DuelEvent, events: MatchEvent[]): void {
    switch (e.type) {
      case 'whistle':
        events.push({ type: 'whistle' });
        break;
      case 'chargeStart':
        events.push({ type: 'chargeStart', who: p.shooter });
        break;
      case 'release':
        this.stats[p.side].shots++;
        this.ball.holder = null;
        this.ball.lastTouch = p.shooter;
        p.shooter.holdTime = -1;
        events.push({ type: 'release', plan: e.plan, who: p.shooter });
        break;
      case 'dive':
        events.push({ type: 'dive', side: e.side });
        break;
      case 'bounce':
        events.push({ type: 'bounce', at: e.at, speed: e.speed });
        break;
      case 'splash':
        events.push({ type: 'splash', at: e.at, strength: e.strength });
        break;
      case 'frame':
        events.push({ type: 'frame', at: e.at });
        break;
      case 'outcome':
        this.finishPenalty(p, duel, e, events);
        break;
      case 'net':
        break;
    }
  }

  /** The penalty is decided: from here the match ball takes over (a rebound is live, WP 16.7). */
  private finishPenalty(p: PenaltyState, duel: Duel, e: Extract<DuelEvent, { type: 'outcome' }>, events: MatchEvent[]): void {
    const { outcome } = e;
    const team = p.side;
    const other = (1 - team) as TeamSide;
    events.push({ type: 'outcome', outcome, plan: e.plan, save: e.save });
    if (outcome.type === 'goal' || outcome.type === 'save') this.stats[team].onTarget++;
    this.mirrorPenaltyKeeper(duel, p.keeper);
    this.penalty = null;
    this.charging = null;
    const ball = this.ball;
    ball.prev = { ...duel.prevBall };
    ball.pos = { ...duel.ball };
    ball.vel = { ...duel.ballVelocity };
    ball.holder = null;
    ball.flight = null;
    ball.free = true;
    switch (outcome.type) {
      case 'goal':
        ball.dead = true;
        this.scoreGoal(team, p.shooter, events);
        return;
      case 'save':
        this.stats[other].saves++;
        ball.lastTouch = p.keeper.swimmer;
        if (outcome.held) {
          this.giveBall(other, p.keeper.swimmer, 'save', events);
          this.setPhase('transition', events);
          return;
        }
        break;
      case 'miss':
        ball.dead = true;
        this.setPhase('positional', events);
        this.scheduleRestart('goalThrow', other, ball.pos, 0.6);
        return;
      case 'post':
        break;
    }
    // Rebound: play on from the penalty positions.
    this.afterShot = true;
    this.setPhase('positional', events);
    this.assignSlots(this.sides[team].field);
    this.assignAllMarks();
  }

  private mirrorPenaltyKeeper(duel: Duel, body: KeeperBody): void {
    body.prevU = duel.prevKeeperU;
    body.u = duel.keeperU;
    body.stretch = duel.keeperStretch;
    body.hands = duel.keeperHands;
    body.place();
  }

  private mirrorPenaltyBall(duel: Duel): void {
    this.ball.prev = { ...duel.prevBall };
    this.ball.pos = { ...duel.ball };
  }

  // ------------------------------------------------------------------------------------------
  // Steals and clocks
  // ------------------------------------------------------------------------------------------

  private steal(defender: Swimmer, from: Swimmer, events: MatchEvent[]): void {
    this.charging = null;
    from.holdTime = -1;
    events.push({ type: 'steal', by: defender, from });
    this.giveBall(defender.team, defender, 'steal', events);
    this.setPhase('transition', events);
  }

  /** AI defenders can take the ball off a player who holds it too long, too close. */
  private checkSteal(events: MatchEvent[]): void {
    const holder = this.ball.holder;
    if (!holder || holder.keeper || this.charging || this.time < holder.protectUntil || this.mustPass === holder) return;
    const r = this.t.defensa.robo;
    if (holder.holdTime < r.tiempoMinimo) return;
    const defender = this.defenderOf(holder);
    if (!defender || defender === this.selected || dist(defender.pos, holder.pos) > r.distancia) return;
    let rate = lerp(r.porSegundo.min, r.porSegundo.max, sigmoid(r.pendiente * (barFactor(defender.player.stats.defense) - barFactor(holder.player.stats.skill))));
    if (holder === this.boya) rate *= 1 + Math.max(0, -this.post);
    // Swimming with the ball on the break is hard to take off: most breaks reach the set play.
    if (this.phase === 'transition') rate *= this.m.transicion.robo;
    if (this.setup.rng.chance(rate * DT)) this.steal(defender, holder, events);
  }

  private tickClocks(events: MatchEvent[]): void {
    if (this.ball.dead || this.pendingRestart) return;
    const shotInAir = this.ball.flight?.kind === 'shot';
    if (this.phase !== 'swimOff' && !this.setup.counter) {
      this.clock -= DT * this.setup.clockSpeed;
      if (this.clock <= 0) {
        this.clock = 0;
        if (shotInAir) this.periodEndPending = true;
        else {
          this.endPeriod(events);
          return;
        }
      }
    }
    if (this.possession === null || shotInAir || this.phase === 'swimOff') return;
    this.shotClock -= DT * this.setup.possession.clockSpeed;
    if (this.shotClock <= 0) {
      // Shot clock out: the other team gets a free throw where the ball is.
      this.shotClock = 0;
      const other = (1 - this.possession) as TeamSide;
      this.ball.holder = null;
      this.ball.flight = null;
      this.ball.free = false;
      this.charging = null;
      this.scheduleRestart('freeThrow', other, this.ball.pos, 0.3);
      events.push({ type: 'whistle' });
    }
  }
}

const PAD_MODE: Record<ControlContext, PadMode> = {
  none: 'none',
  sprint: 'sprint',
  attack: 'pass',
  carry: 'swim',
  keeper: 'keeper',
  defend: 'defend',
};

