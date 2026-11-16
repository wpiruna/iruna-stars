import { describe, expect, it } from 'vitest';
import rulesJson from '../../data/reglas.json';
import tuning from '../../data/tuning.json';
import { Rng } from '../../src/core/rng';
import { toRivalTeam } from '../../src/data/model';
import { RulesSchema } from '../../src/data/schema';
import { AiKeeper, AiShooter } from '../../src/sim/duel/ai';
import { aimFromPad, Duel, type DuelConfig, type DuelEvent, type KeeperInput, type ShooterInput } from '../../src/sim/duel/duel';
import { Lab, LAB_SPOTS } from '../../src/sim/duel/lab';
import { pickKeeper, pickShooters, Shootout, ShootoutScore, type ShootoutEvent, type Side } from '../../src/sim/duel/shootout';
import { fieldFromRules, fromGoal } from '../../src/sim/field';
import { generateRoster } from '../../tools/rivales/generar';

const field = fieldFromRules(RulesSchema.parse(rulesJson));
const goal = field.goalRight;
const duelTuning = { shot: tuning.tiro, keeperTuning: tuning.portero, penaltyKeeper: tuning.penalti.portero };
const STEP = 1 / 60;
const IDLE: ShooterInput = { shot: false, pad: { x: 0, y: 0 } };
const NO_KEEPER: KeeperInput = { pad: { x: 0, y: 0 } };

function duel(overrides: Partial<DuelConfig> = {}, seed = 'duelo'): Duel {
  return new Duel({
    goal,
    position: fromGoal(goal, 5, 0),
    shooter: { power: 5, accuracy: 5, energy: 1 },
    keeper: { reflexes: 5, positioning: 5, energy: 1 },
    context: 'penalty',
    timeLimit: 8,
    aftermathSeconds: 1.5,
    rng: new Rng(seed),
    ...duelTuning,
    ...overrides,
  });
}

/** Holds the shot button for `hold` seconds with the pad in a direction, then lets the duel finish. */
function shoot(d: Duel, hold: number, pad = { x: 0, y: 0 }, keeper: (d: Duel) => KeeperInput = () => NO_KEEPER): DuelEvent[] {
  const events: DuelEvent[] = [];
  let held = 0;
  for (let i = 0; i < 60 * 12 && d.phase !== 'done'; i++) {
    const pressing = held < hold;
    if (pressing) held += STEP;
    events.push(...d.step(pressing ? { shot: true, pad } : { shot: false, pad }, keeper(d)));
  }
  return events;
}

const team = (id: string, nivel = 5) =>
  toRivalTeam(
    { id, nombre: id, siglas: id.slice(0, 3).toUpperCase(), nivel, estilo: 'equilibrado', enCopa: true, consejosEmilio: [], jugadoresReales: [], origen: 'provisional' },
    generateRoster({ id, nivel, estilo: 'equilibrado' }),
  );

describe('apuntar con el pad', () => {
  it('arriba y abajo eligen el palo; hacia la portería es bote y hacia atrás vaselina', () => {
    expect(aimFromPad({ x: 0, y: 0 }, goal)).toEqual({ side: 0, mode: 'direct' });
    expect(aimFromPad({ x: 0, y: -1 }, goal)).toEqual({ side: -1, mode: 'direct' });
    expect(aimFromPad({ x: 0, y: 1 }, goal)).toEqual({ side: 1, mode: 'direct' });
    expect(aimFromPad({ x: 1, y: 0 }, goal)).toEqual({ side: 0, mode: 'skip' });
    expect(aimFromPad({ x: -1, y: 0 }, goal)).toEqual({ side: 0, mode: 'lob' });
    // Diagonals combine both.
    expect(aimFromPad({ x: 0.7, y: -0.7 }, goal)).toEqual({ side: -1, mode: 'skip' });
    expect(aimFromPad({ x: -0.7, y: 0.7 }, goal)).toEqual({ side: 1, mode: 'lob' });
    // Attacking the other goal, "towards the goal" is the opposite screen direction.
    expect(aimFromPad({ x: -1, y: 0 }, field.goalLeft).mode).toBe('skip');
  });
});

describe('duelo lanzador contra portero', () => {
  it('pita, carga, suelta y resuelve, en ese orden', () => {
    const d = duel();
    const types = shoot(d, 0.7, { x: 0, y: -1 }).map((e) => e.type);
    expect(types[0]).toBe('whistle');
    expect(types.indexOf('chargeStart')).toBeLessThan(types.indexOf('release'));
    expect(types.indexOf('release')).toBeLessThan(types.indexOf('outcome'));
    expect(types.filter((t) => t === 'outcome')).toHaveLength(1);
    expect(d.phase).toBe('done');
    expect(d.plan?.side).toBe(-1);
    expect(d.plan?.quality).toBe('optimal');
    expect(d.outcome).not.toBeNull();
  });

  it('un toque de TIRO es un tiro rápido: sin subida y con menos potencia', () => {
    const quick = duel({}, 'q');
    shoot(quick, 0.05);
    const charged = duel({}, 'q');
    shoot(charged, 0.7);
    expect(quick.plan?.quality).toBe('quick');
    expect(quick.plan?.releaseHeight).toBeLessThan(charged.plan?.releaseHeight ?? 0);
    expect(quick.plan?.speed).toBeLessThan(charged.plan?.speed ?? 0);
  });

  it('mientras se carga el jugador se eleva y la barra sube; pasarse la suelta sola', () => {
    const d = duel();
    for (let i = 0; i < 20; i++) d.step({ shot: true, pad: { x: 0, y: 0 } }, NO_KEEPER);
    expect(d.phase).toBe('charging');
    expect(d.rise).toBeGreaterThan(0.9);
    expect(d.charge).toBeGreaterThan(0.3);
    expect(d.ballHolder).toBe('shooter');
    for (let i = 0; i < 120 && d.phase === 'charging'; i++) d.step({ shot: true, pad: { x: 0, y: 0 } }, NO_KEEPER);
    expect(d.phase).not.toBe('charging');
    expect(d.plan?.quality).toBe('over');
  });

  it('si se acaba el tiempo del penalti, el tiro sale solo', () => {
    const d = duel({ timeLimit: 1 });
    for (let i = 0; i < 59; i++) d.step(IDLE, NO_KEEPER);
    expect(d.phase).toBe('ready');
    expect(d.timeLeft).toBeLessThan(0.05);
    for (let i = 0; i < 5; i++) d.step(IDLE, NO_KEEPER);
    expect(d.phase).toBe('flight');
    expect(d.plan?.quality).toBe('quick');
  });

  it('el balón viaja de la mano a la portería sin saltos', () => {
    const d = duel({}, 'vuelo');
    let maxJump = 0;
    let previous = { ...d.ball };
    for (let i = 0; i < 600 && d.phase !== 'done'; i++) {
      d.step(i < 42 ? { shot: true, pad: { x: 0, y: 1 } } : IDLE, NO_KEEPER);
      if (d.phase === 'flight') maxJump = Math.max(maxJump, Math.hypot(d.ball.x - previous.x, d.ball.y - previous.y));
      previous = { ...d.ball };
    }
    // No frame moves the ball further than its top speed allows.
    expect(maxJump).toBeLessThan(((d.plan?.speed ?? 0) / 60) * 1.6);
    expect(d.ball.z).toBeGreaterThanOrEqual(0);
  });

  it('mismo azar, mismo resultado: se puede reproducir una jugada', () => {
    const a = duel({}, 'repetir');
    const b = duel({}, 'repetir');
    shoot(a, 0.66, { x: 1, y: 1 });
    shoot(b, 0.66, { x: 1, y: 1 });
    expect(a.plan).toEqual(b.plan);
    expect(a.outcome).toEqual(b.outcome);
  });

  it('el portero humano elige lado con el pad y ya no puede cambiarlo en el aire', () => {
    const d = duel({}, 'portero');
    const events = shoot(d, 0.7, { x: 0, y: -1 }, (current) =>
      current.phase === 'flight' ? { pad: { x: 0, y: current.flightTime < 0.05 ? 1 : -1 } } : NO_KEEPER,
    );
    expect(d.commit?.side).toBe(1);
    expect(events.filter((e) => e.type === 'dive')).toHaveLength(1);
  });

  it('tirarse fuera de la ventana no cuenta', () => {
    const d = duel({}, 'tarde');
    shoot(d, 0.7, { x: 0, y: 1 }, (current) =>
      current.phase === 'flight' && current.flightTime > tuning.penalti.portero.ventanaTrasDisparo + 0.03 ? { pad: { x: 0, y: 1 } } : NO_KEEPER,
    );
    expect(d.commit).toBeNull();
  });

  it('acertar el lado para más penaltis que tirarse al contrario', () => {
    const saves = (keeperSide: 1 | -1): number => {
      let count = 0;
      for (let i = 0; i < 300; i++) {
        const d = duel({}, `lado-${i}`);
        shoot(d, 0.7, { x: 0, y: 1 }, (current) => (current.phase === 'flight' ? { pad: { x: 0, y: keeperSide } } : NO_KEEPER));
        if (d.outcome?.type === 'save') count++;
      }
      return count;
    };
    const right = saves(1);
    const wrong = saves(-1);
    // Guessing right must pay off clearly, without turning the keeper into a wall.
    expect(right).toBeGreaterThan(wrong + 40);
    expect(right).toBeLessThan(170);
  });
});

describe('IA del penalti', () => {
  it('el lanzador de la IA espera, carga cerca de la zona óptima y tira a puerta casi siempre', () => {
    let onTarget = 0;
    let optimal = 0;
    for (let i = 0; i < 200; i++) {
      const rng = new Rng(`ia-${i}`);
      const d = duel({ rng });
      const ai = new AiShooter(rng, { accuracy: 6, skill: 5 }, tuning.penalti, 'normal', tuning.tiro);
      for (let s = 0; s < 60 * 12 && d.phase !== 'done'; s++) d.step(ai.next(d), NO_KEEPER);
      expect(d.phase).toBe('done');
      expect(d.releasedAt).toBeGreaterThan(tuning.penalti.ia.esperaAntesDeCargar.min);
      if (d.plan?.landing === 'onTarget') onTarget++;
      if (d.plan?.quality === 'optimal') optimal++;
    }
    expect(onTarget).toBeGreaterThan(150);
    expect(optimal).toBeGreaterThan(90);
  });

  it('el portero de la IA se tira a un lado o se queda, y acierta más con mejores Reflejos', () => {
    const correct = (reflexes: number): number => {
      let hits = 0;
      for (let i = 0; i < 400; i++) {
        const rng = new Rng(`pk-${i}`);
        const d = duel({ rng, keeper: { reflexes, positioning: 5, energy: 1 } });
        const keeper = new AiKeeper(rng, reflexes, tuning.penalti, 'dificil');
        shoot(d, 0.7, { x: 0, y: i % 2 === 0 ? 1 : -1 }, (current) => keeper.next(current));
        if (d.commit?.side === (i % 2 === 0 ? 1 : -1)) hits++;
      }
      return hits;
    };
    const low = correct(2);
    const high = correct(10);
    expect(high).toBeGreaterThan(low + 20);
    expect(low).toBeGreaterThan(80);
    expect(high).toBeLessThan(300);
  });

  it('si el portero humano se vence demasiado pronto, el lanzador puede cambiar de palo', () => {
    let switched = 0;
    for (let i = 0; i < 200; i++) {
      const rng = new Rng(`pronto-${i}`);
      const d = duel({ rng });
      const ai = new AiShooter(rng, { accuracy: 6, skill: 5 }, tuning.penalti, 'dificil', tuning.tiro);
      // The keeper leans down from the very first moment.
      for (let s = 0; s < 60 * 12 && d.phase !== 'done'; s++) d.step(ai.next(d), { pad: { x: 0, y: 1 } });
      if (d.plan && d.plan.side === -1) switched++;
    }
    // Without the reaction about 45 % would go up; reacting pushes it well above that.
    expect(switched).toBeGreaterThan(130);
  });
});

describe('reglas de la tanda', () => {
  const play = (score: ShootoutScore, results: boolean[]): void => {
    for (const scored of results) score.record(score.next as Side, scored);
  };

  it('alternan los equipos empezando por el que saca primero', () => {
    const score = new ShootoutScore(5, true, 1);
    const order: Side[] = [];
    for (let i = 0; i < 6; i++) {
      order.push(score.next as Side);
      score.record(score.next as Side, true);
    }
    expect(order).toEqual([1, 0, 1, 0, 1, 0]);
  });

  it('termina antes de los cinco tiros cuando ya no hay remontada posible', () => {
    const score = new ShootoutScore(5, true, 0);
    // 3–0 after three each: the second team still has two kicks, so it is not over…
    play(score, [true, false, true, false, true, false]);
    expect(score.winner).toBe(0);
    expect(score.next).toBeNull();

    const close = new ShootoutScore(5, true, 0);
    play(close, [true, false, true, false, false, false]);
    // 2–0 after three each: two kicks left for the trailing team → still alive.
    expect(close.winner).toBeNull();
    expect(close.next).toBe(0);
  });

  it('con empate a cinco hay muerte súbita hasta que uno falla y el otro marca', () => {
    const score = new ShootoutScore(5, true, 0);
    play(score, Array<boolean>(10).fill(true));
    expect(score.winner).toBeNull();
    expect(score.inRegularSeries).toBe(false);
    play(score, [true, true]);
    expect(score.winner).toBeNull();
    play(score, [true]);
    // The second team still has to answer.
    expect(score.winner).toBeNull();
    expect(score.next).toBe(1);
    play(score, [false]);
    expect(score.winner).toBe(0);
    expect(score.goals(0)).toBe(7);
  });

  it('sin muerte súbita en las reglas, cinco iguales es empate', () => {
    const score = new ShootoutScore(5, false, 0);
    play(score, Array<boolean>(10).fill(false));
    expect(score.drawn).toBe(true);
    expect(score.next).toBeNull();
  });

  it('elige a los cinco mejores lanzadores de campo y al mejor portero', () => {
    const squad = team('kraken', 8);
    const shooters = pickShooters(squad, 5);
    expect(shooters).toHaveLength(5);
    expect(shooters.every((p) => p.position !== 'goalkeeper')).toBe(true);
    const rating = (p: (typeof shooters)[number]): number => p.stats.power + p.stats.accuracy;
    const worstChosen = Math.min(...shooters.map(rating));
    const others = squad.players.filter((p) => p.position !== 'goalkeeper' && !shooters.includes(p));
    expect(Math.max(...others.map(rating))).toBeLessThanOrEqual(worstChosen);
    expect(pickKeeper(squad).position).toBe('goalkeeper');
  });
});

describe('tanda completa', () => {
  const shootout = (seed: string, levels: [number, number] = [5, 5]): Shootout => {
    const teams = [team('locales', levels[0]), team('visitantes', levels[1])] as const;
    return new Shootout({
      sides: [
        { team: teams[0], shooters: pickShooters(teams[0], 5), keeper: pickKeeper(teams[0]), human: false },
        { team: teams[1], shooters: pickShooters(teams[1], 5), keeper: pickKeeper(teams[1]), human: false },
      ],
      first: 0,
      goal,
      penaltyDistance: field.fiveMetres,
      kicksPerTeam: 5,
      suddenDeath: true,
      difficulty: 'normal',
      duel: duelTuning,
      penalty: tuning.penalti,
      rng: new Rng(seed),
    });
  };
  const run = (s: Shootout): ShootoutEvent[] => {
    const events: ShootoutEvent[] = [];
    for (let i = 0; i < 60 * 60 * 10 && s.phase !== 'finished'; i++) events.push(...s.step({ shot: false, pad: { x: 0, y: 0 } }));
    return events;
  };

  it('IA contra IA: siempre termina con un ganador y el marcador cuadra con los tiros', () => {
    for (let i = 0; i < 25; i++) {
      const s = shootout(`tanda-${i}`);
      const events = run(s);
      expect(s.phase).toBe('finished');
      const finished = events.find((e) => e.type === 'finished');
      expect(finished && finished.type === 'finished' ? finished.winner : null).not.toBeNull();
      const kicks = events.filter((e) => e.type === 'kickEnd');
      expect(kicks.length).toBe(s.score.kicks[0].length + s.score.kicks[1].length);
      expect(kicks.length).toBeGreaterThanOrEqual(6);
      expect(Math.abs(s.score.kicks[0].length - s.score.kicks[1].length)).toBeLessThanOrEqual(1);
      expect(events.filter((e) => e.type === 'kickStart').length).toBe(kicks.length);
    }
  });

  it('la conversión de la IA ronda el 75 % y el equipo mejor gana más veces', () => {
    let goals = 0;
    let kicks = 0;
    let strongWins = 0;
    const rounds = 60;
    for (let i = 0; i < rounds; i++) {
      const even = shootout(`media-${i}`);
      run(even);
      goals += even.score.goals(0) + even.score.goals(1);
      kicks += even.score.kicks[0].length + even.score.kicks[1].length;
      const uneven = shootout(`nivel-${i}`, [9, 2]);
      run(uneven);
      if (uneven.score.winner === 0) strongWins++;
    }
    expect(goals / kicks).toBeGreaterThan(0.62);
    expect(goals / kicks).toBeLessThan(0.84);
    expect(strongWins).toBeGreaterThan(rounds * 0.6);
  });

  it('en la muerte súbita repiten los mismos lanzadores en el mismo orden', () => {
    for (let i = 0; i < 80; i++) {
      const s = shootout(`subita-${i}`);
      const starts = run(s).filter((e) => e.type === 'kickStart');
      const mine = starts.flatMap((e) => (e.type === 'kickStart' && e.kick.side === 0 ? [e.kick] : []));
      if (mine.length <= 5) continue;
      expect(mine[5]?.shooter.id).toBe(mine[0]?.shooter.id);
      expect(mine[5]?.suddenDeath).toBe(true);
      return;
    }
    throw new Error('ninguna tanda llegó a la muerte súbita en 80 intentos');
  });

  it('con un humano, la tanda espera a que tire y le deja parar', () => {
    const teams = [team('nuestro'), team('rival')] as const;
    const s = new Shootout({
      sides: [
        { team: teams[0], shooters: pickShooters(teams[0], 5), keeper: pickKeeper(teams[0]), human: true },
        { team: teams[1], shooters: pickShooters(teams[1], 5), keeper: pickKeeper(teams[1]), human: false },
      ],
      first: 0,
      goal,
      penaltyDistance: 5,
      kicksPerTeam: 5,
      suddenDeath: true,
      difficulty: 'normal',
      duel: duelTuning,
      penalty: { ...tuning.penalti, segundosLimite: 0 },
      rng: new Rng('humano'),
    });
    for (let i = 0; i < 60 * 5; i++) s.step({ shot: false, pad: { x: 0, y: 0 } });
    // Nobody pressed anything: still waiting on our first shot.
    expect(s.phase).toBe('kick');
    expect(s.kick?.humanRole).toBe('shooter');
    expect(s.score.kicks[0]).toHaveLength(0);
    for (let i = 0; i < 40; i++) s.step({ shot: true, pad: { x: 0, y: 1 } });
    for (let i = 0; i < 60 * 6 && s.kick?.humanRole !== 'keeper'; i++) s.step({ shot: false, pad: { x: 0, y: 0 } });
    expect(s.score.kicks[0]).toHaveLength(1);
    expect(s.kick?.humanRole).toBe('keeper');
  });
});

describe('laboratorio de tiro', () => {
  it('encadena tiros, lleva la cuenta y aplica los deslizadores', () => {
    const spot = LAB_SPOTS.find((s) => s.id === 'cierre') ?? LAB_SPOTS[0]!;
    const lab = new Lab(goal, { spot, power: 5, accuracy: 5, reflexes: 5, positioning: 5 }, duelTuning, tuning.penalti, new Rng('lab'));
    const fire = (): void => {
      for (let i = 0; i < 45; i++) lab.step({ shot: true, pad: { x: 0, y: 1 } });
      for (let i = 0; i < 60 * 4 && lab.duel.phase !== 'ready'; i++) lab.step({ shot: false, pad: { x: 0, y: 0 } });
    };
    for (let i = 0; i < 6; i++) fire();
    expect(lab.stats.shots).toBe(6);
    expect(lab.stats.goals + lab.stats.saves + lab.stats.posts + lab.stats.misses).toBe(6);
    expect(lab.stats.last?.plan.quality).toBe('optimal');
    const slow = lab.stats.last?.plan.speed ?? 0;

    lab.configure({ spot, power: 10, accuracy: 5, reflexes: 5, positioning: 5 });
    fire();
    expect(lab.stats.last?.plan.speed).toBeGreaterThan(slow * 1.25);
    lab.resetStats();
    expect(lab.stats.shots).toBe(0);
  });
});
