/**
 * Pool geometry and coordinates.
 * World space, in metres: x runs along the pool (0 … length), y across it (0 … width) and grows
 * downwards on screen; z is height above the water. Our team attacks towards +x.
 */
import type { RulesData } from '../data/schema';

export interface Vec2 {
  x: number;
  y: number;
}
export interface Vec3 extends Vec2 {
  z: number;
}

export interface Goal {
  /** Centre of the goal line. */
  x: number;
  y: number;
  halfWidth: number;
  height: number;
  /** +1 when the goal mouth faces −x (the goal on the right), −1 for the one on the left. */
  facing: 1 | -1;
}

export interface Field {
  length: number;
  width: number;
  /** Distances from each goal line. */
  twoMetres: number;
  fiveMetres: number;
  sixMetres: number;
  /** The goal our team attacks (right side). */
  goalRight: Goal;
  goalLeft: Goal;
}

export function fieldFromRules(rules: RulesData): Field {
  const { largo, ancho, porteriaAncho, porteriaAlto, lineas } = rules.campo;
  const goal = (x: number, facing: 1 | -1): Goal => ({ x, y: ancho / 2, halfWidth: porteriaAncho / 2, height: porteriaAlto, facing });
  return {
    length: largo,
    width: ancho,
    twoMetres: lineas.dosMetros,
    fiveMetres: lineas.penalti,
    sixMetres: lineas.seisMetros,
    goalRight: goal(largo, 1),
    goalLeft: goal(0, -1),
  };
}

/**
 * Formation coordinates (GDD §6.2) → world. `distance` is measured from the attacked goal line,
 * `lateral` from the goal axis, positive towards the attacker's left.
 */
export function fromGoal(goal: Goal, distance: number, lateral: number): Vec2 {
  // Facing +x (attacking the right goal) the attacker's left is screen-up, i.e. smaller y.
  return { x: goal.x - goal.facing * distance, y: goal.y - goal.facing * lateral };
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
