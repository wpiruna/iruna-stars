/** Types of the full match (GDD §4): phases, set pieces, events and statistics. */
import type { Vec2 } from '../field';
import type { AttackEvent, Swimmer, TeamSide } from '../attack/types';
import type { ExclusionEnd, Motive, Sanction } from '../rules/rules';

export type MatchTuning = (typeof import('../../../data/tuning.json'))['partido'];

/**
 * States of the match machine (GDD §4). Superiority and inferiority are not states of their own:
 * they are the positional attack with a man more or less (exclusions change the shapes).
 */
export type MatchPhase =
  | 'swimOffReady'
  | 'swimOff'
  | 'transition'
  | 'positional'
  | 'setPiece'
  | 'penalty'
  | 'goal'
  | 'periodEnd'
  | 'fullTime';

export type SetPieceKind = 'goalThrow' | 'corner' | 'restart' | 'freeThrow';

/** Why a free throw was given: the shot clock ran out, or a foul. */
export type FreeThrowReason = 'clock' | 'foul';

export interface SetPiece {
  kind: SetPieceKind;
  reason: FreeThrowReason | null;
  side: TeamSide;
  taker: Swimmer;
  spot: Vec2;
  /** Whistle time; before it everybody takes position. */
  readyAt: number;
  /** After this the AI takes the throw for whoever is slow. */
  deadline: number;
  whistled: boolean;
  /** The phase play goes back to after the whistle. */
  resume: 'transition' | 'positional';
}

/** A player sent off for a while (WP 10.4–10.5), swimming to the re-entry area behind his goal line. */
export interface Exclusion {
  swimmer: Swimmer;
  /** Scoreboard seconds left; they only run while the ball is in play. */
  left: number;
  /** Out for the rest of the match (third personal foul, red card): a substitute comes back instead. */
  forGame: boolean;
  /** Violent action: the substitute waits `subLeft` scoreboard seconds whatever happens (WP 10.8). */
  brutal: boolean;
  subLeft: number;
  /** The way back is open (time out, a goal, the ball back, a throw for his team). */
  canReturn: boolean;
  /** After a goal they may come back from anywhere, not only from the re-entry area. */
  anywhere: boolean;
  /** Out for good and already replaced: he only has to leave the pool. */
  replaced: boolean;
  reason: ExclusionEnd | null;
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
  | 'block'
  | 'foul'
  | 'penalty';

/** What the pad does right now, for the small icon next to it (GDD §4). */
export type PadMode = 'none' | 'sprint' | 'pass' | 'swim' | 'defend' | 'keeper' | 'shoot' | 'save';

export type MatchEvent =
  | AttackEvent
  | { type: 'phase'; phase: MatchPhase; previous: MatchPhase }
  | { type: 'possession'; side: TeamSide; reason: PossessionReason }
  | { type: 'advantage'; attackers: number; defenders: number }
  | { type: 'swimOffWon'; by: Swimmer }
  | { type: 'goal'; side: TeamSide; scorer: Swimmer | null; score: [number, number] }
  | { type: 'setPiece'; kind: SetPieceKind; side: TeamSide; reason: FreeThrowReason | null }
  | { type: 'periodEnd'; period: number }
  | { type: 'fullTime'; score: [number, number] }
  | { type: 'horn' }
  | { type: 'switch'; to: Swimmer }
  | { type: 'stealTry'; by: Swimmer; won: boolean }
  | { type: 'anticipate'; by: Swimmer }
  | { type: 'contact'; by: Swimmer; on: Swimmer; strong: boolean }
  | { type: 'burst'; who: Swimmer }
  | {
      type: 'foul';
      sanction: Exclude<Sanction, 'none'>;
      motive: Motive;
      by: Swimmer;
      on: Swimmer | null;
      /** Team that gets the throw (or the penalty). */
      awarded: TeamSide;
      card: 'yellow' | 'red' | null;
      teamWarning: boolean;
      /** Personal fouls of the offender after this one. */
      personal: number;
      /** Out for the rest of the match. */
      out: boolean;
      /** Committed by the team with the ball: the ball goes to the other team. */
      offensive: boolean;
    }
  | { type: 'heldCall'; on: Swimmer }
  | { type: 'advantagePlayed'; on: Swimmer }
  | { type: 'exclusionEnd'; who: Swimmer; reason: ExclusionEnd }
  | { type: 'substitution'; out: Swimmer; in: Swimmer }
  | { type: 'penalty'; shooter: Swimmer; keeper: Swimmer }
  | { type: 'rotation'; shape: '4-2' | '3-3' }
  | { type: 'mustPass'; who: Swimmer };

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
  /** Ordinary fouls committed. */
  fouls: number;
  /** Exclusions committed (each one is a superiority for the rival). */
  exclusions: number;
  /** Penalties conceded. */
  penalties: number;
  /** Attacks with a man more, and goals scored in them. */
  manUp: number;
  manUpGoals: number;
  yellows: number;
  reds: number;
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
  fouls: 0,
  exclusions: 0,
  penalties: 0,
  manUp: 0,
  manUpGoals: 0,
  yellows: 0,
  reds: 0,
});
