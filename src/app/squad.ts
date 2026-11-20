/**
 * The convocatoria (GDD §3.2, §11): six field players and a keeper in the water, and a few
 * substitutes on the bench. Saved by player ID; whatever no longer exists in the data (a player
 * taken out of the sheet) is filled in again automatically, so a saved squad never breaks a match.
 */
import type { Player, Team } from '../data/model';
import type { HandCost } from '../sim/attack/formation';
import { pickLineup } from '../sim/attack/formation';
import { SLOTS } from '../sim/attack/types';
import { pickKeeper } from '../sim/duel/shootout';

export interface SavedSquad {
  starters: string[];
  keeper: string | null;
  bench: string[];
}

export interface Squad {
  field: Player[];
  keeper: Player;
  bench: Player[];
}

/** A field player's overall, to pick the best substitutes: the eight bars (real before invented). */
function overall(p: Player): number {
  const s = p.stats;
  return s.speed + s.stamina + s.power + s.accuracy + s.passing + s.skill + s.defense + s.aggression - (p.origin === 'provisional' ? 100 : 0);
}

/** The squad the coach would pick: the lineup that fits the 3-3 best, the best keeper and the best of the rest. */
export function autoSquad(team: Team, benchSize: number, hand: HandCost): SavedSquad {
  const field = [...pickLineup(team.players, SLOTS, hand).keys()];
  const keeper = pickKeeper(team);
  const bench = team.players
    .filter((p) => p.position !== 'goalkeeper' && !field.includes(p))
    .sort((a, b) => overall(b) - overall(a) || a.number - b.number)
    .slice(0, benchSize);
  return { starters: field.map((p) => p.id), keeper: keeper.id, bench: bench.map((p) => p.id) };
}

/**
 * The players of a saved squad. Unknown IDs are dropped, a player is only in one place, and any
 * gap (fewer than six starters, no keeper) is filled with the automatic choice.
 */
export function resolveSquad(team: Team, saved: SavedSquad | null, benchSize: number, hand: HandCost): Squad {
  const byId = new Map(team.players.map((p) => [p.id, p]));
  const used = new Set<Player>();
  const take = (ids: readonly string[], fieldOnly: boolean): Player[] => {
    const out: Player[] = [];
    for (const id of ids) {
      const p = byId.get(id);
      if (!p || used.has(p) || (fieldOnly && p.position === 'goalkeeper')) continue;
      used.add(p);
      out.push(p);
    }
    return out;
  };
  const auto = autoSquad(team, benchSize, hand);
  const field = take(saved?.starters ?? auto.starters, true).slice(0, 6);
  const savedKeeper = saved?.keeper ? byId.get(saved.keeper) : undefined;
  let keeper = savedKeeper && savedKeeper.position === 'goalkeeper' ? savedKeeper : undefined;
  if (keeper) used.add(keeper);
  const bench = take(saved?.bench ?? auto.bench, true).slice(0, benchSize);
  // Gaps: the automatic choice first, then anybody left.
  for (const p of [...take(auto.starters, true), ...team.players.filter((x) => x.position !== 'goalkeeper' && !used.has(x))]) {
    if (field.length >= 6) break;
    used.add(p);
    field.push(p);
  }
  if (!keeper) {
    keeper = team.players.find((p) => p.id === auto.keeper) ?? pickKeeper(team);
  }
  return { field, keeper, bench };
}

/** Our cap and the rival's (the other colour). */
export function capsOf(cap: 'white' | 'blue'): Record<0 | 1, 'white' | 'blue'> {
  return { 0: cap, 1: cap === 'white' ? 'blue' : 'white' };
}

/** What the convocatoria screen says is missing before playing. */
export function squadProblems(squad: SavedSquad, benchSize: number): string[] {
  const problems: string[] = [];
  if (squad.starters.length < 6) problems.push(`Faltan ${6 - squad.starters.length} titulares`);
  if (!squad.keeper) problems.push('Falta el portero');
  if (squad.bench.length > benchSize) problems.push(`Sobran ${squad.bench.length - benchSize} suplentes`);
  return problems;
}
