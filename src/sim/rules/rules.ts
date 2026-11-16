/**
 * The rules engine (GDD §12): pure functions that say WHAT a contact is under the rulebook
 * (nothing, ordinary foul, exclusion, penalty or violent action) and what follows from it.
 * Whether it is whistled is the referee's business (src/sim/referee). All values come from
 * data/reglas.json and data/tuning.json.
 *
 * References are to the World Aquatics water polo rules, February 2026 (RFEN translation).
 */
import type { RulesData } from '../../data/schema';
import { toGoal } from '../attack/formation';
import type { Goal, Vec2 } from '../field';

/** How the contact was made. `strike` is a kick or a blow: violent action. */
export type ContactKind = 'hold' | 'grab' | 'sink' | 'pullBack' | 'arms' | 'push' | 'strike';

export type Sanction = 'none' | 'ordinary' | 'exclusion' | 'penalty' | 'violent';

/** Short captions shown with the whistle (GDD §13: "AGARRÓN, HUNDIR, POR DETRÁS, BRAZOS…"). */
export type Motive =
  | 'FALTA'
  | 'AGARRÓN'
  | 'HUNDIR'
  | 'TIRAR ATRÁS'
  | 'BRAZOS'
  | 'POR DETRÁS'
  | 'GOL CLARO'
  | 'FALTA TÁCTICA'
  | 'EMPUJÓN'
  | 'GOLPE'
  | '2 METROS';

export interface Contact {
  kind: ContactKind;
  /** 0–1: how hard. Light contact is part of the game and is not a foul. */
  intensity: number;
  /** The one who makes the contact is in the team with the ball (offensive foul). */
  byAttacker: boolean;
  /** The victim holds the ball. */
  victimHasBall: boolean;
  /** The victim is in the act of shooting. */
  victimShooting: boolean;
  /** Contact from behind (the infractor is further from the goal than the victim). */
  fromBehind: boolean;
  /** The victim is inside the infractor's defensive 6 m area. */
  inSixMetres: boolean;
  /** Without the foul, a goal would probably have followed (WP 11.1.1.1). */
  probableGoal: boolean;
  /** It stops a counter-attack: a tactical foul (WP 10.1.5). */
  counterAttack: boolean;
}

export interface Classified {
  sanction: Sanction;
  motive: Motive;
}

/** Arcade thresholds of the classification (data/tuning.json → arbitro.clasificacion). */
export interface ClassifyTuning {
  /** Below this intensity a contact is legal. */
  legalHasta: number;
  /** From this intensity, holding a player without the ball is an exclusion; below it, ordinary. */
  exclusionDesde: number;
}

const MOTIVE: Record<ContactKind, Motive> = {
  hold: 'AGARRÓN',
  grab: 'AGARRÓN',
  sink: 'HUNDIR',
  pullBack: 'TIRAR ATRÁS',
  arms: 'BRAZOS',
  push: 'EMPUJÓN',
  strike: 'GOLPE',
};

/** What the rulebook makes of a contact. */
export function classify(c: Contact, t: ClassifyTuning): Classified {
  // A kick or a blow is violent action whatever the situation (WP 10.2.1, 10.8).
  if (c.kind === 'strike') return { sanction: 'violent', motive: 'GOLPE' };
  if (c.intensity < t.legalHasta) return { sanction: 'none', motive: 'FALTA' };
  // Pushing off an opponent: ordinary foul against the attack (WP 8.2.7).
  if (c.byAttacker) return { sanction: 'ordinary', motive: 'EMPUJÓN' };
  if (c.inSixMetres) {
    // Impeding a shooter from behind inside 6 m (WP 11.1.1.4) or any foul that stops a probable goal (11.1.1.1).
    if (c.victimShooting && c.fromBehind) return { sanction: 'penalty', motive: 'POR DETRÁS' };
    if (c.probableGoal) return { sanction: 'penalty', motive: 'GOL CLARO' };
  }
  // Stopping a break on purpose (WP 10.1.5).
  if (c.counterAttack) return { sanction: 'exclusion', motive: 'FALTA TÁCTICA' };
  // Contact on the player holding the ball is part of the game; a hard one is an ordinary foul.
  if (c.victimHasBall) return { sanction: 'ordinary', motive: 'FALTA' };
  // Holding, sinking or pulling back a player without the ball (WP 10.1.4).
  if (c.intensity < t.exclusionDesde) return { sanction: 'ordinary', motive: 'FALTA' };
  return { sanction: 'exclusion', motive: MOTIVE[c.kind] };
}

/** One step down the scale, for a referee who lets it go as something lighter (never heavier). */
export function softer(sanction: Sanction, victimHasBall: boolean): Sanction {
  switch (sanction) {
    case 'violent':
      return 'exclusion';
    case 'penalty':
      return victimHasBall ? 'ordinary' : 'exclusion';
    case 'exclusion':
      return 'ordinary';
    default:
      return 'none';
  }
}

/** Every sanction that counts as a personal foul (WP 17.1). */
export const isPersonal = (s: Sanction): boolean => s === 'exclusion' || s === 'penalty' || s === 'violent';

/** Shot clock after an exclusion that keeps the ball with the same team: 18, or more if more was left (WP 9.9). */
export function shotClockAfterExclusion(remaining: number, rules: RulesData): number {
  return Math.max(rules.posesion.trasExclusion, remaining);
}

/** Inside a goal area: the 2 m deep box in front of the goal, 2 m beyond each post (WP 20.4). */
export function inGoalArea(p: Vec2, goal: Goal, rules: RulesData): boolean {
  const g = toGoal(goal, p);
  return g.distance >= 0 && g.distance < rules.campo.lineas.dosMetros && Math.abs(g.lateral) < rules.areaGol.ancho / 2;
}

/**
 * An attacker in the opponents' goal area ahead of the ball line is an ordinary foul (WP 8.2.8).
 * Behind the ball line it is allowed.
 */
export function goalAreaOffence(attacker: Vec2, ball: Vec2, goal: Goal, rules: RulesData): boolean {
  if (!inGoalArea(attacker, goal, rules)) return false;
  return toGoal(goal, attacker).distance < toGoal(goal, ball).distance - 0.2;
}

/** Where a free throw is taken: at the ball, or on the 2 m line if the defence fouled inside the goal area (WP 12.5.1). */
export function freeThrowSpot(ball: Vec2, goal: Goal, defenceFoul: boolean, rules: RulesData): Vec2 {
  if (!defenceFoul || !inGoalArea(ball, goal, rules)) return { x: ball.x, y: ball.y };
  const g = toGoal(goal, ball);
  return { x: goal.x - goal.facing * rules.campo.lineas.dosMetros, y: goal.y - g.lateral * goal.facing };
}

/** From a free throw outside 6 m the taker may shoot straight away (WP 7.5.1.2). */
export function directShotAllowed(spot: Vec2, goal: Goal, rules: RulesData): boolean {
  return toGoal(goal, spot).distance > rules.tiroDirectoFueraDe;
}

/**
 * Ball out over a goal line, not in the goal (WP 13 and 14): a corner if the defending
 * goalkeeper touched it last, or a defender who played it on purpose (not a deflected shot);
 * a goal throw otherwise.
 */
export function overGoalLine(last: { defender: boolean; keeper: boolean; blockedShot: boolean } | null): 'corner' | 'goalThrow' {
  if (!last || !last.defender) return 'goalThrow';
  if (last.keeper) return 'corner';
  return last.blockedShot ? 'goalThrow' : 'corner';
}

/** Why an exclusion ends early (WP 10.5.2): a goal, the ball back, or a throw awarded to them. */
export type ExclusionEnd = 'time' | 'goal' | 'possession' | 'throw';

/** After a violent action the substitute waits this long in scoreboard seconds (WP 10.8.2.3). */
export const brutalitySeconds = (rules: RulesData): number => rules.exclusion.brutalidadMinutos * 60;
