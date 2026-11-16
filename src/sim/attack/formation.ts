/**
 * Slots of the 3-3 attack (data/formaciones.json) and who goes where (GDD §6.1–6.3): positions
 * follow each player's Puesto and hand; left-handers prefer the right side of the attack.
 */
import type { Player, Position } from '../../data/model';
import type { FormationsData } from '../../data/schema';
import { fromGoal, type Goal, type Vec2 } from '../field';
import type { Slot } from './types';

/** Cost of playing a slot for each Puesto (0 = natural). */
const POSITION_COST: Record<Exclude<Position, 'goalkeeper'>, Record<'boya' | 'extremo' | 'lateral' | 'cierre', number>> = {
  center: { boya: 0, extremo: 3, lateral: 2.5, cierre: 2 },
  wing: { boya: 3, extremo: 0, lateral: 1, cierre: 2 },
  driver: { boya: 2.5, extremo: 1, lateral: 0, cierre: 1 },
  point: { boya: 2, extremo: 2, lateral: 1, cierre: 0 },
};

const kind = (slot: Slot): 'boya' | 'extremo' | 'lateral' | 'cierre' =>
  slot === 'boya' ? 'boya' : slot === 'cierre' ? 'cierre' : slot.startsWith('extremo') ? 'extremo' : 'lateral';

/** Right side of the attack (from the attacker's point of view). */
export const isRightSide = (slot: Slot): boolean => slot.endsWith('Der');
export const isLeftSide = (slot: Slot): boolean => slot.endsWith('Izq');

export function slotCost(player: Player, slot: Slot): number {
  const position = player.position === 'goalkeeper' ? 'point' : player.position;
  let cost = POSITION_COST[position][kind(slot)];
  // A defensive archetype can hold the centre spot if needed.
  if (slot === 'boya' && player.archetype === 'defender') cost -= 0.8;
  if (player.hand === 'left') cost += isRightSide(slot) ? -0.6 : isLeftSide(slot) ? 0.6 : 0;
  else if (isRightSide(slot)) cost += 0.1;
  return cost;
}

function* permutations(n: number): Generator<number[]> {
  const items = Array.from({ length: n }, (_, i) => i);
  const c = Array<number>(n).fill(0);
  yield items.slice();
  let i = 0;
  while (i < n) {
    if ((c[i] as number) < i) {
      const j = i % 2 === 0 ? 0 : (c[i] as number);
      [items[i], items[j]] = [items[j] as number, items[i] as number];
      yield items.slice();
      c[i] = (c[i] as number) + 1;
      i = 0;
    } else {
      c[i] = 0;
      i++;
    }
  }
}

/** Minimum-cost assignment of n items to n slots by brute force (n ≤ 6: at most 720 orders). */
export function assign<T>(items: readonly T[], slots: readonly Slot[], cost: (item: T, slot: Slot) => number): Map<T, Slot> {
  if (items.length !== slots.length) throw new Error('assign: hay que repartir tantos jugadores como puestos');
  let best: number[] = [];
  let bestCost = Infinity;
  for (const order of permutations(items.length)) {
    let total = 0;
    for (let i = 0; i < order.length && total < bestCost; i++) total += cost(items[i] as T, slots[order[i] as number] as Slot);
    if (total < bestCost) {
      bestCost = total;
      best = order;
    }
  }
  return new Map(items.map((item, i) => [item, slots[best[i] as number] as Slot]));
}

export function assignSlots(players: readonly Player[], slots: readonly Slot[]): Map<Player, Slot> {
  return assign(players, slots, slotCost);
}

/**
 * Picks the players for a set of slots from a squad: real players first, then the best fit by
 * Puesto and hand. Returns them already matched to their slots.
 */
export function pickLineup(squad: readonly Player[], slots: readonly Slot[]): Map<Player, Slot> {
  const pool = squad.filter((p) => p.position !== 'goalkeeper');
  const chosen: Player[] = [];
  // Hardest slots first, so a scarce Puesto (the centre) is not used up elsewhere.
  const order = [...slots].sort((a, b) => ['boya', 'cierre', 'lateralDer', 'lateralIzq', 'extremoDer', 'extremoIzq'].indexOf(a) - ['boya', 'cierre', 'lateralDer', 'lateralIzq', 'extremoDer', 'extremoIzq'].indexOf(b));
  for (const slot of order) {
    const best = pool
      .filter((p) => !chosen.includes(p))
      .sort((a, b) => (a.origin === 'provisional' ? 1 : 0) - (b.origin === 'provisional' ? 1 : 0) || slotCost(a, slot) - slotCost(b, slot) || a.number - b.number)[0];
    if (best) chosen.push(best);
  }
  return assignSlots(chosen, slots.slice(0, chosen.length));
}

/** World point of a slot, kept out of the 2-metre zone (GDD §6.3). */
export function slotPoint(formations: FormationsData, slot: Slot, goal: Goal, minDistance: number): Vec2 {
  const base = formations.ataque33?.puestos[slot] ?? { x: 5, y: 0, radioZona: 1 };
  return fromGoal(goal, Math.max(minDistance, base.x), base.y);
}

/** Inverse of fromGoal: distance from the goal line and lateral offset (positive = attacker's left). */
export function toGoal(goal: Goal, p: Vec2): { distance: number; lateral: number } {
  return { distance: (goal.x - p.x) * goal.facing, lateral: (goal.y - p.y) * goal.facing };
}
