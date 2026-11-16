/**
 * Shooting lab (GDD §20): free shots against an AI keeper, with every stat on a slider, to
 * tune the feel of shooting without playing a whole match.
 */
import { STEP_MS } from '../../core/loop';
import type { Rng } from '../../core/rng';
import { fromGoal, type Goal, type Vec2 } from '../field';
import type { KeeperContext, SaveEstimate, ShotOutcome, ShotPlan } from '../shooting/model';
import { AiKeeper, type PenaltyAiTuning } from './ai';
import { Duel, type DuelConfig, type DuelEvent } from './duel';
import type { PlayerInput } from './shootout';

const DT = STEP_MS / 1000;

export interface LabSpot {
  id: string;
  label: string;
  /** Metres from the goal line and from the goal axis (positive = attacker's left). */
  distance: number;
  lateral: number;
  context: KeeperContext;
}

export const LAB_SPOTS: LabSpot[] = [
  { id: 'penalti', label: 'Penalti (5 m)', distance: 5, lateral: 0, context: 'penalty' },
  { id: 'cierre', label: 'Cierre (7 m)', distance: 7, lateral: 0, context: 'open' },
  { id: 'lateral', label: 'Lateral (5,5 m)', distance: 5.5, lateral: 5, context: 'open' },
  { id: 'extremo', label: 'Extremo (2,5 m)', distance: 2.5, lateral: -4.5, context: 'open' },
  { id: 'boya', label: 'Boya (2,5 m)', distance: 2.5, lateral: 0, context: 'open' },
];

export interface LabSettings {
  spot: LabSpot;
  power: number;
  accuracy: number;
  reflexes: number;
  positioning: number;
}

export interface LabStats {
  shots: number;
  goals: number;
  saves: number;
  posts: number;
  misses: number;
  last: { plan: ShotPlan; outcome: ShotOutcome; save: SaveEstimate | null } | null;
}

export class Lab {
  duel: Duel;
  readonly stats: LabStats = { shots: 0, goals: 0, saves: 0, posts: 0, misses: 0, last: null };
  private aiKeeper: AiKeeper | null = null;
  private pause = 0;
  private count = 0;

  constructor(
    private readonly goal: Goal,
    public settings: LabSettings,
    private readonly duelTuning: Pick<DuelConfig, 'shot' | 'keeperTuning' | 'penaltyKeeper'>,
    private readonly penalty: PenaltyAiTuning,
    private readonly rng: Rng,
  ) {
    this.duel = this.createDuel();
  }

  get position(): Vec2 {
    return fromGoal(this.goal, this.settings.spot.distance, this.settings.spot.lateral);
  }

  /** Applies new sliders. Takes effect on the next shot; restarts at once if nothing is in the air. */
  configure(settings: LabSettings): void {
    this.settings = settings;
    if (this.duel.phase === 'ready' || this.duel.phase === 'done') this.duel = this.createDuel();
  }

  resetStats(): void {
    Object.assign(this.stats, { shots: 0, goals: 0, saves: 0, posts: 0, misses: 0, last: null });
  }

  private createDuel(): Duel {
    const { settings } = this;
    const rng = this.rng.fork(`lab-${this.count++}`);
    this.aiKeeper = settings.spot.context === 'penalty' ? new AiKeeper(rng, settings.reflexes, this.penalty, 'normal') : null;
    return new Duel({
      goal: this.goal,
      position: this.position,
      shooter: { power: settings.power, accuracy: settings.accuracy, energy: 1 },
      keeper: { reflexes: settings.reflexes, positioning: settings.positioning, energy: 1 },
      context: settings.spot.context,
      timeLimit: 0,
      aftermathSeconds: 1.2,
      rng,
      ...this.duelTuning,
    });
  }

  step(input: PlayerInput): DuelEvent[] {
    if (this.duel.phase === 'done') {
      this.pause += DT;
      if (this.pause < 0.25) return [];
      this.pause = 0;
      this.duel = this.createDuel();
    }
    const keeperInput = this.aiKeeper ? this.aiKeeper.next(this.duel) : { pad: { x: 0, y: 0 } };
    // No referee in the lab: the whistle that opens each duel is dropped.
    const events = this.duel.step({ shot: input.shot, pad: input.pad }, keeperInput).filter((e) => e.type !== 'whistle');
    for (const event of events) {
      if (event.type !== 'outcome') continue;
      const s = this.stats;
      s.shots++;
      if (event.outcome.type === 'goal') s.goals++;
      else if (event.outcome.type === 'save') s.saves++;
      else if (event.outcome.type === 'post') s.posts++;
      else s.misses++;
      s.last = { plan: event.plan, outcome: event.outcome, save: event.save };
    }
    return events;
  }
}
