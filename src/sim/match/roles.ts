/**
 * Team shape outside the set attack (GDD §8): who marks whom when retreating, numerical
 * advantage on the break, and when the defence has arrived.
 */
import type { Goal, Vec2 } from '../field';
import { insidePoint } from '../attack/drive';
import { toGoal } from '../attack/formation';
import type { Swimmer } from '../attack/types';
import { dist } from '../attack/vec';

/**
 * Minimum-cost matching of rows to columns (n, m ≤ 6) by exhaustive search with pruning.
 * Returns, for each row, the chosen column or −1 when there are more rows than columns.
 */
export function bestMatching(rows: number, cols: number, cost: (r: number, c: number) => number): number[] {
  const best: number[] = Array<number>(rows).fill(-1);
  const current: number[] = Array<number>(rows).fill(-1);
  const used = Array<boolean>(cols).fill(false);
  let bestCost = Infinity;
  // Each row either takes a free column or (only when columns run out) none.
  const spare = Math.max(0, rows - cols);
  const search = (r: number, total: number, skipped: number): void => {
    if (total >= bestCost) return;
    if (r === rows) {
      bestCost = total;
      for (let i = 0; i < rows; i++) best[i] = current[i] as number;
      return;
    }
    for (let c = 0; c < cols; c++) {
      if (used[c]) continue;
      used[c] = true;
      current[r] = c;
      search(r + 1, total + cost(r, c), skipped);
      used[c] = false;
    }
    if (skipped < spare) {
      current[r] = -1;
      search(r + 1, total, skipped + 1);
    }
  };
  search(0, 0, 0);
  return best;
}

/** How dangerous an attacker is: close to goal, and more with the ball. */
export function danger(attacker: Swimmer, goal: Goal, holder: Swimmer | null): number {
  const close = Math.max(0, Math.min(1, 1 - toGoal(goal, attacker.pos).distance / 15));
  return close + (attacker === holder ? 0.5 : 0);
}

/**
 * Retreat (GDD §8.2): the defenders who can get there first take the most dangerous attackers;
 * the rest go by proximity. Works with unequal numbers (a man down, a 2-on-1 lab).
 */
export function assignMarks(defenders: readonly Swimmer[], attackers: readonly Swimmer[], goal: Goal, holder: Swimmer | null, dangerWeight: number): Map<Swimmer, Swimmer | null> {
  const columns = attackers;
  const result = bestMatching(defenders.length, columns.length, (r, c) => {
    const d = defenders[r] as Swimmer;
    const a = columns[c] as Swimmer;
    const reach = dist(d.pos, insidePoint(a.pos, goal, 0.9)) / Math.max(0.5, d.topSpeed);
    return reach - danger(a, goal, holder) * dangerWeight;
  });
  const marks = new Map<Swimmer, Swimmer | null>();
  defenders.forEach((d, i) => marks.set(d, result[i] !== undefined && result[i] >= 0 ? (columns[result[i] as number] as Swimmer) : null));
  return marks;
}

/**
 * Attackers at or ahead of the ball against defenders between the ball and the goal
 * ("¡CONTRA 2x1!"). It only counts when the ball is well into the attacking half and someone
 * within shooting range is really free (no defender within `free` metres): a defender a stroke
 * behind still covers.
 */
export function countAdvantage(
  attackers: readonly Swimmer[],
  defenders: readonly Swimmer[],
  ball: Vec2,
  goal: Goal,
  from = 12.5,
  free = 0,
): { attackers: number; defenders: number } | null {
  const ballDistance = toGoal(goal, ball).distance;
  if (ballDistance > from) return null;
  const ahead = attackers.filter((a) => toGoal(goal, a.pos).distance <= ballDistance + 0.5);
  const back = defenders.filter((d) => toGoal(goal, d.pos).distance < ballDistance + 0.8).length;
  if (ahead.length <= back) return null;
  if (free > 0) {
    // Somebody (the ball carrier included) is unmarked within shooting range.
    const loose = ahead.some((a) => toGoal(goal, a.pos).distance < 7 && defenders.every((d) => dist(d.pos, a.pos) >= free));
    if (!loose) return null;
  }
  return { attackers: ahead.length, defenders: back };
}

/** Every defender is near the spot they were heading to: the defence is set. */
export function defenceSettled(defenders: readonly Swimmer[], arrival: number): boolean {
  return defenders.every((d) => dist(d.pos, d.target) <= arrival);
}
