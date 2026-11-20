/** Helpers to build attack scenes for the tests: players, swimmers and whole drills. */
import formationsJson from '../../data/formaciones.json';
import rulesJson from '../../data/reglas.json';
import tuning from '../../data/tuning.json';
import { Rng } from '../../src/core/rng';
import type { Player, Position, Stats, Team } from '../../src/data/model';
import { FormationsSchema, RulesSchema } from '../../src/data/schema';
import { AttackDrill, type DefenseStyle } from '../../src/sim/attack/drill';
import type { PadState } from '../../src/sim/attack/control';
import type { Slot, Swimmer, TeamSide } from '../../src/sim/attack/types';
import { fieldFromRules } from '../../src/sim/field';
import { Match } from '../../src/sim/match/match';
import type { RefereeProfile } from '../../src/sim/referee/referee';

export const rules = RulesSchema.parse(rulesJson);
export const field = fieldFromRules(rules);
/** A neutral, very consistent referee. */
export const NEUTRAL_REFEREE: RefereeProfile = { contactTolerance: 5, exclusionTendency: 5, cardTendency: 5, bias: 0, consistency: 9 };
export const formations = FormationsSchema.parse(formationsJson);
export const T = tuning.ataque;
export const TILT = 0.82;
export const NEUTRAL: PadState = { x: 0, y: 0, touching: false, shot: false, skill: false };

const FIVE: Stats = { speed: 5, stamina: 5, power: 5, accuracy: 5, passing: 5, skill: 5, defense: 5, aggression: 5 };
const POSITION_OF: Record<Slot, Position> = {
  boya: 'center',
  extremoIzq: 'wing',
  extremoDer: 'wing',
  lateralIzq: 'driver',
  lateralDer: 'driver',
  cierre: 'point',
};

let serial = 0;
export function makePlayer(position: Position, stats: Partial<Stats> = {}, hand: 'right' | 'left' = 'right', number = ++serial): Player {
  return {
    id: `p${number}-${position}`,
    number,
    nickname: `P${number}`,
    position,
    hand,
    archetype: position === 'goalkeeper' ? 'goalkeeper' : 'allRounder',
    stats: { ...FIVE, ...stats },
    ...(position === 'goalkeeper' ? { keeperStats: { reflexes: 5, positioning: 5, rushing: 5 } } : {}),
    phrases: [],
    photos: [],
    origin: 'real',
    star: false,
    emptyBars: 0,
  };
}

/** A bare swimmer for pure selector tests. */
export function makeSwimmer(x: number, y: number, team: TeamSide, stats: Partial<Stats> = {}, keeper = false): Swimmer {
  const player = makePlayer(keeper ? 'goalkeeper' : 'driver', stats);
  return {
    id: `${team}-${player.id}`,
    player,
    team,
    keeper,
    topSpeed: 1.7,
    pos: { x, y },
    prev: { x, y },
    vel: { x: 0, y: 0 },
    target: { x, y },
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
    burstDir: { x: 0, y: 0 },
    protectUntil: 0,
    cooldownUntil: 0,
    struggle: 0,
    anticipation: 0,
    speedPenalty: 1,
    contactPressure: 0,
    energy: 1,
  };
}

export interface DrillOptions {
  slots?: Slot[];
  attack?: Partial<Record<Slot, Partial<Stats>>>;
  defense?: Partial<Record<Slot, Partial<Stats>>>;
  allAttack?: Partial<Stats>;
  allDefense?: Partial<Stats>;
  style?: DefenseStyle;
  seed?: number | string;
}

export function makeDrill(options: DrillOptions = {}): AttackDrill {
  const slots = options.slots ?? ['boya', 'extremoIzq', 'extremoDer', 'lateralIzq', 'lateralDer', 'cierre'];
  const lineup = new Map<Player, Slot>();
  const marking = new Map<Player, Slot>();
  for (const slot of slots) {
    lineup.set(makePlayer(POSITION_OF[slot], { ...options.allAttack, ...options.attack?.[slot] }), slot);
    marking.set(makePlayer(POSITION_OF[slot], { ...options.allDefense, ...options.defense?.[slot] }), slot);
  }
  return new AttackDrill({
    field,
    formations,
    lineup,
    marking,
    keeper: makePlayer('goalkeeper'),
    defenseStyle: options.style ?? 'press',
    possession: { first: 28, second: 18, clockSpeed: 1.6 },
    tuning: T,
    shot: tuning.tiro,
    keeperTuning: tuning.portero,
    tilt: TILT,
    rng: new Rng(options.seed ?? 'drill'),
  });
}

export function attacker(drill: AttackDrill, slot: Slot): Swimmer {
  const found = drill.attackers.find((a) => a.slot === slot);
  if (!found) throw new Error(`no hay ${slot}`);
  return found;
}

/** Steps the drill with the same input `n` times and collects every event. */
export function run(drill: AttackDrill, pad: Partial<PadState>, n: number) {
  const events = [];
  for (let i = 0; i < n; i++) events.push(...drill.step({ ...NEUTRAL, ...pad }));
  return events;
}

/** Steps until the attack is live. */
export function untilLive(drill: AttackDrill): void {
  for (let i = 0; i < 600 && drill.phase !== 'live'; i++) drill.step(NEUTRAL);
}

/** Taps the pad in a screen direction like a player would: a few steps out, then release. */
export function tapPad(drill: AttackDrill, x: number, y: number, steps = 4) {
  return [...run(drill, { x, y }, steps), ...run(drill, {}, 1)];
}

// ---------------------------------------------------------------------------------------------
// Full matches
// ---------------------------------------------------------------------------------------------

export function makeTeam(id: string, stats: Partial<Stats> = {}, style: Team['style'] = 'balanced'): Team {
  const field: Position[] = ['center', 'wing', 'wing', 'driver', 'driver', 'point', 'center', 'driver'];
  const players = [...field.map((p) => makePlayer(p, stats)), makePlayer('goalkeeper', stats)];
  return { id, name: id, code: id.slice(0, 3).toUpperCase(), level: 5, style, inCup: true, emilioTips: [], players, origin: 'provisional' };
}

export interface MatchOptions {
  human?: boolean;
  home?: Partial<Stats>;
  away?: Partial<Stats>;
  homeStyle?: Team['style'];
  awayStyle?: Team['style'];
  seed?: number | string;
  periods?: number;
  periodSeconds?: number;
  clockSpeed?: number;
  difficulty?: 'facil' | 'normal' | 'dificil';
  referee?: Partial<RefereeProfile>;
  manUp?: 'attack' | 'defend';
}

export function makeMatch(options: MatchOptions = {}): Match {
  const home = makeTeam('locales', options.home, options.homeStyle);
  const away = makeTeam('visitantes', options.away, options.awayStyle);
  const pick = (team: Team) => ({
    team,
    field: team.players.filter((p) => p.position !== 'goalkeeper').slice(0, 6),
    bench: team.players.filter((p) => p.position !== 'goalkeeper').slice(6),
    keeper: team.players.find((p) => p.position === 'goalkeeper') as Player,
  });
  return new Match({
    field,
    formations,
    sides: [
      { ...pick(home), human: options.human ?? false },
      { ...pick(away), human: false },
    ],
    periods: options.periods ?? 4,
    periodSeconds: options.periodSeconds ?? 480,
    clockSpeed: options.clockSpeed ?? 3.2,
    possession: { first: 28, second: 18, clockSpeed: 1.6 },
    tuning: T,
    match: tuning.partido,
    shot: tuning.tiro,
    keeperTuning: tuning.portero,
    tilt: TILT,
    rng: new Rng(options.seed ?? 'partido'),
    difficulty: options.difficulty ?? 'normal',
    tapMs: 180,
    autoSwitch: true,
    rules,
    referee: { ...NEUTRAL_REFEREE, ...options.referee },
    refereeTuning: tuning.arbitro,
    penalty: tuning.penalti,
    ...(options.manUp ? { manUp: options.manUp } : {}),
  });
}

export function runMatch(match: Match, pad: Partial<PadState>, n: number) {
  const events = [];
  for (let i = 0; i < n; i++) events.push(...match.step({ ...NEUTRAL, ...pad }));
  return events;
}
