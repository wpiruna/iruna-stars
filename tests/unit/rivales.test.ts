import { describe, expect, it } from 'vitest';
import { Rng, hashString } from '../../src/core/rng';
import { KEEPER_STAT_KEYS, RosterSchema, STAT_KEYS, STYLES } from '../../src/data/schema';
import { generateRoster } from '../../tools/rivales/generar';

describe('RNG con semilla', () => {
  it('la misma semilla da la misma secuencia', () => {
    const a = new Rng('copa');
    const b = new Rng('copa');
    expect(Array.from({ length: 20 }, () => a.next())).toEqual(Array.from({ length: 20 }, () => b.next()));
  });

  it('semillas distintas dan secuencias distintas y los valores están en [0, 1)', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    const values = Array.from({ length: 1000 }, () => a.next());
    expect(values.every((v) => v >= 0 && v < 1)).toBe(true);
    expect(values.slice(0, 5)).not.toEqual(Array.from({ length: 5 }, () => b.next()));
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
  });

  it('int incluye los dos extremos y fork no avanza el original', () => {
    const rng = new Rng(7);
    const seen = new Set(Array.from({ length: 300 }, () => rng.int(1, 3)));
    expect([...seen].sort()).toEqual([1, 2, 3]);
    const base = new Rng(9);
    const before = base.getState();
    base.fork('arbitro').next();
    expect(base.getState()).toBe(before);
    expect(hashString('a')).not.toBe(hashString('b'));
  });
});

describe('generador de rivales', () => {
  it('es determinista: el Nº 7 de un rival es siempre el mismo', () => {
    const a = generateRoster({ id: 'sestao', nivel: 6, estilo: 'fisico' });
    const b = generateRoster({ id: 'sestao', nivel: 6, estilo: 'fisico' });
    expect(a).toEqual(b);
    expect(generateRoster({ id: 'urbat', nivel: 6, estilo: 'fisico' }).jugadores).not.toEqual(a.jugadores);
  });

  it('genera 13 jugadores válidos: 11 de campo y 2 porteros, con motes y dorsales únicos', () => {
    for (const estilo of STYLES) {
      for (let nivel = 1; nivel <= 10; nivel++) {
        const roster = RosterSchema.parse(generateRoster({ id: `equipo-${estilo}-${nivel}`, nivel, estilo }));
        const keepers = roster.jugadores.filter((p) => p.puesto === 'portero');
        expect(keepers.map((p) => p.dorsal)).toEqual([1, 13]);
        expect(keepers.every((p) => p.statsPortero !== undefined && p.arquetipo === 'portero')).toBe(true);
        expect(roster.jugadores.filter((p) => p.puesto === 'boya')).toHaveLength(2);
        expect(new Set(roster.jugadores.map((p) => p.dorsal)).size).toBe(13);
        expect(new Set(roster.jugadores.map((p) => p.mote)).size).toBe(13);
        expect(roster.jugadores.every((p) => p.mote.length <= 8)).toBe(true);
        for (const player of roster.jugadores) {
          for (const key of STAT_KEYS) expect(player.stats[key]).toBeGreaterThanOrEqual(1);
          for (const key of STAT_KEYS) expect(player.stats[key]).toBeLessThanOrEqual(10);
          if (player.statsPortero) for (const key of KEEPER_STAT_KEYS) expect(player.statsPortero[key]).toBeLessThanOrEqual(10);
        }
      }
    }
  });

  it('a más nivel, más estrellas y mejores jugadores', () => {
    const average = (nivel: number): { stars: number; mean: number } => {
      let stars = 0;
      let sum = 0;
      let count = 0;
      for (let i = 0; i < 40; i++) {
        const roster = generateRoster({ id: `club-${i}`, nivel, estilo: 'equilibrado' });
        stars += roster.jugadores.filter((p) => p.estrella).length;
        for (const player of roster.jugadores) for (const key of STAT_KEYS) (sum += player.stats[key]), count++;
      }
      return { stars: stars / 40, mean: sum / count };
    };
    const low = average(2);
    const mid = average(5);
    const high = average(9);
    expect(low.stars).toBeLessThanOrEqual(1);
    expect(mid.stars).toBeGreaterThanOrEqual(1);
    expect(mid.stars).toBeLessThanOrEqual(2);
    expect(high.stars).toBeGreaterThanOrEqual(3);
    expect(high.stars).toBeLessThanOrEqual(4);
    expect(low.mean).toBeLessThan(mid.mean);
    expect(mid.mean).toBeLessThan(high.mean);
  });

  it('las estrellas tienen 2 o 3 barras entre 8 y 10', () => {
    for (let i = 0; i < 30; i++) {
      const roster = generateRoster({ id: `estrellas-${i}`, nivel: 5, estilo: 'estrellas' });
      for (const star of roster.jugadores.filter((p) => p.estrella && p.puesto !== 'portero')) {
        const top = STAT_KEYS.filter((key) => star.stats[key] >= 8).length;
        expect(top).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('el estilo se nota en las barras', () => {
    const mean = (estilo: (typeof STYLES)[number], key: (typeof STAT_KEYS)[number]): number => {
      let sum = 0;
      let count = 0;
      for (let i = 0; i < 40; i++) {
        for (const p of generateRoster({ id: `e-${i}`, nivel: 5, estilo }).jugadores) (sum += p.stats[key]), count++;
      }
      return sum / count;
    };
    expect(mean('rapido', 'velocidad')).toBeGreaterThan(mean('equilibrado', 'velocidad') + 1);
    expect(mean('fisico', 'agresividad')).toBeGreaterThan(mean('equilibrado', 'agresividad') + 1);
    expect(mean('defensivo', 'defensa')).toBeGreaterThan(mean('equilibrado', 'defensa') + 1);
  });
});
