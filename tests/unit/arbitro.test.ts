import { describe, expect, it } from 'vitest';
import tuning from '../../data/tuning.json';
import { Rng } from '../../src/core/rng';
import { Referee, type Offender, type RefereeProfile } from '../../src/sim/referee/referee';
import { classify, type Contact, type Sanction } from '../../src/sim/rules/rules';
import { NEUTRAL_REFEREE } from './escena';

const T = tuning.arbitro;
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
const offender = (over: Partial<Offender> = {}): Offender => ({ id: 'p', side: 0, aggression: 5, ...over });
const referee = (profile: Partial<RefereeProfile> = {}, seed: number | string = 'arbitro', mode: 'arcade' | 'reglamento' = 'arcade') =>
  new Referee({ ...NEUTRAL_REFEREE, ...profile }, T, mode, 2, new Rng(seed));

/** Share of the calls of each kind over many identical contacts. */
function rates(ref: Referee, c: Contact, who: Offender, n = 4000): Record<Sanction, number> {
  const counts: Record<Sanction, number> = { none: 0, ordinary: 0, exclusion: 0, penalty: 0, violent: 0 };
  const classified = classify(c, T.clasificacion);
  for (let i = 0; i < n; i++) counts[ref.judge(classified, c, { ...who, id: `p${i}` }).sanction]++;
  for (const k of Object.keys(counts) as Sanction[]) counts[k] /= n;
  return counts;
}

describe('árbitro: nunca inventa y no hace trampas', () => {
  it('solo pita lo que las reglas dicen, o algo más leve; nunca algo más grave', () => {
    const r = rates(referee({ contactTolerance: 1, exclusionTendency: 10, bias: 3 }), contact(), offender({ aggression: 10 }));
    expect(r.penalty + r.violent).toBe(0);
    const light = rates(referee(), contact({ intensity: 0.4 }), offender());
    expect(light.exclusion).toBe(0);
  });

  it('todas las probabilidades se quedan entre los límites, hasta con perfiles extremos', () => {
    for (const profile of [
      { contactTolerance: 1, exclusionTendency: 10, bias: 3, consistency: 1 },
      { contactTolerance: 10, exclusionTendency: 1, bias: -3, consistency: 1 },
    ]) {
      const ref = referee(profile);
      for (const intensity of [0.3, 0.6, 1]) {
        for (const side of [0, 1] as const) {
          const p = ref.chance('exclusion', { intensity, inSixMetres: true, counterAttack: true }, offender({ side, aggression: 10 }));
          expect(p).toBeGreaterThanOrEqual(T.limites.min);
          expect(p).toBeLessThanOrEqual(T.limites.max);
        }
      }
    }
  });

  it('el sesgo se nota (≈ +12 % por punto contra nosotros) pero está acotado', () => {
    const c = { intensity: 0.6, inSixMetres: false, counterAttack: false };
    const neutral = referee({ bias: 0, consistency: 10 });
    const against = referee({ bias: 3, consistency: 10 });
    const ours = against.chance('exclusion', c, offender({ side: 0 })) / neutral.chance('exclusion', c, offender({ side: 0 }));
    const theirs = against.chance('exclusion', c, offender({ side: 1 })) / neutral.chance('exclusion', c, offender({ side: 1 }));
    expect(ours).toBeGreaterThan(1.25);
    expect(ours).toBeLessThan(1.45);
    expect(theirs).toBeGreaterThan(0.7);
    expect(theirs).toBeLessThan(0.85);
    // Nunca mueve una probabilidad más de lo permitido.
    for (const intensity of [0.5, 0.7, 0.9]) {
      const d = against.chance('exclusion', { ...c, intensity }, offender()) - neutral.chance('exclusion', { ...c, intensity }, offender());
      expect(Math.abs(d)).toBeLessThanOrEqual(T.sesgo.maximo + 1e-9);
    }
  });
});

describe('árbitro: coherente, se puede aprender cómo pita (GDD §13)', () => {
  it('un jugador de Agresividad 9 con un árbitro estricto acumula exclusiones; con uno permisivo, bastantes menos', () => {
    const c = contact({ intensity: 0.75 });
    const strict = rates(referee({ contactTolerance: 2, exclusionTendency: 8, consistency: 9 }), c, offender({ aggression: 9 }));
    const loose = rates(referee({ contactTolerance: 9, exclusionTendency: 3, consistency: 6 }), c, offender({ aggression: 9 }));
    expect(strict.exclusion).toBeGreaterThan(0.75);
    expect(loose.exclusion).toBeLessThan(0.5);
    expect(strict.exclusion - loose.exclusion).toBeGreaterThan(0.3);
  });

  it('el estricto pita parecido en todos los partidos (banda alta y estable); el irregular cambia más de un día a otro', () => {
    const c = contact({ intensity: 0.75 });
    const strictDays: number[] = [];
    const wildDays: number[] = [];
    for (let day = 0; day < 20; day++) {
      strictDays.push(rates(referee({ contactTolerance: 2, exclusionTendency: 8, consistency: 9 }, `dia-${day}`), c, offender({ aggression: 9 }), 600).exclusion);
      wildDays.push(rates(referee({ consistency: 1 }, `dia-${day}`), c, offender({ aggression: 9 }), 600).exclusion);
    }
    const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
    expect(Math.min(...strictDays)).toBeGreaterThan(0.7);
    expect(spread(strictDays)).toBeLessThan(0.15);
    expect(spread(wildDays)).toBeGreaterThan(spread(strictDays));
  });

  it('un árbitro de regularidad 10 da siempre la misma probabilidad al mismo contacto', () => {
    const ref = referee({ consistency: 10 });
    expect(Math.abs(ref.day)).toBe(0);
    const c = { intensity: 0.6, inSixMetres: false, counterAttack: false };
    expect(ref.chance('exclusion', c, offender())).toBe(ref.chance('exclusion', c, offender()));
  });
});

describe('tarjetas', () => {
  it('modo arcade: amarilla de aviso por un contacto muy fuerte; la segunda es roja', () => {
    const ref = referee({ cardTendency: 10, contactTolerance: 1, exclusionTendency: 10 }, 'tarjetas');
    const c = contact({ intensity: 1 });
    const classified = classify(c, T.clasificacion);
    const cards: (string | null)[] = [];
    for (let i = 0; i < 30 && !cards.includes('red'); i++) {
      const call = ref.judge(classified, c, offender({ id: 'bruto' }));
      if (call.card) cards.push(call.card);
    }
    expect(cards[0]).toBe('yellow');
    expect(cards).toContain('red');
    expect(cards.indexOf('red')).toBe(1);
  });

  it('modo reglamento: tras varias exclusiones, amarilla al equipo; después, la siguiente fuerte es roja', () => {
    const ref = referee({ cardTendency: 10, contactTolerance: 1, exclusionTendency: 10 }, 'reglamento', 'reglamento');
    const c = contact({ intensity: 1 });
    const classified = classify(c, T.clasificacion);
    let warned = -1;
    let red = -1;
    for (let i = 0; i < 40 && red < 0; i++) {
      const call = ref.judge(classified, c, offender({ id: `j${i}` }));
      if (call.teamWarning) warned = i;
      if (call.card === 'red') red = i;
      expect(call.card).not.toBe('yellow');
    }
    expect(warned).toBeGreaterThanOrEqual(T.tarjetas.avisoEquipoTrasExclusiones - 1);
    expect(red).toBeGreaterThan(warned);
  });
});
