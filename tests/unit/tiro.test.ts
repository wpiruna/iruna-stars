import { describe, expect, it } from 'vitest';
import tuning from '../../data/tuning.json';
import { Rng } from '../../src/core/rng';
import type { Goal } from '../../src/sim/field';
import {
  estimateSave,
  evaluateCharge,
  keeperPosition,
  optimalZone,
  planShot,
  resolveShot,
  topSpeed,
  type AimSide,
  type KeeperContext,
  type KeeperState,
  type ShotMode,
} from '../../src/sim/shooting/model';
import { ballAt } from '../../src/sim/shooting/trajectory';

const goal: Goal = { x: 25, y: 10, halfWidth: 1.5, height: 0.9, facing: 1 };
const T = tuning.tiro;
const K = tuning.portero;

interface Scenario {
  distance: number;
  lateral?: number;
  power?: number;
  accuracy?: number;
  reflexes?: number;
  positioning?: number;
  mode?: ShotMode;
  /** How the bar is released: dead centre of the sweet spot, a believable human, or a quick shot. */
  charge?: 'optimal' | 'human' | 'quick';
  context?: KeeperContext;
}

/** Plays a scenario many times and returns the share of each result (0–1). */
function simulate(label: string, o: Scenario, shots = 6000) {
  const rng = new Rng(label);
  const shooter = { power: o.power ?? 5, accuracy: o.accuracy ?? 5, energy: 1 };
  const keeper = { reflexes: o.reflexes ?? 5, positioning: o.positioning ?? 5, energy: 1 };
  const from = { x: goal.x - o.distance, y: goal.y + (o.lateral ?? 0) };
  const zone = optimalZone(shooter.accuracy, T);
  const context = o.context ?? 'open';
  const count = { goal: 0, save: 0, post: 0, miss: 0 };
  let minP = 1;
  let maxP = 0;

  for (let i = 0; i < shots; i++) {
    const side: AimSide = rng.chance(0.5) ? 1 : -1;
    const charge =
      o.charge === 'quick' ? null : o.charge === 'human' ? T.zonaOptimaCentro + rng.gauss() * 0.06 : (zone.start + zone.end) / 2;
    const keeperU = context === 'penalty' ? 0 : keeperPosition(from, goal, keeper, rng, K);
    const plan = planShot({ from, releaseHeight: 0.9, charge, side, mode: o.mode ?? 'direct', pressure: 0 }, shooter, goal, keeperU, rng, T);
    const state: KeeperState = { u: keeperU, set: 1 };
    if (context === 'penalty') {
      // A keeper that guesses blind, like the AI when it does not read the shooter.
      const roll = rng.next();
      const stay = tuning.penalti.ia.probQuedarse;
      state.commit = { side: roll < stay ? 0 : roll < stay + (1 - stay) / 2 ? -1 : 1, timing: 0.9 };
    }
    const result = resolveShot(plan, goal, keeper, state, context, rng, T, K);
    if (result.save) {
      minP = Math.min(minP, result.save.probability);
      maxP = Math.max(maxP, result.save.probability);
    }
    count[result.outcome.type]++;
  }
  return { goal: count.goal / shots, save: count.save / shots, post: count.post / shots, miss: count.miss / shots, minP, maxP };
}

describe('barra de carga', () => {
  it('la zona óptima está hacia el 70–85 % y es más ancha con más Precisión', () => {
    const low = optimalZone(2, T);
    const high = optimalZone(9, T);
    expect(low.start).toBeGreaterThan(0.68);
    expect(high.end).toBeLessThan(0.9);
    expect(high.end - high.start).toBeGreaterThan((low.end - low.start) * 1.8);
  });

  it('corto da menos potencia, en la zona da la mejor precisión y pasarse dispersa', () => {
    const quick = evaluateCharge(null, 5, T);
    const short = evaluateCharge(0.3, 5, T);
    const optimal = evaluateCharge(0.78, 5, T);
    const over = evaluateCharge(1, 5, T);
    expect([quick.quality, short.quality, optimal.quality, over.quality]).toEqual(['quick', 'short', 'optimal', 'over']);
    expect(short.power).toBeLessThan(optimal.power);
    expect(quick.power).toBeLessThan(optimal.power);
    expect(optimal.spread).toBe(1);
    expect(over.power).toBe(1);
    expect(over.spread).toBeGreaterThan(3);
    expect(quick.spread).toBeGreaterThan(1);
  });

  it('la Potencia se nota a simple vista en la velocidad del balón', () => {
    const kmh = (power: number): number => topSpeed({ power, accuracy: 5, energy: 1 }, T) * 3.6;
    expect(kmh(9)).toBeGreaterThan(kmh(5) + 15);
    expect(kmh(5)).toBeGreaterThan(kmh(3) + 8);
    expect(kmh(10)).toBeLessThan(100);
    // A tired shooter loses pace.
    expect(topSpeed({ power: 7, accuracy: 5, energy: 0.1 }, T)).toBeLessThan(topSpeed({ power: 7, accuracy: 5, energy: 1 }, T));
  });
});

describe('calibración del tiro y la parada (ni muro ni coladero)', () => {
  it('exterior a 7 m sin presión: en torno al 25–30 %', () => {
    const result = simulate('7m', { distance: 7 });
    expect(result.goal).toBeGreaterThan(0.2);
    expect(result.goal).toBeLessThan(0.34);
  });

  it('a 5 m: en torno al 40–50 %', () => {
    const result = simulate('5m', { distance: 5 });
    expect(result.goal).toBeGreaterThan(0.36);
    expect(result.goal).toBeLessThan(0.54);
  });

  it('cuanto más cerca, más gol; y el ángulo cerrado del extremo se paga', () => {
    const far = simulate('lejos', { distance: 8 });
    const near = simulate('cerca', { distance: 2.5 });
    const wing = simulate('extremo', { distance: 2.5, lateral: 4.5 });
    expect(near.goal).toBeGreaterThan(far.goal + 0.25);
    expect(wing.goal).toBeLessThan(near.goal - 0.2);
    expect(wing.miss).toBeGreaterThan(near.miss);
  });

  it('Potencia y Precisión se notan cada una por separado', () => {
    const base = simulate('base', { distance: 7 }).goal;
    const power = simulate('potencia', { distance: 7, power: 9 }).goal;
    const accuracy = simulate('precision', { distance: 7, accuracy: 9 }).goal;
    const both = simulate('ambas', { distance: 7, power: 9, accuracy: 9 }).goal;
    const poor = simulate('flojo', { distance: 7, power: 3, accuracy: 3 }).goal;
    expect(power).toBeGreaterThan(base + 0.07);
    expect(accuracy).toBeGreaterThan(base + 0.07);
    expect(both).toBeGreaterThan(base + 0.15);
    expect(poor).toBeLessThan(base - 0.07);
  });

  it('la Precisión manda el balón donde se apunta en vez de fuera', () => {
    expect(simulate('fuera-3', { distance: 7, accuracy: 3 }).miss).toBeGreaterThan(0.18);
    expect(simulate('fuera-9', { distance: 7, accuracy: 9 }).miss).toBeLessThan(0.03);
  });

  it('un buen portero para más, pero nunca todo', () => {
    const wall = simulate('portero-9', { distance: 7, reflexes: 9, positioning: 9 });
    const weak = simulate('portero-2', { distance: 7, reflexes: 2, positioning: 2 });
    expect(weak.goal).toBeGreaterThan(wall.goal + 0.15);
    expect(wall.goal).toBeGreaterThan(0.04);
    expect(weak.save).toBeGreaterThan(0.25);
  });

  it('ninguna parada ni ningún gol están garantizados: 5 %–95 %', () => {
    for (const scenario of [
      { distance: 9, power: 1, accuracy: 10, reflexes: 10, positioning: 10 },
      { distance: 2, power: 10, accuracy: 10, reflexes: 1, positioning: 1 },
    ]) {
      const result = simulate(`limites-${scenario.distance}`, scenario);
      expect(result.minP).toBeGreaterThanOrEqual(K.limites.min);
      expect(result.maxP).toBeLessThanOrEqual(K.limites.max);
    }
  });

  it('el tiro rápido sirve de cerca y castiga de lejos', () => {
    expect(simulate('rapido-lejos', { distance: 7, charge: 'quick' }).goal).toBeLessThan(simulate('cargado-lejos', { distance: 7 }).goal - 0.08);
    expect(simulate('rapido-cerca', { distance: 2.5, charge: 'quick' }).goal).toBeGreaterThan(0.4);
  });

  it('el bote y la vaselina son opciones reales, no trucos ganadores', () => {
    const direct = simulate('directo', { distance: 7 }).goal;
    for (const mode of ['skip', 'lob'] as const) {
      const result = simulate(mode, { distance: 7, mode });
      expect(result.goal).toBeGreaterThan(direct - 0.12);
      expect(result.goal).toBeLessThan(direct + 0.12);
    }
    // The lob is the riskiest: it sails over more often.
    expect(simulate('vaselina-fuera', { distance: 7, mode: 'lob' }).miss).toBeGreaterThan(simulate('directo-fuera', { distance: 7 }).miss);
  });

  it('penalti: en torno al 75 % con una carga humana, y se nota quién tira', () => {
    const average = simulate('penalti', { distance: 5, context: 'penalty', charge: 'human' });
    const star = simulate('penalti-9', { distance: 5, context: 'penalty', charge: 'human', power: 9, accuracy: 9 });
    const poor = simulate('penalti-3', { distance: 5, context: 'penalty', charge: 'human', power: 3, accuracy: 3 });
    expect(average.goal).toBeGreaterThan(0.68);
    expect(average.goal).toBeLessThan(0.82);
    expect(star.goal).toBeGreaterThan(average.goal + 0.1);
    expect(poor.goal).toBeLessThan(average.goal - 0.1);
  });
});

describe('portero en el penalti', () => {
  const shoot = (side: AimSide, mode: ShotMode, seed: string) =>
    planShot({ from: { x: 20, y: 10 }, releaseHeight: 0.9, charge: 0.78, side, mode, pressure: 0 }, { power: 5, accuracy: 9, energy: 1 }, goal, 0, new Rng(seed), T);
  const keeper = { reflexes: 5, positioning: 5, energy: 1 };
  const p = (plan: ReturnType<typeof shoot>, commitSide: AimSide, timing = 1): number =>
    estimateSave(plan, keeper, { u: 0, commit: { side: commitSide, timing } }, 'penalty', K).probability;

  it('adivinar el lado da opciones; tirarse al contrario casi ninguna', () => {
    const plan = shoot(-1, 'direct', 'a');
    expect(p(plan, -1)).toBeGreaterThan(p(plan, 0));
    expect(p(plan, -1)).toBeGreaterThan(p(plan, 1) + 0.1);
    expect(p(plan, 1)).toBe(K.limites.min);
  });

  it('tirarse tarde vale menos que tirarse a tiempo', () => {
    const plan = shoot(1, 'direct', 'b');
    expect(p(plan, 1, 1)).toBeGreaterThan(p(plan, 1, 0.55));
  });

  it('la vaselina castiga al portero que se vence a un lado', () => {
    const plan = shoot(1, 'lob', 'c');
    expect(p(plan, -1)).toBeLessThan(0.15);
    expect(p(plan, 0)).toBeGreaterThan(0.25);
    expect(p(plan, 1)).toBeGreaterThan(0.8);
  });
});

describe('trayectoria del balón', () => {
  const at = (plan: ReturnType<typeof planShot>, s: number) => ballAt(plan, goal, s, T, { x: 0, y: 0, z: 0 });
  const plan = (mode: ShotMode) =>
    planShot({ from: { x: 18, y: 10 }, releaseHeight: 0.95, charge: 0.78, side: 1, mode, pressure: 0 }, { power: 6, accuracy: 10, energy: 1 }, goal, 0, new Rng(mode), T);

  it('sale de la mano y llega al punto calculado de la portería', () => {
    for (const mode of ['direct', 'skip', 'lob'] as const) {
      const shot = plan(mode);
      const start = at(shot, 0);
      const end = at(shot, 1);
      expect(start.x).toBeCloseTo(18, 5);
      expect(start.z).toBeCloseTo(0.95, 5);
      expect(end.x).toBeCloseTo(goal.x, 5);
      expect(end.y).toBeCloseTo(goal.y + shot.arrival.u, 5);
      expect(end.z).toBeCloseTo(shot.arrival.v, 5);
    }
  });

  it('el tiro a bote toca el agua antes de la portería y pierde velocidad', () => {
    const shot = plan('skip');
    expect(shot.bounce).toBeDefined();
    expect(shot.bounceAt).toBeDefined();
    const touch = at(shot, shot.bounceAt as number);
    expect(touch.z).toBeCloseTo(0, 5);
    expect(goal.x - touch.x).toBeCloseTo(T.bote.distanciaAntesDeGol, 1);
    expect(shot.arrivalSpeed).toBeLessThan(shot.speed);
    expect(at(shot, 1).z).toBeGreaterThan(0);
  });

  it('la vaselina vuela alta y lenta; el tiro directo, raso y rápido', () => {
    const lob = plan('lob');
    const direct = plan('direct');
    const peak = Math.max(...[0.3, 0.4, 0.5, 0.6].map((s) => at(lob, s).z));
    expect(peak).toBeGreaterThan(1.8);
    expect(Math.max(...[0.25, 0.5, 0.75].map((s) => at(direct, s).z))).toBeLessThan(1.3);
    expect(lob.flightTime).toBeGreaterThan(direct.flightTime * 1.8);
  });
});
