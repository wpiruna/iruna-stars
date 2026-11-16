/** Types of the full match (GDD §4): phases, set pieces, events and statistics. */
import type { Vec2 } from '../field';
import type { AttackEvent, Swimmer, TeamSide } from '../attack/types';

export type MatchTuning = (typeof import('../../../data/tuning.json'))['partido'];

/** States of the match machine (GDD §4). Superiority and penalties arrive with the rules (F4). */
export type MatchPhase =
  | 'swimOffReady'
  | 'swimOff'
  | 'transition'
  | 'positional'
  | 'setPiece'
  | 'goal'
  | 'periodEnd'
  | 'fullTime';

export type SetPieceKind = 'goalThrow' | 'corner' | 'restart' | 'freeThrow';

export interface SetPiece {
  kind: SetPieceKind;
  side: TeamSide;
  taker: Swimmer;
  spot: Vec2;
  /** Whistle time; before it everybody takes position. */
  readyAt: number;
  /** After this the AI takes the throw for whoever is slow. */
  deadline: number;
  whistled: boolean;
}

export type PossessionReason =
  | 'swimOff'
  | 'steal'
  | 'intercept'
  | 'loose'
  | 'save'
  | 'goalThrow'
  | 'corner'
  | 'restart'
  | 'clock'
  | 'block';

/** What the pad does right now, for the small icon next to it (GDD §4). */
export type PadMode = 'none' | 'sprint' | 'pass' | 'swim' | 'defend' | 'keeper';

export type MatchEvent =
  | AttackEvent
  | { type: 'phase'; phase: MatchPhase; previous: MatchPhase }
  | { type: 'possession'; side: TeamSide; reason: PossessionReason }
  | { type: 'advantage'; attackers: number; defenders: number }
  | { type: 'swimOffWon'; by: Swimmer }
  | { type: 'goal'; side: TeamSide; scorer: Swimmer | null; score: [number, number] }
  | { type: 'setPiece'; kind: SetPieceKind; side: TeamSide }
  | { type: 'periodEnd'; period: number }
  | { type: 'fullTime'; score: [number, number] }
  | { type: 'horn' }
  | { type: 'switch'; to: Swimmer }
  | { type: 'stealTry'; by: Swimmer; won: boolean }
  | { type: 'anticipate'; by: Swimmer }
  | { type: 'contact'; by: Swimmer; on: Swimmer; strong: boolean }
  | { type: 'burst'; who: Swimmer };

export interface TeamStats {
  goals: number;
  shots: number;
  onTarget: number;
  saves: number;
  steals: number;
  turnovers: number;
  counterattacks: number;
  /** Seconds with the ball. */
  possession: number;
}

export const emptyStats = (): TeamStats => ({
  goals: 0,
  shots: 0,
  onTarget: 0,
  saves: 0,
  steals: 0,
  turnovers: 0,
  counterattacks: 0,
  possession: 0,
});
