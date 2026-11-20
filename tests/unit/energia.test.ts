import { describe, expect, it } from 'vitest';
import tuning from '../../data/tuning.json';
import type { Swimmer } from '../../src/sim/attack/types';
import { drainFactor, rest, speedFactor, stepEnergy, tiredBar } from '../../src/sim/match/energy';
import type { Match } from '../../src/sim/match/match';
import type { MatchEvent } from '../../src/sim/match/types';
import { makeMatch, makeSwimmer, NEUTRAL } from './escena';

const E = tuning.partido.energia;
const IDLE = { burst: false, drive: false, wrestle: false, shoot: false, contact: false };

/** Swims flat out for `seconds`. */
function sprint(s: Swimmer, seconds: number): void {
  s.vel = { x: s.topSpeed, y: 0 };
  for (let i = 0; i < seconds * 60; i++) stepEnergy(s, IDLE, 1 / 60, E);
}

/** Steps until an event of this type (or gives up). */
function until(match: Match, type: MatchEvent['type'], seconds: number): MatchEvent | null {
  for (let i = 0; i < seconds * 60; i++) {
    const found = match.step(NEUTRAL).find((e) => e.type === type);
    if (found) return found;
  }
  return null;
}

describe('energía (GDD §11.2)', () => {
  it('nadar a tope gasta; flotar recupera; la Resistencia y el Diésel gastan menos', () => {
    const weak = makeSwimmer(5, 5, 0, { stamina: 1 });
    const strong = makeSwimmer(5, 5, 0, { stamina: 10 });
    const diesel = makeSwimmer(5, 5, 0, { stamina: 1 });
    (diesel.player as { trait?: string }).trait = 'diesel';
    for (const s of [weak, strong, diesel]) sprint(s, 30);
    expect(weak.energy).toBeLessThan(0.9);
    expect(strong.energy).toBeGreaterThan(weak.energy);
    expect(diesel.energy).toBeGreaterThan(weak.energy);
    expect(drainFactor(strong, E)).toBeLessThan(drainFactor(weak, E));
    // Treading water gives some back, the bench a lot more.
    const tread = weak.energy;
    weak.vel = { x: 0, y: 0 };
    for (let i = 0; i < 60 * 10; i++) stepEnergy(weak, IDLE, 1 / 60, E);
    expect(weak.energy).toBeGreaterThan(tread);
    const bench = { ...weak, energy: tread };
    for (let i = 0; i < 60 * 10; i++) rest(bench, E.recuperacion.banquillo / 60, E);
    expect(bench.energy - tread).toBeGreaterThan(3 * (weak.energy - tread));
  });

  it('por debajo de la mitad nada más lento (hasta −35 % vacío) y pierde Habilidad', () => {
    expect(speedFactor(1, E)).toBe(1);
    expect(speedFactor(0.5, E)).toBe(1);
    expect(speedFactor(0.25, E)).toBeCloseTo(1 - E.efecto.velocidad / 2, 5);
    expect(speedFactor(0, E)).toBeCloseTo(0.65, 5);
    expect(tiredBar(8, 1, E.efecto.habilidad, E)).toBe(8);
    expect(tiredBar(8, 0, E.efecto.habilidad, E)).toBeLessThan(6);
  });

  it('en un partido se cansa más el de poca Resistencia y el cansado nada más despacio', { timeout: 120_000 }, () => {
    const ends: Record<string, number> = {};
    for (const stamina of [1, 10]) {
      const match = makeMatch({ seed: 'cansancio', periods: 2, periodSeconds: 360, home: { stamina }, away: { stamina: 5 } });
      let sum = 0;
      let count = 0;
      for (let i = 0; i < 60 * 60 * 10 && match.phase !== 'fullTime'; i++) {
        match.step(NEUTRAL);
        if (match.phase === 'transition' || match.phase === 'positional') {
          for (const s of match.inPlay(0)) {
            sum += s.energy;
            count++;
          }
        }
      }
      ends[stamina] = sum / count;
    }
    // Measured (both teams change their tired players): ≈ 0,61 against ≈ 0,92.
    expect(ends[1]!).toBeLessThan(0.7);
    expect(ends[10]!).toBeGreaterThan(ends[1]! + 0.2);
    // The speed: an empty bar against a full one, same target far away.
    const match = makeMatch({ seed: 'piernas' });
    until(match, 'swimOffWon', 20);
    const [fresh, tired] = match.inPlay(0);
    fresh!.energy = 1;
    tired!.energy = 0.05;
    match.step(NEUTRAL);
    expect(tired!.speedPenalty).toBeLessThan(fresh!.speedPenalty * 0.75);
  });
});

describe('banquillo y cambios (GDD §11.3)', () => {
  it('el cambio pedido entra en el siguiente balón parado, en el sitio del que sale', () => {
    const match = makeMatch({ seed: 'cambio', human: true });
    until(match, 'swimOffWon', 20);
    const out = match.inPlay(0)[2]!;
    const into = match.benchOf(0)[0]!;
    expect(match.requestChange(0, out, into)).toBe(true);
    expect(match.changesOf(0)).toHaveLength(1);
    // Still in the water until the ball is dead.
    match.step(NEUTRAL);
    expect(match.inPlay(0)).toContain(out);
    const where = { ...out.pos };
    // A foul: a free throw, a dead ball.
    const rival = match.inPlay(1)[0]!;
    const events = match.forceCall(rival, match.inPlay(0)[0]!, 'ordinary', 'FALTA');
    const sub = events.find((e) => e.type === 'substitution');
    expect(sub).toMatchObject({ type: 'substitution', out, in: into, chosen: true });
    expect(match.inPlay(0)).toContain(into);
    expect(match.inPlay(0)).not.toContain(out);
    expect(match.benchOf(0)).toContain(out);
    expect(out.away).toBe(true);
    expect(into.away).toBe(false);
    expect(Math.hypot(into.pos.x - where.x, into.pos.y - where.y)).toBeLessThan(1.5);
    expect(match.changesOf(0)).toHaveLength(0);
    // Nobody marks the one who went off.
    expect(match.inPlay(1).some((d) => d.mark === out)).toBe(false);
  });

  it('el que sale recupera en el banquillo y puede volver a entrar (sin límite de cambios)', () => {
    const match = makeMatch({ seed: 'vuelve', human: true });
    until(match, 'swimOffWon', 20);
    const tired = match.inPlay(0)[3]!;
    const sub = match.benchOf(0)[0]!;
    tired.energy = 0.2;
    match.requestChange(0, tired, sub);
    match.forceCall(match.inPlay(1)[0]!, match.inPlay(0)[0]!, 'ordinary', 'FALTA');
    expect(match.benchOf(0)).toContain(tired);
    // Thirty seconds on the bench.
    for (let i = 0; i < 60 * 30; i++) match.step(NEUTRAL);
    expect(tired.energy).toBeGreaterThan(0.6);
    // And back into the water for the one who replaced him.
    expect(match.requestChange(0, sub, tired)).toBe(true);
    match.forceCall(match.inPlay(1)[0]!, match.inPlay(0)[0]!, 'ordinary', 'FALTA');
    expect(match.inPlay(0)).toContain(tired);
    expect(match.benchOf(0)).toContain(sub);
  });

  it('pedir otro cambio para el mismo sustituye al anterior; se puede anular', () => {
    const match = makeMatch({ seed: 'cambio2', human: true });
    until(match, 'swimOffWon', 20);
    const [a, b] = match.inPlay(0);
    const [x, y] = match.benchOf(0);
    match.requestChange(0, a!, x!);
    match.requestChange(0, b!, x!);
    expect(match.changesOf(0)).toEqual([{ out: b, in: x }]);
    match.requestChange(0, a!, y!);
    match.cancelChange(0, b!);
    expect(match.changesOf(0)).toEqual([{ out: a, in: y }]);
    // Somebody on the bench cannot go off, nor somebody in the water come in.
    expect(match.requestChange(0, x!, y!)).toBe(false);
    expect(match.requestChange(0, a!, b!)).toBe(false);
  });

  it('la IA cambia sola a los cansados por suplentes descansados, y avisa a Emilio por los nuestros', () => {
    const match = makeMatch({ seed: 'ia-cambia', human: true });
    until(match, 'swimOffWon', 20);
    const tired = match.inPlay(1)[1]!;
    tired.energy = 0.1;
    const ours = match.inPlay(0)[1]!;
    ours.energy = 0.1;
    const warn = until(match, 'tired', 1);
    expect(warn).toMatchObject({ type: 'tired', who: ours });
    // Only once while he stays tired.
    expect(until(match, 'tired', 1)).toBeNull();
    const events = match.forceCall(match.inPlay(0)[0]!, match.inPlay(1)[0]!, 'ordinary', 'FALTA');
    const subs = events.filter((e) => e.type === 'substitution');
    expect(subs.some((e) => e.type === 'substitution' && e.out === tired)).toBe(true);
    // Ours are the human's: no change without asking.
    expect(subs.some((e) => e.type === 'substitution' && e.out.team === 0)).toBe(false);
    expect(match.inPlay(0)).toContain(ours);
  });
});

describe('tiempos muertos', () => {
  it('solo con el balón; reanuda con un libre desde el medio campo sin reiniciar la posesión y da un respiro', () => {
    const match = makeMatch({ seed: 'tiempo', human: true });
    until(match, 'swimOffWon', 20);
    // Until we have the ball in play.
    for (let i = 0; i < 60 * 60 && !match.canCallTimeout(0); i++) match.step(NEUTRAL);
    expect(match.canCallTimeout(0)).toBe(true);
    expect(match.canCallTimeout(1)).toBe(false);
    for (let i = 0; i < 60 * 2; i++) match.step(NEUTRAL);
    if (!match.canCallTimeout(0)) return;
    const clock = match.shotClock;
    const tired = match.inPlay(0)[0]!;
    tired.energy = 0.4;
    const events: MatchEvent[] = [];
    expect(match.callTimeout(0, events)).toBe(true);
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(['whistle', 'timeout', 'setPiece']));
    expect(match.timeouts[0]).toBe(1);
    expect(match.phase).toBe('setPiece');
    expect(match.setPiece).toMatchObject({ kind: 'freeThrow', side: 0, reason: 'timeout' });
    expect(Math.abs(match.setPiece!.spot.x - match.setup.field.length / 2)).toBeLessThan(0.01);
    expect(match.shotClock).toBeCloseTo(clock, 5);
    expect(tired.energy).toBeGreaterThan(0.45);
    // Two per match.
    for (let i = 0; i < 60 * 30 && !match.canCallTimeout(0); i++) match.step(NEUTRAL);
    if (match.canCallTimeout(0)) {
      match.callTimeout(0, []);
      expect(match.timeouts[0]).toBe(0);
      expect(match.canCallTimeout(0)).toBe(false);
    }
  });
});
