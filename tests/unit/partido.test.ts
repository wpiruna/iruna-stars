import { describe, expect, it } from 'vitest';
import tuning from '../../data/tuning.json';
import type { PadState } from '../../src/sim/attack/control';
import { passRisk } from '../../src/sim/attack/passing';
import { MatchInput, type ControlContext, type MatchIntent } from '../../src/sim/match/input';
import type { Match } from '../../src/sim/match/match';
import { assignMarks, bestMatching, countAdvantage } from '../../src/sim/match/roles';
import type { MatchEvent } from '../../src/sim/match/types';
import { fromGoal } from '../../src/sim/field';
import { field, formations, makeMatch, makeSwimmer, NEUTRAL, runMatch, T } from './escena';

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
    // Negative costs (a preference): the first full answer found is not a bound for the rest.
    const preferred = [
      [0, 1, 9],
      [9, 0, 0],
      [-30, 9, -18],
    ];
    expect(bestMatching(3, 3, (r, c) => preferred[r]![c]!)).toEqual([1, 2, 0]);
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
      const throwIn = until(match, (e) => e.type === 'setPiece' || e.type === 'foul', 3).found;
      // A foul on the shooter held back for the advantage is whistled after the miss: not this case.
      if (throwIn?.type === 'foul') continue;
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
    // (A foul on the way gives us a free throw that does not stop the shot clock: wait for the clock.)
    const free = until(match, (e) => e.type === 'setPiece' && e.reason === 'clock', 30).found;
    expect(free).toMatchObject({ type: 'setPiece', kind: 'freeThrow', side: 1 });
    expect(match.stats[0].turnovers).toBe(1);
  });

  it('cada periodo termina con bocina, vuelve el sprint y tras el último se acaba el partido', () => {
    const match = makeMatch({ seed: 'periodos', periods: 2, periodSeconds: 24, clockSpeed: 3.2 });
    // Room for a penalty or a goal on the way (the clock stops for them).
    const events = runMatch(match, {}, 60 * 60);
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

describe('ritmo del partido (lo que pidió Julián tras la F4)', () => {
  it('unas dos de cada tres posesiones llegan al ataque en estático, y con tiempo de posesión', { timeout: 120_000 }, () => {
    let possessions = 0;
    let reached = 0;
    let clock = 0;
    for (let i = 0; i < 4; i++) {
      const match = makeMatch({ seed: `ritmo-${i}`, periods: 2, periodSeconds: 360 });
      let current: { reached: boolean } | null = null;
      let steps = 0;
      while (match.phase !== 'fullTime' && steps < 60 * 60 * 6) {
        for (const e of match.step(NEUTRAL)) {
          if (e.type === 'possession' && e.reason !== 'swimOff') {
            possessions++;
            current = { reached: match.phase === 'positional' };
            if (current.reached) reached++;
          } else if (e.type === 'phase' && e.phase === 'positional' && current && !current.reached) {
            current.reached = true;
            reached++;
            clock += match.shotClock;
          }
        }
        steps++;
      }
    }
    const rate = reached / possessions;
    expect(rate).toBeGreaterThan(0.55);
    expect(rate).toBeLessThan(0.9);
    expect(clock / reached).toBeGreaterThan(18);
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

// ---------------------------------------------------------------------------------------------
// F4: the referee in the match
// ---------------------------------------------------------------------------------------------

/** Plays until there is a set attack, with a field player holding the ball. */
function setAttack(match: Match, team: 0 | 1 | null = null, maxSeconds = 60): boolean {
  for (let s = 0; s < maxSeconds * 60; s++) {
    // Our human player swims the ball up (we attack to the right); the AI does the rest.
    const carrying = match.padMode === 'swim';
    match.step(carrying ? { ...NEUTRAL, x: 1, touching: true } : NEUTRAL);
    const h = match.ball.holder;
    if (match.phase === 'positional' && h && !h.keeper && (team === null || h.team === team)) {
      runMatch(match, {}, 3);
      if (match.ball.holder === h) return true;
    }
  }
  return false;
}

describe('árbitro en el partido', () => {
  it('exclusión: 6x5 con 4-2, el excluido nada a su zona y vuelve cuando toca', () => {
    const match = makeMatch({ seed: 'exclusion' });
    expect(setAttack(match)).toBe(true);
    const att = match.possession as 0 | 1;
    const def = (1 - att) as 0 | 1;
    const victim = match.inPlay(att).find((a) => a !== match.ball.holder)!;
    const by = match.defenderOf(victim) ?? match.inPlay(def)[0]!;
    const events = match.forceCall(by, victim, 'exclusion', 'AGARRÓN');
    expect(events.find((e) => e.type === 'foul')).toMatchObject({ sanction: 'exclusion', motive: 'AGARRÓN', personal: 1, out: false, awarded: att });
    expect(match.inPlay(def)).toHaveLength(5);
    expect(match.exclusions).toHaveLength(1);
    expect(by.excluded).toBe(true);
    expect(match.phase).toBe('setPiece');
    expect(match.shotClock).toBeGreaterThanOrEqual(18);
    // After the whistle: superiority in the 4-2, no centre fight.
    until(match, (e) => e.type === 'phase' && e.phase === 'positional', 5);
    expect(match.shapeOf(att)).toBe('4-2');
    expect(match.boya).toBeNull();
    const start = { ...by.pos };
    const back = until(match, (e) => e.type === 'exclusionEnd' || e.type === 'goal', 40);
    expect(back.found).not.toBeNull();
    if (back.found?.type === 'exclusionEnd') {
      expect(back.found.who).toBe(by);
      // He came back from his re-entry area, by his own goal line, at the side of the pool.
      expect(by.pos.y).toBeLessThan(3.5);
      expect(Math.hypot(by.pos.x - start.x, by.pos.y - start.y)).toBeGreaterThan(1);
    }
    runMatch(match, {}, 30);
    expect(match.inPlay(def)).toHaveLength(6);
    expect(by.excluded).toBe(false);
  });

  it('si el equipo del excluido recupera el balón, puede volver antes de tiempo', () => {
    const match = makeMatch({ seed: 'vuelve' });
    expect(setAttack(match)).toBe(true);
    const att = match.possession as 0 | 1;
    const def = (1 - att) as 0 | 1;
    const by = match.inPlay(def)[0]!;
    match.forceCall(by, match.ball.holder, 'exclusion');
    const ex = match.exclusions[0]!;
    expect(ex.canReturn).toBe(false);
    // An offensive foul gives the ball to the short team: the way back opens at once.
    match.forceCall(match.inPlay(att)[0]!, by, 'ordinary', 'EMPUJÓN');
    expect(match.possession).toBe(def);
    expect(ex.canReturn).toBe(true);
    expect(ex.left).toBeGreaterThan(10);
  });

  it('tercera falta personal: ¡EXPULSADO! para todo el partido y entra un suplente', () => {
    const match = makeMatch({ seed: 'personales' });
    expect(setAttack(match)).toBe(true);
    const def = (1 - (match.possession as number)) as 0 | 1;
    const by = match.inPlay(def)[0]!;
    const bench = match.benchOf(def).length;
    match.personal.set(by, 2);
    const events = match.forceCall(by, match.ball.holder, 'exclusion', 'HUNDIR');
    expect(events.find((e) => e.type === 'foul')).toMatchObject({ personal: 3, out: true });
    const sub = until(match, (e) => e.type === 'substitution', 40).found;
    expect(sub).toMatchObject({ type: 'substitution', out: by });
    runMatch(match, {}, 60 * 12);
    expect(by.away).toBe(true);
    expect(match.inPlay(def)).not.toContain(by);
    expect(match.inPlay(def)).toHaveLength(6);
    expect(match.benchOf(def)).toHaveLength(bench - 1);
  });

  it('penalti: el mejor lanzador desde 5 m, todos los demás fuera de los 6 m, y el balón vuelve al juego', () => {
    const match = makeMatch({ seed: 'penalti' });
    expect(setAttack(match)).toBe(true);
    const att = match.possession as 0 | 1;
    const def = (1 - att) as 0 | 1;
    const events = match.forceCall(match.inPlay(def)[0]!, match.ball.holder, 'penalty', 'POR DETRÁS');
    expect(types(events)).toContain('penalty');
    expect(match.phase).toBe('penalty');
    const goal = match.goalOf(att);
    const shooter = match.ball.holder!;
    expect(Math.abs(Math.abs(shooter.pos.x - goal.x) - 5)).toBeLessThan(0.01);
    for (const s of [...match.inPlay(0), ...match.inPlay(1)]) {
      if (s === shooter) continue;
      expect(Math.abs(s.pos.x - goal.x)).toBeGreaterThan(6);
      expect(Math.hypot(s.pos.x - shooter.pos.x, s.pos.y - shooter.pos.y)).toBeGreaterThanOrEqual(3);
    }
    const after = until(match, (e) => e.type === 'phase' && e.previous === 'penalty', 15);
    expect(after.found).not.toBeNull();
    expect(types(after.events)).toEqual(expect.arrayContaining(['whistle', 'release', 'outcome']));
    expect(match.stats[att].shots).toBeGreaterThan(0);
  });

  it('penalti nuestro: un TIRO pulsado desde antes no cuenta; pulsar y soltar después, sí', () => {
    const match = makeMatch({ seed: 'penalti-humano', human: true, home: { speed: 10, skill: 10 }, away: { speed: 1 } });
    expect(setAttack(match, 0)).toBe(true);
    match.forceCall(match.inPlay(1)[0]!, match.ball.holder, 'penalty', 'GOL CLARO');
    expect(match.phase).toBe('penalty');
    // Held from before the whistle: nothing happens.
    const held = runMatch(match, { shot: true }, 60 * 3);
    expect(types(held)).not.toContain('chargeStart');
    expect(match.padMode).toBe('shoot');
    runMatch(match, {}, 5);
    const shot = [...runMatch(match, { shot: true }, 40), ...runMatch(match, {}, 120)];
    expect(types(shot)).toEqual(expect.arrayContaining(['chargeStart', 'release', 'outcome']));
  });

  it('falta dentro de los 6 m: hay que pasar; fuera de los 6 m se puede tirar directo', () => {
    for (const [distance, direct] of [
      [4.5, false],
      [7.5, true],
    ] as const) {
      const match = makeMatch({ seed: `libre-${distance}`, human: true, home: { speed: 10, skill: 10 }, away: { speed: 1 } });
      expect(setAttack(match, 0)).toBe(true);
      const holder = match.ball.holder!;
      const goal = match.goalOf(0);
      holder.pos = { x: goal.x - goal.facing * distance, y: goal.y + 1 };
      match.ball.pos = { x: holder.pos.x, y: holder.pos.y, z: 0.3 };
      match.forceCall(match.inPlay(1)[0]!, holder, 'ordinary', 'FALTA');
      expect(match.phase).toBe('setPiece');
      until(match, (e) => e.type === 'phase' && e.phase === 'positional', 3);
      runMatch(match, {}, 2);
      const events = [...runMatch(match, { shot: true }, 6), ...runMatch(match, {}, 2)];
      if (direct) expect(types(events)).toContain('chargeStart');
      else {
        expect(types(events)).toContain('mustPass');
        expect(types(events)).not.toContain('chargeStart');
      }
    }
  });

  it('IA contra IA: un árbitro estricto pita más exclusiones por cada contacto que uno permisivo', { timeout: 120_000 }, () => {
    const whistled = (referee: { contactTolerance: number; exclusionTendency: number }) => {
      let contacts = 0;
      let exclusions = 0;
      for (let i = 0; i < 4; i++) {
        const match = makeMatch({ seed: `arbitro-${i}`, periods: 2, periodSeconds: 240, referee, home: { aggression: 8 }, away: { aggression: 8 } });
        let steps = 0;
        while (match.phase !== 'fullTime' && steps < 60 * 60 * 6) {
          for (const e of match.step(NEUTRAL)) {
            if (e.type === 'contact') contacts++;
            if (e.type === 'foul' && e.sanction === 'exclusion') exclusions++;
          }
          steps++;
        }
        expect(match.phase).toBe('fullTime');
      }
      return { contacts, exclusions, rate: exclusions / Math.max(1, contacts) };
    };
    const strict = whistled({ contactTolerance: 2, exclusionTendency: 8 });
    const loose = whistled({ contactTolerance: 9, exclusionTendency: 3 });
    expect(strict.exclusions).toBeGreaterThan(3);
    expect(strict.rate).toBeGreaterThan(loose.rate * 1.3);
  });

  it('laboratorio de superioridad: 6 contra 5 una y otra vez', () => {
    const match = makeMatch({ seed: 'lab-6x5', manUp: 'attack' });
    expect(match.inPlay(0)).toHaveLength(6);
    expect(match.inPlay(1)).toHaveLength(5);
    runMatch(match, {}, 60 * 40);
    expect(match.counterAttempts).toBeGreaterThan(1);
    expect(match.period).toBe(1);
  });
});

describe('el balón y la red', () => {
  it('un gol se queda dentro de la red; un tiro fuera acaba fuera de la portería', { timeout: 120_000 }, () => {
    let goals = 0;
    let misses = 0;
    for (let i = 0; i < 12 && (goals < 10 || misses < 6); i++) {
      const match = makeMatch({ seed: `red-${i}`, home: { power: 9, accuracy: 4 }, away: { power: 9, accuracy: 4 } });
      for (let s = 0; s < 60 * 400 && (goals < 10 || misses < 6); s++) {
        for (const e of match.step(NEUTRAL)) {
          if (e.type === 'goal') {
            const goal = match.goalOf(e.side);
            // Watch the ball for the whole celebration: never outside the goal.
            for (let k = 0; k < 60 * 2; k++) {
              match.step(NEUTRAL);
              const b = match.ball.pos;
              const behind = (b.x - goal.x) * goal.facing;
              if (behind > 0.05) {
                expect(Math.abs(b.y - goal.y)).toBeLessThan(goal.halfWidth);
                expect(behind).toBeLessThan(0.85);
                expect(b.z).toBeLessThan(goal.height);
              }
            }
            const b = match.ball.pos;
            expect((b.x - goal.x) * goal.facing).toBeGreaterThan(0);
            expect(Math.abs(b.y - goal.y)).toBeLessThan(goal.halfWidth);
            goals++;
          } else if (e.type === 'outcome' && e.outcome.type === 'miss') {
            const shooter = match.ball.lastTouch;
            const goal = match.goalOf(shooter?.team ?? 0);
            for (let k = 0; k < 30; k++) match.step(NEUTRAL);
            const b = match.ball.pos;
            const behind = (b.x - goal.x) * goal.facing;
            // Out: beside the goal, or behind the net against the wall, never resting inside it.
            const insideNet = behind > 0 && behind < 0.85 && Math.abs(b.y - goal.y) < goal.halfWidth && b.z < goal.height;
            expect(insideNet).toBe(false);
            misses++;
          }
        }
      }
    }
    expect(goals).toBeGreaterThanOrEqual(10);
    expect(misses).toBeGreaterThanOrEqual(6);
  });
});

describe('faltas en ataque', () => {
  it('pocas en general; muchas más cuando recibe un boya Leñador, y siempre el balón cambia de equipo', { timeout: 300_000 }, () => {
    const rate = (lenador: boolean) => {
      let catches = 0;
      let fouls = 0;
      let all = 0;
      for (let i = 0; i < 20; i++) {
        const match = makeMatch({ seed: `ataque-${i}`, periods: 2, periodSeconds: 240 });
        // The home centre (the first field player), with the Leñador trait as Ángel has in the sheet.
        const centre = match.inPlay(0)[0]!;
        if (lenador) (centre.player as { trait?: string }).trait = 'enforcer';
        let steps = 0;
        while (match.phase !== 'fullTime' && steps < 60 * 60 * 6) {
          const before = match.possession;
          for (const e of match.step(NEUTRAL)) {
            // Only receptions with a defender on him: the ones where a push can happen.
            if (e.type === 'catch' && e.by === centre && match.boya === centre) {
              const marked = match.inPlay(1).some((d) => Math.hypot(d.pos.x - centre.pos.x, d.pos.y - centre.pos.y) <= tuning.partido.defensa.contacto.distancia);
              if (marked) catches++;
            }
            if (e.type !== 'foul' || !e.offensive) continue;
            expect(e.sanction).toBe('ordinary');
            expect(e.by.team).toBe(before);
            expect(e.awarded).toBe(1 - e.by.team);
            all++;
            if (e.by === centre) fouls++;
          }
          steps++;
        }
      }
      return { catches, fouls, all };
    };
    const normal = rate(false);
    const withLenador = rate(true);
    // Rare without the trait (well under two per team and match); with it, the centre is called
    // for a good share of his receptions, and far more often than a centre without it.
    expect(normal.all / 40).toBeLessThan(2);
    expect(withLenador.catches).toBeGreaterThan(8);
    expect(withLenador.fouls / withLenador.catches).toBeGreaterThan(0.15);
    expect(normal.fouls / Math.max(1, normal.catches)).toBeLessThan(withLenador.fouls / withLenador.catches);
  });
});

describe('sonido del agua', () => {
  it('suena con la contra y baja cuando el ataque ya está asentado (Julián)', async () => {
    const { swimActivity } = await import('../../src/app/ambience');
    const match = makeMatch({ seed: 'agua' });
    const sprint: number[] = [];
    const settled: number[] = [];
    let phase = '';
    let since = 0;
    for (let i = 0; i < 60 * 240; i++) {
      match.step(NEUTRAL);
      since = match.phase === phase ? since + 1 : 0;
      phase = match.phase;
      const a = swimActivity([...match.inPlay(0), ...match.inPlay(1)]);
      // The sprint of a break (its first seconds) and a set attack that has been there a while.
      if (phase === 'transition' && since > 60 && since < 300) sprint.push(a);
      if (phase === 'positional' && since > 60 * 7) settled.push(a);
    }
    const median = (xs: number[]) => [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)] ?? 0;
    expect(sprint.length).toBeGreaterThan(300);
    expect(settled.length).toBeGreaterThan(60);
    expect(median(sprint)).toBeGreaterThan(0.8);
    expect(median(settled)).toBeLessThan(0.3);
    expect(swimActivity([])).toBe(0);
  });
});

describe('repetición del gol', () => {
  it('reproduce lo grabado y, al acabar, el partido sigue exactamente igual que sin repetición', async () => {
    const { GoalReplay } = await import('../../src/app/replay');
    const a = makeMatch({ seed: 'repe' });
    const b = makeMatch({ seed: 'repe' });
    const replay = new GoalReplay(a.all, a.keepers, a.ball, 4);
    const frames: { x: number; y: number }[][] = [];
    for (let i = 0; i < 60 * 12; i++) {
      replay.record(a.step(NEUTRAL));
      b.step(NEUTRAL);
      frames.push(a.all.map((s) => ({ x: s.pos.x, y: s.pos.y })));
    }
    const from = replay.frame - 150;
    expect(replay.start(from, replay.frame, 0.4)).toBe(true);
    // The first replayed picture is the recorded one.
    a.all.forEach((s, i) => {
      expect(s.pos.x).toBeCloseTo(frames[from]![i]!.x, 4);
      expect(s.pos.y).toBeCloseTo(frames[from]![i]!.y, 4);
    });
    let steps = 0;
    const seen: string[] = [];
    while (replay.step((e) => seen.push(e.type))) steps++;
    expect(steps).toBeGreaterThan(300);
    // Back to live, and the simulation never noticed.
    for (let i = 0; i < 60 * 8; i++) {
      a.step(NEUTRAL);
      b.step(NEUTRAL);
    }
    a.all.forEach((s, i) => {
      expect(s.pos.x).toBe(b.all[i]!.pos.x);
      expect(s.pos.y).toBe(b.all[i]!.pos.y);
    });
    expect(a.ball.pos).toEqual(b.ball.pos);
    expect(a.score).toEqual(b.score);
  });
});

describe('solo ante el portero', () => {
  /** Our player alone with the ball at 9 m, a defender a stroke behind him, the rest far away. */
  function breakaway(behind: number): Match {
    const base = makeMatch({ seed: 'solo', human: true });
    const match = new (base.constructor as typeof import('../../src/sim/match/match').Match)({
      ...base.setup,
      sides: [
        { ...base.setup.sides[0], field: base.setup.sides[0].field.slice(0, 2) },
        { ...base.setup.sides[1], field: base.setup.sides[1].field.slice(0, 1) },
      ],
      counter: { attackers: 2, defenders: 1 },
    });
    const goal = match.goalOf(0);
    const holder = match.ball.holder!;
    holder.pos = { x: goal.x - goal.facing * 9, y: goal.y + 0.5 };
    holder.prev = { ...holder.pos };
    const mate = match.inPlay(0).find((s) => s !== holder)!;
    mate.pos = { x: goal.x - goal.facing * 16, y: goal.y + 6 };
    const defender = match.inPlay(1)[0]!;
    defender.pos = { x: holder.pos.x - goal.facing * behind, y: holder.pos.y + 0.3 };
    defender.prev = { ...defender.pos };
    return match;
  }

  it('si nadie le tapa, sigue nadando hasta cerca del portero en vez de quedarse parado en los 5 m', () => {
    for (const behind of [0.5, 2.5]) {
      const match = breakaway(behind);
      const goal = match.goalOf(0);
      let closest = Infinity;
      // A fresh press once the play is on (a press from before would not count).
      runMatch(match, {}, 5);
      for (let i = 0; i < 60 * 6 && match.ball.holder?.team === 0 && closest > 2.8; i++) {
        match.step({ ...NEUTRAL, x: 1, touching: true });
        const h = match.ball.holder;
        if (h) closest = Math.min(closest, Math.abs(h.pos.x - goal.x));
      }
      // He got close to the keeper still on the break, and shoots from there.
      expect(closest).toBeLessThan(3);
      expect(match.phase).toBe('transition');
      expect(match.padMode).toBe('swim');
      const shot = [...runMatch(match, {}, 2), ...runMatch(match, { shot: true }, 20), ...runMatch(match, {}, 60)];
      expect(types(shot)).toContain('release');
    }
  });

  it('no se mete encima del portero: frena a un par de metros', () => {
    const match = breakaway(6);
    const goal = match.goalOf(0);
    runMatch(match, {}, 5);
    let closest = Infinity;
    for (let i = 0; i < 60 * 6 && match.ball.holder?.team === 0; i++) {
      match.step({ ...NEUTRAL, x: 1, touching: true });
      const h = match.ball.holder;
      if (h) closest = Math.min(closest, Math.abs(h.pos.x - goal.x));
    }
    expect(closest).toBeGreaterThan(1.7);
    expect(closest).toBeLessThan(2.8);
  });
});

describe('puestos en el ataque estático', () => {
  it('el zurdo juega siempre por la derecha y el cierre defiende al boya rival', { timeout: 120_000 }, () => {
    let settles = 0;
    let lefty = 0;
    let cierreOnBoya = 0;
    let checks = 0;
    for (let i = 0; i < 4; i++) {
      const match = makeMatch({ seed: `puestos-${i}`, periods: 2, periodSeconds: 180 });
      // A left-handed driver in each team, as Tainta (7) in ours.
      const lefties = [match.inPlay(0)[3]!, match.inPlay(1)[3]!];
      for (const s of lefties) (s.player as { hand: string }).hand = 'left';
      let steps = 0;
      while (match.phase !== 'fullTime' && steps < 60 * 60 * 5) {
        for (const e of match.step(NEUTRAL)) {
          if (e.type !== 'phase' || e.phase !== 'positional') continue;
          const att = match.possession as 0 | 1;
          const def = (1 - att) as 0 | 1;
          if (match.inPlay(att).length !== 6 || match.inPlay(def).length !== 6) continue;
          const l = lefties[att]!;
          if (match.inPlay(att).includes(l)) {
            settles++;
            if (l.slot === 'lateralDer' || l.slot === 'extremoDer') lefty++;
          }
          const cierre = match.inPlay(def).find((d) => d.player.position === 'point');
          if (cierre) {
            checks++;
            if (cierre.mark?.slot === 'boya') cierreOnBoya++;
          }
        }
        steps++;
      }
    }
    expect(settles).toBeGreaterThan(20);
    expect(lefty).toBe(settles);
    expect(cierreOnBoya / checks).toBeGreaterThan(0.85);
  });

  it('el boya nunca llega solo a su sitio: su defensor va con él por dentro (Julián)', { timeout: 120_000 }, () => {
    const near = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
    let swimming = 0;
    let alone = 0;
    let arrivals = 0;
    let unmarked = 0;
    for (let i = 0; i < 6; i++) {
      const match = makeMatch({ seed: `boya-${i}`, periods: 2, periodSeconds: 180 });
      let far = false;
      for (let steps = 0; match.phase !== 'fullTime' && steps < 60 * 60 * 5; steps++) {
        match.step(NEUTRAL);
        const att = match.possession;
        // The set attack, six against six (a break that gets away is another story).
        if (match.phase !== 'positional' || att === null || match.inPlay(att).length !== 6 || match.inPlay((1 - att) as 0 | 1).length !== 6) {
          far = false;
          continue;
        }
        const boya = match.inPlay(att).find((s) => s.slot === 'boya');
        if (!boya || match.ball.holder === boya) continue;
        const goal = match.goalOf(att);
        const spot = fromGoal(goal, Math.max(T.zona.distanciaMinima, formations.ataque33?.puestos.boya?.x ?? 2), 0);
        const closest = Math.min(...match.inPlay((1 - att) as 0 | 1).map((d) => near(d.pos, boya.pos)));
        const toSpot = near(boya.pos, spot);
        if (toSpot > 1 && Math.hypot(boya.vel.x, boya.vel.y) > 0.6 && Math.abs(goal.x - boya.pos.x) < 10) {
          swimming++;
          if (closest > 1.6) alone++;
        }
        if (toSpot > 3) far = true;
        else if (toSpot < 1 && far) {
          far = false;
          arrivals++;
          if (closest > 1.6) unmarked++;
        }
      }
    }
    // Before (the defender a stroke slower and behind him): alone 40 % of the way, 82 % of arrivals.
    expect(arrivals).toBeGreaterThan(15);
    expect(alone / swimming).toBeLessThan(0.1);
    expect(unmarked / arrivals).toBeLessThan(0.1);
  });
});
