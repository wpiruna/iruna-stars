/**
 * Penalty shoot-out (GDD §3.2 and §12): five shooters per team, alternating, then sudden death.
 * `ShootoutScore` is the bare rules; `Shootout` runs the duels one after another.
 */
import { STEP_MS } from '../../core/loop';
import type { Rng } from '../../core/rng';
import type { Player, Team } from '../../data/model';
import { fromGoal, type Goal } from '../field';
import type { KeeperProfile, ShooterProfile, ShotOutcome } from '../shooting/model';
import { AiKeeper, AiShooter, type Difficulty, type PenaltyAiTuning } from './ai';
import { Duel, type DuelConfig, type DuelEvent, type PadInput } from './duel';

const DT = STEP_MS / 1000;

export type Side = 0 | 1;

export class ShootoutScore {
  /** One entry per kick taken: true = scored. */
  readonly kicks: [boolean[], boolean[]] = [[], []];

  constructor(
    readonly kicksPerTeam: number,
    readonly suddenDeath: boolean,
    /** Team that shoots first. */
    readonly first: Side,
  ) {}

  goals(side: Side): number {
    return this.kicks[side].filter(Boolean).length;
  }

  /** Whose turn it is, or null when the shoot-out is over. */
  get next(): Side | null {
    if (this.winner !== null || this.drawn) return null;
    const second = (1 - this.first) as Side;
    return this.kicks[this.first].length <= this.kicks[second].length ? this.first : second;
  }

  /** True while the regular series (not sudden death) is still being played. */
  get inRegularSeries(): boolean {
    return this.kicks[0].length < this.kicksPerTeam || this.kicks[1].length < this.kicksPerTeam;
  }

  /** Only possible when sudden death is switched off in the rules. */
  get drawn(): boolean {
    return !this.suddenDeath && !this.inRegularSeries && this.goals(0) === this.goals(1);
  }

  get winner(): Side | null {
    const taken: [number, number] = [this.kicks[0].length, this.kicks[1].length];
    const goals: [number, number] = [this.goals(0), this.goals(1)];
    if (taken[0] <= this.kicksPerTeam && taken[1] <= this.kicksPerTeam && this.inRegularSeries) {
      // Decided early: the trailing team cannot catch up with the kicks it has left.
      for (const side of [0, 1] as const) {
        const other = (1 - side) as Side;
        if (goals[side] > goals[other] + (this.kicksPerTeam - taken[other])) return side;
      }
      return null;
    }
    // Series complete, or sudden death: decided whenever both have taken the same number.
    if (taken[0] !== taken[1] || goals[0] === goals[1]) return null;
    return goals[0] > goals[1] ? 0 : 1;
  }

  record(side: Side, scored: boolean): void {
    this.kicks[side].push(scored);
  }
}

/** The best penalty takers of a team: pace and placement, then skill as a tie-breaker. */
export function pickShooters(team: Team, count: number): Player[] {
  const field = team.players.filter((p) => p.position !== 'goalkeeper');
  const real = field.filter((p) => p.origin !== 'provisional');
  const pool = real.length >= count ? real : field.length >= count ? field : team.players;
  return [...pool]
    .sort(
      (a, b) =>
        b.stats.power + b.stats.accuracy + b.stats.skill * 0.1 - (a.stats.power + a.stats.accuracy + a.stats.skill * 0.1) ||
        a.number - b.number,
    )
    .slice(0, count);
}

export function pickKeeper(team: Team): Player {
  const keepers = team.players.filter((p) => p.position === 'goalkeeper');
  const rating = (p: Player): number => (p.keeperStats ? p.keeperStats.reflexes + p.keeperStats.positioning : 0);
  // A provisional (invented) keeper only plays when there is no real one.
  const invented = (p: Player): number => (p.origin === 'provisional' ? 1 : 0);
  const best =
    [...keepers].sort((a, b) => invented(a) - invented(b) || rating(b) - rating(a) || a.number - b.number)[0] ?? team.players[0];
  if (!best) throw new Error(`El equipo ${team.name} no tiene jugadores`);
  return best;
}

export function shooterProfile(player: Player): ShooterProfile {
  return { power: player.stats.power, accuracy: player.stats.accuracy, energy: 1 };
}

export function keeperProfile(player: Player): KeeperProfile {
  // A field player forced into goal keeps poorly, but can still play.
  return {
    reflexes: player.keeperStats?.reflexes ?? 3,
    positioning: player.keeperStats?.positioning ?? 3,
    energy: 1,
  };
}

export interface ShootoutSide {
  team: Team;
  shooters: Player[];
  keeper: Player;
  /** Controlled by the player (true) or by the AI. */
  human: boolean;
}

export interface ShootoutConfig {
  sides: [ShootoutSide, ShootoutSide];
  first: Side;
  goal: Goal;
  penaltyDistance: number;
  kicksPerTeam: number;
  suddenDeath: boolean;
  difficulty: Difficulty;
  duel: Pick<DuelConfig, 'shot' | 'keeperTuning' | 'penaltyKeeper'>;
  penalty: PenaltyAiTuning & { segundosLimite: number; segundosEntreTiros: number; segundosDesenlace: number };
  rng: Rng;
}

export interface Kick {
  side: Side;
  /** 1-based number of this team's kick. */
  number: number;
  shooter: Player;
  keeper: Player;
  suddenDeath: boolean;
  /** Who the player controls in this kick, if anyone. */
  humanRole: 'shooter' | 'keeper' | null;
}

export type ShootoutEvent =
  | DuelEvent
  | { type: 'kickStart'; kick: Kick }
  | { type: 'kickEnd'; kick: Kick; scored: boolean; outcome: ShotOutcome }
  | { type: 'finished'; winner: Side | null };

export type ShootoutPhase = 'intro' | 'kick' | 'between' | 'finished';

export interface PlayerInput {
  pad: PadInput;
  shot: boolean;
}

const NEUTRAL: PadInput = { x: 0, y: 0 };

export class Shootout {
  readonly score: ShootoutScore;
  phase: ShootoutPhase = 'intro';
  duel: Duel | null = null;
  kick: Kick | null = null;
  private timer = 0;
  private aiShooter: AiShooter | null = null;
  private aiKeeper: AiKeeper | null = null;
  private duelEnded = false;

  constructor(readonly config: ShootoutConfig) {
    this.score = new ShootoutScore(config.kicksPerTeam, config.suddenDeath, config.first);
  }

  step(input: PlayerInput): ShootoutEvent[] {
    const events: ShootoutEvent[] = [];
    switch (this.phase) {
      case 'intro':
        this.timer += DT;
        if (this.timer >= 1.6) this.startKick(events);
        break;

      case 'kick': {
        const duel = this.duel as Duel;
        const kick = this.kick as Kick;
        const shooterInput = this.aiShooter ? this.aiShooter.next(duel) : { shot: input.shot, pad: input.pad };
        const keeperInput = this.aiKeeper ? this.aiKeeper.next(duel) : { pad: kick.humanRole === 'keeper' ? input.pad : NEUTRAL };
        for (const event of duel.step(shooterInput, keeperInput)) {
          events.push(event);
          if (event.type === 'outcome' && !this.duelEnded) {
            this.duelEnded = true;
            const scored = event.outcome.type === 'goal';
            this.score.record(kick.side, scored);
            events.push({ type: 'kickEnd', kick, scored, outcome: event.outcome });
          }
        }
        if (duel.phase === 'done') {
          this.phase = 'between';
          this.timer = 0;
        }
        break;
      }

      case 'between':
        this.timer += DT;
        if (this.timer >= this.config.penalty.segundosEntreTiros) {
          if (this.score.next === null) {
            this.phase = 'finished';
            this.duel = null;
            events.push({ type: 'finished', winner: this.score.winner });
          } else {
            this.startKick(events);
          }
        }
        break;

      case 'finished':
        break;
    }
    return events;
  }

  private startKick(events: ShootoutEvent[]): void {
    const { config } = this;
    const side = this.score.next;
    if (side === null) {
      this.phase = 'finished';
      events.push({ type: 'finished', winner: this.score.winner });
      return;
    }
    const attacking = config.sides[side];
    const defending = config.sides[(1 - side) as Side];
    const taken = this.score.kicks[side].length;
    // Sudden death goes round the same shooters in the same order.
    const shooter = attacking.shooters[taken % attacking.shooters.length] as Player;
    const kick: Kick = {
      side,
      number: taken + 1,
      shooter,
      keeper: defending.keeper,
      suddenDeath: !this.score.inRegularSeries,
      humanRole: attacking.human ? 'shooter' : defending.human ? 'keeper' : null,
    };
    const rng = config.rng.fork(`kick-${side}-${taken}`);
    this.duel = new Duel({
      goal: config.goal,
      position: fromGoal(config.goal, config.penaltyDistance, 0),
      // Left-handers hold the ball on the other side.
      handSide: shooter.hand === 'left' ? -1 : 1,
      shooter: shooterProfile(shooter),
      keeper: keeperProfile(defending.keeper),
      context: 'penalty',
      timeLimit: config.penalty.segundosLimite,
      aftermathSeconds: config.penalty.segundosDesenlace,
      rng,
      ...config.duel,
    });
    this.aiShooter = attacking.human
      ? null
      : new AiShooter(rng, { accuracy: shooter.stats.accuracy, skill: shooter.stats.skill }, config.penalty, config.difficulty, config.duel.shot);
    this.aiKeeper = defending.human
      ? null
      : new AiKeeper(rng, keeperProfile(defending.keeper).reflexes, config.penalty, config.difficulty);
    this.kick = kick;
    this.duelEnded = false;
    this.phase = 'kick';
    events.push({ type: 'kickStart', kick });
  }
}
