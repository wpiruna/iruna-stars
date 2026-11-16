import { describe, expect, it } from 'vitest';
import tuning from '../../data/tuning.json';
import {
  classify,
  directShotAllowed,
  freeThrowSpot,
  goalAreaOffence,
  inGoalArea,
  overGoalLine,
  shotClockAfterExclusion,
  softer,
  type Contact,
} from '../../src/sim/rules/rules';
import { fromGoal } from '../../src/sim/field';
import { field, rules } from './escena';

const T = tuning.arbitro.clasificacion;
const goal = field.goalRight;

const contact = (over: Partial<Contact> = {}): Contact => ({
  kind: 'grab',
  intensity: 0.7,
  byAttacker: false,
  victimHasBall: false,
  victimShooting: false,
  fromBehind: false,
  inSixMetres: false,
  probableGoal: false,
  counterAttack: false,
  ...over,
});

describe('motor de reglas: qué es cada contacto (WP 8, 10, 11)', () => {
  it('un contacto leve no es nada: el contacto es parte del juego', () => {
    expect(classify(contact({ intensity: 0.1 }), T).sanction).toBe('none');
  });

  it('agarrar, hundir o tirar atrás a quien no tiene el balón es exclusión, con su motivo', () => {
    expect(classify(contact({ kind: 'grab' }), T)).toEqual({ sanction: 'exclusion', motive: 'AGARRÓN' });
    expect(classify(contact({ kind: 'sink' }), T)).toEqual({ sanction: 'exclusion', motive: 'HUNDIR' });
    expect(classify(contact({ kind: 'pullBack' }), T)).toEqual({ sanction: 'exclusion', motive: 'TIRAR ATRÁS' });
  });

  it('a medias, sin balón, es falta ordinaria; sobre el que tiene el balón, también', () => {
    expect(classify(contact({ intensity: (T.legalHasta + T.exclusionDesde) / 2 }), T).sanction).toBe('ordinary');
    expect(classify(contact({ victimHasBall: true, intensity: 0.9 }), T).sanction).toBe('ordinary');
  });

  it('el atacante que se impulsa en su defensor comete falta en ataque', () => {
    expect(classify(contact({ byAttacker: true, kind: 'push' }), T)).toEqual({ sanction: 'ordinary', motive: 'EMPUJÓN' });
  });

  it('frenar un contraataque a propósito es exclusión (falta táctica), aunque lleve el balón', () => {
    expect(classify(contact({ counterAttack: true, victimHasBall: true }), T)).toEqual({ sanction: 'exclusion', motive: 'FALTA TÁCTICA' });
  });

  it('penalti dentro de los 6 m: por detrás al que tira, o una falta que evita un gol claro', () => {
    expect(classify(contact({ inSixMetres: true, victimShooting: true, fromBehind: true, victimHasBall: true }), T)).toEqual({ sanction: 'penalty', motive: 'POR DETRÁS' });
    expect(classify(contact({ inSixMetres: true, probableGoal: true }), T)).toEqual({ sanction: 'penalty', motive: 'GOL CLARO' });
    // Fuera de los 6 m nunca es penalti.
    expect(classify(contact({ inSixMetres: false, probableGoal: true }), T).sanction).toBe('exclusion');
    // De frente al que tira no es "por detrás".
    expect(classify(contact({ inSixMetres: true, victimShooting: true, fromBehind: false, victimHasBall: true }), T).sanction).toBe('ordinary');
  });

  it('un golpe es acción violenta, sea cual sea la situación', () => {
    expect(classify(contact({ kind: 'strike', intensity: 0.4 }), T).sanction).toBe('violent');
  });

  it('el árbitro solo puede rebajar una sanción, nunca agravarla', () => {
    expect(softer('violent', false)).toBe('exclusion');
    expect(softer('penalty', false)).toBe('exclusion');
    expect(softer('penalty', true)).toBe('ordinary');
    expect(softer('exclusion', false)).toBe('ordinary');
    expect(softer('ordinary', false)).toBe('none');
  });
});

describe('reglamento: relojes, área de gol, tiros libres y saques', () => {
  it('tras una exclusión quedan 18 s de posesión, o más si quedaban más (WP 9.9)', () => {
    expect(shotClockAfterExclusion(9, rules)).toBe(18);
    expect(shotClockAfterExclusion(23, rules)).toBe(23);
  });

  it('el área de gol mide 2 m de fondo y 2 m más allá de cada palo (WP 20.4)', () => {
    expect(inGoalArea(fromGoal(goal, 1, 3.4), goal, rules)).toBe(true);
    expect(inGoalArea(fromGoal(goal, 1, 3.8), goal, rules)).toBe(false);
    expect(inGoalArea(fromGoal(goal, 2.3, 0), goal, rules)).toBe(false);
  });

  it('dentro del área de gol por delante del balón es falta; por detrás de la línea del balón, no (WP 8.2.8)', () => {
    const attacker = fromGoal(goal, 1.2, 0.5);
    expect(goalAreaOffence(attacker, fromGoal(goal, 6, 2), goal, rules)).toBe(true);
    expect(goalAreaOffence(attacker, fromGoal(goal, 0.8, -2), goal, rules)).toBe(false);
  });

  it('falta de la defensa con el balón en el área de gol: se saca desde la línea de 2 m (WP 12.5.1)', () => {
    const spot = freeThrowSpot(fromGoal(goal, 1, 1.5), goal, true, rules);
    expect(spot.x).toBeCloseTo(fromGoal(goal, 2, 1.5).x, 5);
    expect(spot.y).toBeCloseTo(fromGoal(goal, 2, 1.5).y, 5);
    const outside = freeThrowSpot(fromGoal(goal, 7, 1.5), goal, true, rules);
    expect(outside.x).toBeCloseTo(fromGoal(goal, 7, 1.5).x, 5);
  });

  it('desde fuera de los 6 m se puede tirar directo; desde dentro, no (WP 7.5.1.2)', () => {
    expect(directShotAllowed(fromGoal(goal, 7.5, 0), goal, rules)).toBe(true);
    expect(directShotAllowed(fromGoal(goal, 5, 0), goal, rules)).toBe(false);
  });

  it('córner si la toca el portero o un defensor a propósito; saque de portería si fue un tiro tapado o el atacante (WP 13–14)', () => {
    expect(overGoalLine({ defender: true, keeper: true, blockedShot: false })).toBe('corner');
    expect(overGoalLine({ defender: true, keeper: false, blockedShot: false })).toBe('corner');
    expect(overGoalLine({ defender: true, keeper: false, blockedShot: true })).toBe('goalThrow');
    expect(overGoalLine({ defender: false, keeper: false, blockedShot: false })).toBe('goalThrow');
    expect(overGoalLine(null)).toBe('goalThrow');
  });
});
