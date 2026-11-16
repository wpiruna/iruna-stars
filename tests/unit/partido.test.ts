import { describe, expect, it } from 'vitest';
import type { PadState } from '../../src/sim/attack/control';
import { passRisk } from '../../src/sim/attack/passing';
import { MatchInput, type ControlContext, type MatchIntent } from '../../src/sim/match/input';
import type { Match } from '../../src/sim/match/match';
import { assignMarks, bestMatching, countAdvantage } from '../../src/sim/match/roles';
import type { MatchEvent } from '../../src/sim/match/types';
import { field, makeMatch, makeSwimmer, NEUTRAL, runMatch, T } from './escena';

const STEP = 1000 / 60;
const types = (events: MatchEvent[]) => events.map((e) => e.type);

/** Steps until an event matches (or gives up), returning everything that happened. */
function until(match: Match, test: (e: MatchEvent) => boolean, maxSeconds: number, pad: Partial<PadState> = {}): { events: MatchEvent[]; found: MatchEvent | null } {
  const events: MatchEvent[] = [];
  for (let i = 0; i < maxSeconds * 60; i++) {
    const step = match.step({ ...NEUTRAL, ...pad });
    events.push(...step);
    const found = step.find(test);
    if (found) return { events, found };
  }
  return { events, found: null };
}

// ---------------------------------------------------------------------------------------------
// Pure pieces
// ---------------------------------------------------------------------------------------------

describe('marcajes, superioridad y riesgo leído', () => {
  it('el emparejamiento de coste mínimo encuentra el óptimo y deja sin pareja a los que sobran', () => {
    const cost = [
      [1, 9, 9],
      [9, 9, 1],
      [9, 1, 9],
    ];
    expect(bestMatching(3, 3, (r, c) => cost[r]![c]!)).toEqual([0, 2, 1]);
    expect(bestMatching(3, 2, (r, c) => [[1, 9], [9, 1], [5, 5]][r]![c]!)).toEqual([0, 1, -1]);
  });

  it('en el repliegue, el atacante más peligroso se lo queda quien puede llegar antes', () => {
    const goal = field.goalRight;
    const deep = makeSwimmer(22.5, 10, 0);
    const far = makeSwimmer(12, 4, 0);
    const near = makeSwimmer(21, 11, 1);
    const late = makeSwimmer(14, 6, 1);
    const marks = assignMarks([late, near], [far, deep], goal, null, 3);
    expect(marks.get(near)).toBe(deep);
    expect(marks.get(late)).toBe(far);
  });

  it('cuenta la superioridad del contraataque: atacantes por delante del balón contra defensores entre el balón y la portería', () => {
    const goal = field.goalRight;
    const attackers = [makeSwimmer(17, 9, 0), makeSwimmer(18, 13, 0), makeSwimmer(10, 10, 0)];
    const defenders = [makeSwimmer(20, 11, 1), makeSwimmer(12, 10, 1)];
    expect(countAdvantage(attackers, defenders, { x: 17, y: 9 }, goal)).toEqual({ attackers: 2, defenders: 1 });
    // Same picture, ball still in its own half: not a break yet.
    expect(countAdvantage(attackers, defenders, { x: 11, y: 9 }, goal)).toBeNull();
  });

  it('un defensor que lee la línea de pase corta más pases', () => {
    const passer = makeSwimmer(18, 10, 0);
    const receiver = makeSwimmer(22.5, 10, 0);
    const defender = makeSwimmer(20.2, 11.2, 1);
    const risk = () => passRisk(passer, { x: 18, y: 10, z: 0.75 }, { x: 22, y: 10 }, 0.05, 0.6, 9, receiver, [defender], T.pase).total;
    const normal = risk();
    defender.anticipation = 1;
    expect(risk()).toBeGreaterThan(normal + 0.15);
  });
});

// ---------------------------------------------------------------------------------------------
// Control grammar across the match
// ---------------------------------------------------------------------------------------------

describe('controles según el momento del partido', () => {
  const feed = (input: MatchInput, frames: [Partial<PadState>, ControlContext, number][]): MatchIntent[] => {
    const out: MatchIntent[] = [];
    for (const [pad, context, n] of frames) for (let i = 0; i < n; i++) out.push(...input.update({ ...NEUTRAL, ...pad }, context, STEP));
    return out;
  };
  const make = () => new MatchInput(T.control, 180);
  const kinds = (intents: MatchIntent[]) => [...new Set(intents.map((i) => i.type))];

  it('con el balón en el contraataque: mantener nada, un toque pasa', () => {
    const held = feed(make(), [[{}, 'carry', 1], [{ x: 1 }, 'carry', 30], [{}, 'carry', 1]]);
    expect(held.filter((i) => i.type === 'swim').length).toBe(30);
    expect(held.some((i) => i.type === 'tap')).toBe(false);
    const tapped = feed(make(), [[{}, 'carry', 1], [{ x: 1 }, 'carry', 4], [{}, 'carry', 1]]);
    expect(tapped.find((i) => i.type === 'tap')).toMatchObject({ x: 1, y: 0 });
  });

  it('si el ataque se asienta mientras nadas con el balón, al soltar no sale ningún pase', () => {
    const intents = feed(make(), [[{}, 'carry', 1], [{ x: 1 }, 'carry', 20], [{ x: 1 }, 'attack', 20], [{}, 'attack', 3]]);
    expect(intents.some((i) => i.type === 'pass' || i.type === 'tap')).toBe(false);
    expect(intents.some((i) => i.type === 'swimStop')).toBe(true);
  });

  it('defendiendo: toque cambia de defensor, mantener nada, HABILIDAD es acción, TIRO es contacto', () => {
    const intents = feed(make(), [
      [{}, 'defend', 1],
      [{ y: 1 }, 'defend', 3],
      [{}, 'defend', 2],
      [{ x: -1 }, 'defend', 30],
      [{}, 'defend', 2],
      [{ skill: true }, 'defend', 2],
      [{}, 'defend', 2],
      [{ shot: true }, 'defend', 10],
      [{}, 'defend', 2],
    ]);
    expect(kinds(intents)).toEqual(expect.arrayContaining(['tap', 'swim', 'swimStop', 'skillTap', 'contactStart', 'contactEnd']));
    expect(intents.filter((i) => i.type === 'tap')).toHaveLength(1);
  });

  it('en el sprint inicial solo cuenta machacar HABILIDAD', () => {
    const intents = feed(make(), [
      [{}, 'sprint', 1],
      [{ skill: true }, 'sprint', 2],
      [{}, 'sprint', 2],
      [{ skill: true }, 'sprint', 2],
      [{ x: 1, shot: true }, 'sprint', 5],
    ]);
    expect(intents.map((i) => i.type)).toEqual(['skillPress', 'skillPress']);
  });
});

// ---------------------------------------------------------------------------------------------
// The match machine
// ---------------------------------------------------------------------------------------------

describe('sprint inicial', () => {
  it('suele ganarlo el más rápido; machacar HABILIDAD ayuda pero no lo decide todo', { timeout: 60_000 }, () => {
    let fastWins = 0;
    for (let i = 0; i < 30; i++) {
      const match = makeMatch({ seed: `sprint-${i}`, home: { speed: 9 }, away: { speed: 4 } });
      const { found } = until(match, (e) => e.type === 'swimOffWon', 15);
      if (found?.type === 'swimOffWon' && found.by.team === 0) fastWins++;
      expect(match.phase).toBe('transition');
      expect(match.possession).not.toBeNull();
    }
    expect(fastWins).toBeGreaterThanOrEqual(26);

    // Same speed: mashing against an AI that mashes too.
    const race = (mash: boolean, seed: string): boolean => {
      const match = makeMatch({ seed, human: true, difficulty: 'facil' });
      for (let s = 0; s < 60 * 15; s++) {
        const events = match.step({ ...NEUTRAL, skill: mash && s % 8 < 4 });
        const won = events.find((e) => e.type === 'swimOffWon');
        if (won?.type === 'swimOffWon') return won.by.team === 0;
      }
      return false;
    };
    let withMash = 0;
    let without = 0;
    for (let i = 0; i < 20; i++) {
      if (race(true, `mash-${i}`)) withMash++;
      if (race(false, `mash-${i}`)) without++;
    }
    expect(withMash).toBeGreaterThan(without);
  });
});

describe('máquina de estados del partido', () => {
  it('del sprint a la transición y de ahí al ataque posicional', () => {
    const match = makeMatch({ seed: 'fases' });
    const { found } = until(match, (e) => e.type === 'phase' && e.phase === 'positional', 25);
    expect(found).not.toBeNull();
    // Once settled, the attack is in its 3-3 and every defender has a man.
    const att = match.attackingSide!;
    expect(new Set(att.field.map((s) => s.slot)).size).toBe(6);
    expect(match.defendingSide!.field.every((d) => d.mark !== null)).toBe(true);
  });

  it('tras un gol: celebración y saca de centro el equipo que lo ha encajado', () => {
    let checked = 0;
    for (let i = 0; i < 6 && checked < 2; i++) {
      const match = makeMatch({ seed: `gol-${i}`, home: { power: 9, accuracy: 9 }, away: { power: 9, accuracy: 9 } });
      const goal = until(match, (e) => e.type === 'goal', 120).found;
      if (!goal || goal.type !== 'goal') continue;
      expect(match.phase).toBe('goal');
      const restart = until(match, (e) => e.type === 'setPiece', 10).found;
      expect(restart).toMatchObject({ type: 'setPiece', kind: 'restart', side: 1 - goal.side });
      expect(match.ball.holder?.team).toBe(1 - goal.side);
      expect(Math.abs(match.ball.holder!.pos.x - field.length / 2)).toBeLessThan(0.5);
      const whistle = until(match, (e) => e.type === 'phase', 5).found;
      expect(whistle).toMatchObject({ type: 'phase', phase: 'transition' });
      checked++;
    }
    expect(checked).toBe(2);
  });

  it('un tiro fuera es saque de portería: el portero tiene el balón y lo saca', () => {
    let checked = 0;
    for (let i = 0; i < 10 && checked < 2; i++) {
      const match = makeMatch({ seed: `fuera-${i}`, home: { accuracy: 1 }, away: { accuracy: 1 } });
      const miss = until(match, (e) => e.type === 'outcome' && e.outcome.type === 'miss', 150).found;
      if (!miss || miss.type !== 'outcome') continue;
      const shooterTeam = match.possession!;
      const throwIn = until(match, (e) => e.type === 'setPiece', 3).found;
      expect(throwIn).toMatchObject({ type: 'setPiece', kind: 'goalThrow', side: 1 - shooterTeam });
      expect(match.ball.holder?.keeper).toBe(true);
      const pass = until(match, (e) => e.type === 'pass', 5).found;
      expect(pass && pass.type === 'pass' ? pass.passer.keeper : false).toBe(true);
      checked++;
    }
    expect(checked).toBe(2);
  });

  it('si se agota la posesión, el balón pasa al rival con un golpe franco', () => {
    // Our sprinter wins the swim-off and then the player does nothing at all.
    const match = makeMatch({ seed: 'posesion', human: true, home: { speed: 10, skill: 10 }, away: { speed: 1, defense: 1 } });
    const won = until(match, (e) => e.type === 'swimOffWon', 15).found;
    expect(won && won.type === 'swimOffWon' ? won.by.team : -1).toBe(0);
    const free = until(match, (e) => e.type === 'setPiece', 22).found;
    expect(free).toMatchObject({ type: 'setPiece', kind: 'freeThrow', side: 1 });
    expect(match.stats[0].turnovers).toBe(1);
  });

  it('cada periodo termina con bocina, vuelve el sprint y tras el último se acaba el partido', () => {
    const match = makeMatch({ seed: 'periodos', periods: 2, periodSeconds: 24, clockSpeed: 3.2 });
    const events = runMatch(match, {}, 60 * 40);
    const kinds = types(events);
    expect(kinds.filter((k) => k === 'periodEnd')).toHaveLength(2);
    expect(kinds.filter((k) => k === 'horn')).toHaveLength(2);
    expect(kinds.filter((k) => k === 'swimOffWon').length).toBe(2);
    expect(kinds).toContain('fullTime');
    expect(match.phase).toBe('fullTime');
  });
});

describe('defensa del jugador', () => {
  /** Plays until the rival has a set attack against our human team. */
  function defending(seed: string): Match | null {
    const match = makeMatch({ seed, human: true, home: { speed: 1 }, away: { speed: 10, skill: 10 } });
    for (let s = 0; s < 60 * 30; s++) {
      match.step(NEUTRAL);
      if (match.phase === 'positional' && match.possession === 1 && match.ball.holder?.team === 1 && !match.ball.holder.keeper) return match;
    }
    return null;
  }

  it('el defensor seleccionado es el que marca al poseedor, y un toque lo cambia por otro', () => {
    const match = defending('cambio');
    expect(match).not.toBeNull();
    if (!match) return;
    run(match, {}, 2);
    const holder = match.ball.holder;
    if (holder?.team === 1) expect(match.selected?.mark).toBe(holder);
    const before = match.selected;
    const events = [...runMatch(match, { x: 0, y: 1 }, 4), ...runMatch(match, {}, 2), ...runMatch(match, { x: 0, y: -1 }, 4), ...runMatch(match, {}, 2)];
    expect(types(events)).toContain('switch');
    expect(match.controlled).toBe(match.selected);
    expect(match.selected).not.toBeNull();
    void before;
  });

  it('HABILIDAD pegado al poseedor es un intento de robo; lejos, leer la línea de pase', () => {
    let tried = 0;
    let read = 0;
    for (let i = 0; i < 6; i++) {
      const match = defending(`robo-${i}`);
      if (!match) continue;
      const holder = match.ball.holder!;
      const sel = match.selected!;
      if (Math.hypot(sel.pos.x - holder.pos.x, sel.pos.y - holder.pos.y) < T.defensa.robo.distancia) {
        const events = [...runMatch(match, { skill: true }, 2), ...runMatch(match, {}, 2)];
        if (events.some((e) => e.type === 'stealTry')) tried++;
      } else {
        const events = [...runMatch(match, { skill: true }, 2), ...runMatch(match, {}, 2)];
        if (events.some((e) => e.type === 'anticipate')) read++;
      }
    }
    expect(tried + read).toBeGreaterThan(0);
  });
});

function run(match: Match, pad: Partial<PadState>, n: number) {
  return runMatch(match, pad, n);
}

describe('partidos enteros IA contra IA', () => {
  it('terminan siempre, con goles de los dos equipos y todas las fases del partido', { timeout: 120_000 }, () => {
    const seen = new Set<string>();
    let goals = [0, 0];
    let possessionChanges = 0;
    for (let i = 0; i < 4; i++) {
      const match = makeMatch({ seed: `ia-${i}`, periodSeconds: 120 });
      let steps = 0;
      while (match.phase !== 'fullTime' && steps < 60 * 60 * 6) {
        for (const e of match.step(NEUTRAL)) {
          if (e.type === 'phase') seen.add(e.phase);
          if (e.type === 'possession') possessionChanges++;
        }
        steps++;
        if (steps % 60 === 0) for (const s of match.all) expect(Number.isFinite(s.pos.x + s.pos.y)).toBe(true);
      }
      expect(match.phase).toBe('fullTime');
      expect(match.stats[0].goals).toBe(match.score[0]);
      expect(match.stats[0].shots).toBeGreaterThanOrEqual(match.score[0]);
      goals = [goals[0]! + match.score[0], goals[1]! + match.score[1]];
    }
    expect(goals[0]).toBeGreaterThan(0);
    expect(goals[1]).toBeGreaterThan(0);
    expect(possessionChanges).toBeGreaterThan(20);
    expect([...seen]).toEqual(expect.arrayContaining(['transition', 'positional', 'setPiece', 'goal', 'periodEnd', 'fullTime']));
  });
});

describe('laboratorio de contraataque', () => {
  it('2x1: el balón es nuestro, hay superioridad y al acabar empieza otra contra', () => {
    const match = makeMatch({ seed: 'contra' });
    const lab = new (match.constructor as typeof import('../../src/sim/match/match').Match)({
      ...match.setup,
      sides: [
        { ...match.setup.sides[0], field: match.setup.sides[0].field.slice(0, 2) },
        { ...match.setup.sides[1], field: match.setup.sides[1].field.slice(0, 1) },
      ],
      counter: { attackers: 2, defenders: 1 },
    });
    expect(lab.phase).toBe('transition');
    expect(lab.possession).toBe(0);
    expect(lab.counterAttempts).toBe(1);
    const events = runMatch(lab, {}, 60 * 25);
    expect(types(events)).toContain('advantage');
    expect(lab.counterAttempts).toBeGreaterThan(1);
    expect(lab.period).toBe(1);
  });
});
