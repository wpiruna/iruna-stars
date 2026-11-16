import { describe, expect, it } from 'vitest';
import { AttackInput, type AttackIntent, type PadState } from '../../src/sim/attack/control';
import { Rng } from '../../src/core/rng';
import { insidePoint, rollReaction } from '../../src/sim/attack/drive';
import { assignSlots, pickLineup, toGoal } from '../../src/sim/attack/formation';
import type { AttackEvent, Slot } from '../../src/sim/attack/types';
import { attacker, makeDrill, makePlayer, NEUTRAL, run, T, untilLive } from './escena';

// ---------------------------------------------------------------------------------------------
// Control grammar
// ---------------------------------------------------------------------------------------------

const STEP = 1000 / 60;
function feed(input: AttackInput, frames: [Partial<PadState>, number][]): AttackIntent[] {
  const out: AttackIntent[] = [];
  for (const [pad, n] of frames) for (let i = 0; i < n; i++) out.push(...input.update({ ...NEUTRAL, ...pad }, STEP));
  return out;
}
const fresh = (): AttackInput => {
  const input = new AttackInput(T.control);
  input.update(NEUTRAL, STEP);
  return input;
};
const kinds = (intents: AttackIntent[]): string[] => intents.filter((i) => i.type !== 'aim' && i.type !== 'select').map((i) => i.type);

describe('gramática de controles en ataque posicional', () => {
  it('un toque del pad pasa en esa dirección; la flecha sale desde el primer instante', () => {
    const intents = feed(fresh(), [[{ x: 1, y: 0 }, 3], [{}, 1]]);
    expect(intents[0]).toEqual({ type: 'aim', x: 1, y: 0 });
    expect(intents.at(-1)).toEqual({ type: 'pass', x: 1, y: 0 });
  });

  it('mantener y soltar también pasa (la previsualización dura lo que dura el gesto)', () => {
    const intents = feed(fresh(), [[{ x: 0, y: -1 }, 40], [{}, 1]]);
    expect(intents.filter((i) => i.type === 'aim').length).toBe(40);
    expect(kinds(intents)).toEqual(['pass']);
  });

  it('en táctil, volver al centro sin levantar el dedo cancela el pase', () => {
    const intents = feed(fresh(), [[{ x: 1, y: 0, touching: true }, 20], [{ touching: true }, 12], [{}, 2]]);
    expect(kinds(intents)).toEqual(['aimClear']);
  });

  it('en táctil, levantar el dedo justo después de recogerlo sigue pasando', () => {
    const intents = feed(fresh(), [[{ x: 1, y: 0, touching: true }, 20], [{ touching: true }, 3], [{}, 1]]);
    expect(kinds(intents)).toEqual(['pass']);
  });

  it('una diagonal de teclado se mantiene aunque una tecla se suelte un poco antes', () => {
    const d = Math.SQRT1_2;
    const intents = feed(fresh(), [[{ x: d, y: d }, 10], [{ x: 0, y: 1 }, 2], [{}, 1]]);
    const pass = intents.find((i) => i.type === 'pass');
    expect(pass).toMatchObject({ x: expect.closeTo(d, 3), y: expect.closeTo(d, 3) });
  });

  it('el pulgar que se recoge al soltar no cambia la dirección', () => {
    const intents = feed(fresh(), [[{ x: 0, y: -1, touching: true }, 4], [{ x: 0.3, y: -0.25, touching: true }, 2], [{}, 1]]);
    expect(intents.find((i) => i.type === 'pass')).toEqual({ type: 'pass', x: 0, y: -1 });
  });

  it('HABILIDAD + dirección elige compañero para la entrada y nunca pasa', () => {
    const intents = feed(fresh(), [[{ skill: true }, 2], [{ skill: true, x: 1, y: 0 }, 10], [{ skill: true }, 1], [{}, 2]]);
    expect(intents.some((i) => i.type === 'select')).toBe(true);
    expect(kinds(intents)).toEqual(['selectClear', 'order']);
    expect(intents.find((i) => i.type === 'order')).toEqual({ type: 'order', x: 1, y: 0 });
  });

  it('soltar HABILIDAD antes que el pad ordena la entrada y no deja un pase colgado', () => {
    const intents = feed(fresh(), [[{ skill: true, x: 0, y: 1 }, 2], [{ skill: true, x: 0, y: 1 }, 8], [{ x: 0, y: 1 }, 5], [{}, 3]]);
    expect(kinds(intents)).toEqual(['selectClear', 'order']);
  });

  it('un toque corto de HABILIDAD sin dirección es la acción del poseedor; uno largo, nada', () => {
    expect(kinds(feed(fresh(), [[{ skill: true }, 6], [{}, 1]]))).toEqual(['skill']);
    expect(kinds(feed(fresh(), [[{ skill: true }, 30], [{}, 1]]))).toEqual([]);
  });

  it('justo después de soltar HABILIDAD el pad no pasa hasta volver al centro', () => {
    const intents = feed(fresh(), [[{ skill: true }, 6], [{ x: 1, y: 0 }, 6], [{}, 2]]);
    expect(kinds(intents)).toEqual(['skill']);
  });

  it('con TIRO pulsado el pad apunta el tiro: ni pases ni entradas', () => {
    const intents = feed(fresh(), [[{ shot: true }, 3], [{ shot: true, x: 0, y: -1 }, 20], [{ x: 0, y: -1 }, 3], [{}, 2]]);
    expect(kinds(intents)).toEqual(['shotStart', 'shotRelease']);
  });

  it('pulsar TIRO a mitad de una previsualización la cancela', () => {
    const intents = feed(fresh(), [[{ x: 1, y: 0 }, 10], [{ x: 1, y: 0, shot: true }, 2], [{}, 2]]);
    expect(kinds(intents)).toEqual(['aimClear', 'shotStart', 'shotRelease']);
  });
});

// ---------------------------------------------------------------------------------------------
// Formation
// ---------------------------------------------------------------------------------------------

describe('puestos y formación 3-3', () => {
  it('cada uno a su puesto; el zurdo, al lado derecho del ataque', () => {
    const boya = makePlayer('center');
    const leftie = makePlayer('driver', {}, 'left');
    const righty = makePlayer('driver');
    const wings = [makePlayer('wing'), makePlayer('wing')];
    const point = makePlayer('point');
    const slots = assignSlots([righty, wings[0]!, point, leftie, boya, wings[1]!], ['boya', 'extremoIzq', 'extremoDer', 'lateralIzq', 'lateralDer', 'cierre']);
    expect(slots.get(boya)).toBe('boya');
    expect(slots.get(point)).toBe('cierre');
    expect(slots.get(leftie)).toBe('lateralDer');
    expect(slots.get(righty)).toBe('lateralIzq');
  });

  it('la alineación prefiere jugadores reales a provisionales y cubre los puestos', () => {
    const invented = { ...makePlayer('center'), origin: 'provisional' as const };
    const real = makePlayer('center');
    const squad = [invented, real, makePlayer('wing'), makePlayer('wing'), makePlayer('driver'), makePlayer('driver'), makePlayer('point'), makePlayer('goalkeeper')];
    const lineup = pickLineup(squad, ['boya', 'extremoIzq', 'extremoDer', 'lateralIzq', 'lateralDer', 'cierre']);
    expect(lineup.size).toBe(6);
    expect(lineup.get(real)).toBe('boya');
    expect(lineup.has(invented)).toBe(false);
    expect([...lineup.keys()].every((p) => p.position !== 'goalkeeper')).toBe(true);
  });

  it('al empezar: balón al cierre, nadie dentro de los 2 m y cada defensor por dentro de su hombre', () => {
    const drill = makeDrill();
    expect(drill.ball.holder).toBe(attacker(drill, 'cierre'));
    for (const a of drill.attackers) expect(toGoal(drill.goal, a.pos).distance).toBeGreaterThanOrEqual(2);
    for (const d of drill.defenders) {
      expect(d.mark).not.toBeNull();
      expect(toGoal(drill.goal, d.pos).distance).toBeLessThan(toGoal(drill.goal, d.mark!.pos).distance);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// The drill
// ---------------------------------------------------------------------------------------------

const types = (events: AttackEvent[]): string[] => events.map((e) => e.type);

describe('ataque posicional', () => {
  it('pase al boya con un toque → → lo recibe; TIRO → tira; el ataque termina y empieza otro', () => {
    const drill = makeDrill({ seed: 'pase-boya' });
    untilLive(drill);
    const events = [...run(drill, { x: 1 }, 4), ...run(drill, {}, 60)];
    const pass = events.find((e) => e.type === 'pass');
    expect(pass && pass.type === 'pass' ? pass.receiver : null).toBe(attacker(drill, 'boya'));
    if (!events.some((e) => e.type === 'intercept')) {
      expect(drill.ball.holder).toBe(attacker(drill, 'boya'));
      const shot = [...run(drill, { shot: true }, 3), ...run(drill, {}, 200)];
      expect(types(shot)).toContain('release');
      expect(types(shot)).toContain('attackEnd');
    }
    run(drill, {}, 400);
    expect(drill.stats.attacks).toBeGreaterThanOrEqual(2);
  });

  it('sin hacer nada se acaba el tiempo de posesión (28 s de marcador, unos 17,5 s reales)', () => {
    const drill = makeDrill({ seed: 'reloj' });
    untilLive(drill);
    const events = run(drill, {}, 60 * 19);
    const end = events.find((e) => e.type === 'attackEnd');
    // Holding the ball that long may also cost a steal; either way the attack is over in time.
    expect(end && end.type === 'attackEnd' ? end.result : null).toMatch(/clock|steal/);
  });

  it('tiro de primeras: TIRO durante el vuelo del pase sale nada más recibir', () => {
    const drill = makeDrill({ seed: 'primeras' });
    untilLive(drill);
    // Pass to the centre, then tap TIRO just before the ball arrives.
    const passing = [...run(drill, { x: 1 }, 4), ...run(drill, {}, 1)];
    const pass = passing.find((e) => e.type === 'pass');
    if (!pass || pass.type !== 'pass' || pass.intercepted) return;
    const flight = drill.ball.flight;
    const steps = flight && flight.kind === 'pass' ? Math.max(0, Math.round((flight.duration * flight.endAt - flight.t) * 60) - 8) : 0;
    const events = [...run(drill, {}, steps), ...run(drill, { shot: true }, 2), ...run(drill, {}, 60)];
    const catchAt = events.findIndex((e) => e.type === 'catch');
    const releaseAt = events.findIndex((e) => e.type === 'release');
    expect(catchAt).toBeGreaterThan(-1);
    expect(releaseAt).toBeGreaterThan(catchAt);
    // Same step: nothing else happened between the catch and the shot.
    expect(events.slice(catchAt + 1, releaseAt).every((e) => e.type === 'chargeStart' || e.type === 'driveEnd')).toBe(true);
  });

  it('el riesgo del aviso es el riesgo real: la frecuencia de intercepciones coincide con lo mostrado', () => {
    let predicted = 0;
    let intercepted = 0;
    let passes = 0;
    for (let i = 0; i < 300; i++) {
      const drill = makeDrill({ seed: `honesto-${i}` });
      untilLive(drill);
      // Spread the risk: the centre's defender stands somewhere between behind and in front.
      const boya = attacker(drill, 'boya');
      const defender = drill.defenderOf(boya)!;
      const k = (i % 10) / 9;
      defender.pos = { x: boya.pos.x + 0.65 - 1.3 * k, y: boya.pos.y + (k > 0.3 && k < 0.7 ? 0.5 : 0) };
      defender.prev = { ...defender.pos };
      const events = [...run(drill, { x: 1 }, 1), ...run(drill, {}, 1)];
      const pass = events.find((e) => e.type === 'pass');
      if (!pass || pass.type !== 'pass') continue;
      passes++;
      predicted += pass.risk;
      if (pass.intercepted) intercepted++;
    }
    expect(passes).toBeGreaterThan(250);
    const sd = Math.sqrt(predicted * (1 - predicted / passes));
    expect(Math.abs(intercepted - predicted)).toBeLessThan(3 * sd + 3);
    expect(predicted / passes).toBeGreaterThan(0.15);
  });
});

describe('entradas', () => {
  const drives = (attack: Record<string, number>, defense: Record<string, number>, n = 120) => {
    let free = 0;
    let deep = true;
    for (let i = 0; i < n; i++) {
      // The point holds the ball safely meanwhile, so no steal cuts the drive short.
      const drill = makeDrill({
        seed: `entrada-${i}`,
        attack: { lateralDer: attack, cierre: { skill: 10 } },
        defense: { lateralDer: defense, cierre: { defense: 1 } },
      });
      untilLive(drill);
      const driver = attacker(drill, 'lateralDer');
      const drive = drill.orderDrive(driver);
      if (drive && toGoal(drill.goal, drive.destination).distance < 2.15) deep = false;
      const events = run(drill, {}, 60 * 4);
      if (events.some((e) => e.type === 'driveFree' && e.driver === driver)) free++;
    }
    return { rate: free / n, deep };
  };

  it('rápido y hábil contra lento: casi siempre libre; al revés, casi nunca; igualados, a veces', () => {
    const strong = drives({ speed: 9, skill: 9 }, { speed: 3, defense: 3 });
    const weak = drives({ speed: 3, skill: 3 }, { speed: 9, defense: 9 });
    const even = drives({}, {});
    expect(strong.rate).toBeGreaterThan(0.8);
    expect(weak.rate).toBeLessThan(0.1);
    expect(even.rate).toBeGreaterThan(0.3);
    expect(even.rate).toBeLessThan(0.65);
    // Nothing is guaranteed either way: even the best driver is sometimes read (no reaction delay at all).
    const best = makeDrill({ seed: 'lectura', attack: { lateralDer: { speed: 10, skill: 10 } }, defense: { lateralDer: { speed: 1, defense: 1 } } });
    const driver = attacker(best, 'lateralDer');
    const rng = new Rng('lecturas');
    const reactions = Array.from({ length: 400 }, () => rollReaction(driver, best.defenderOf(driver)!, false, rng, T.entrada));
    expect(reactions.some((r) => r === 0)).toBe(true);
    // The 2-metre rule: drives end outside the 2 m line.
    expect(strong.deep && weak.deep).toBe(true);
  });

  it('HABILIDAD + dirección hacia el lateral derecho lanza su entrada, con ¡LIBRE! o vuelta a su sitio', () => {
    // A holder who does not lose the ball while we watch the drive.
    const drill = makeDrill({ seed: 'orden', attack: { cierre: { skill: 10 } }, defense: { cierre: { defense: 1 } } });
    untilLive(drill);
    const driver = attacker(drill, 'lateralDer');
    // From the point, down on screen is the right flat.
    const events = [...run(drill, { skill: true }, 1), ...run(drill, { skill: true, y: 1 }, 6), ...run(drill, {}, 60 * 4)];
    const start = events.find((e) => e.type === 'driveStart');
    expect(start && start.type === 'driveStart' ? start.driver : null).toBe(driver);
    expect(types(events)).toContain('driveEnd');
    expect(types(events)).not.toContain('pass');
    expect(drill.drives.size).toBe(0);
  });

  it('el pase a un compañero libre en plena entrada es adelantado y le llega en carrera', () => {
    let delivered = 0;
    let tries = 0;
    for (let i = 0; i < 40 && delivered < 3; i++) {
      const drill = makeDrill({ seed: `adelantado-${i}`, attack: { lateralDer: { speed: 9, skill: 9 } }, defense: { lateralDer: { speed: 2, defense: 2 } } });
      untilLive(drill);
      const driver = attacker(drill, 'lateralDer');
      drill.orderDrive(driver);
      let free = false;
      for (let s = 0; s < 60 * 3 && !free; s++) free = drill.step(NEUTRAL).some((e) => e.type === 'driveFree');
      if (!free || !drill.drives.has(driver)) continue;
      tries++;
      const toDriver = { x: driver.pos.x - drill.ball.pos.x, y: (driver.pos.y - drill.ball.pos.y) * 0.82 };
      const l = Math.hypot(toDriver.x, toDriver.y);
      const events = [...run(drill, { x: toDriver.x / l, y: toDriver.y / l }, 2), ...run(drill, {}, 90)];
      const pass = events.find((e) => e.type === 'pass');
      if (pass?.type === 'pass' && pass.receiver === driver && pass.passType === 'lead' && events.some((e) => e.type === 'catch' && e.by === driver)) delivered++;
    }
    expect(tries).toBeGreaterThan(0);
    expect(delivered).toBeGreaterThan(0);
  });
});

describe('boya', () => {
  const meanPost = (attack: Record<string, number>, defense: Record<string, number>): number => {
    let sum = 0;
    let n = 0;
    for (let i = 0; i < 12; i++) {
      const drill = makeDrill({ seed: `boya-${i}`, attack: { boya: attack }, defense: { boya: defense } });
      untilLive(drill);
      for (let s = 0; s < 60 * 12; s++) {
        drill.step(NEUTRAL);
        if (drill.phase !== 'live') break;
        if (s > 120) {
          sum += drill.post;
          n++;
        }
      }
    }
    return sum / n;
  };

  it('un boya fuerte gana la posición con el tiempo; uno flojo la pierde', () => {
    expect(meanPost({ skill: 9 }, { defense: 3, aggression: 3 })).toBeGreaterThan(0.2);
    expect(meanPost({ skill: 2 }, { defense: 9, aggression: 9 })).toBeLessThan(-0.2);
  });

  it('su defensor se coloca detrás si el boya gana la posición y delante si la pierde', () => {
    const drill = makeDrill({ seed: 'colocacion' });
    untilLive(drill);
    const boya = attacker(drill, 'boya');
    const defender = drill.defenderOf(boya)!;
    const settle = (post: number): number => {
      for (let i = 0; i < 90; i++) {
        drill.post = post;
        drill.step(NEUTRAL);
      }
      return toGoal(drill.goal, defender.pos).distance - toGoal(drill.goal, boya.pos).distance;
    };
    // Negative: closer to the goal than the centre (behind him). Positive: in front, towards the ball.
    expect(settle(1)).toBeLessThan(-0.3);
    expect(settle(-1)).toBeGreaterThan(0.3);
  });

  it('HABILIDAD + dirección hacia el boya es lucha por la posición, no una entrada', () => {
    const drill = makeDrill({ seed: 'lucha', attack: { boya: { skill: 10 } }, defense: { boya: { defense: 1, aggression: 1 } } });
    untilLive(drill);
    const events = [...run(drill, { skill: true }, 1), ...run(drill, { skill: true, x: 1 }, 5), ...run(drill, {}, 70)];
    expect(types(events)).not.toContain('driveStart');
    const fight = events.find((e) => e.type === 'postFight');
    expect(fight).toBeDefined();
    expect(drill.fightChance(attacker(drill, 'boya'), drill.defenderOf(attacker(drill, 'boya')))).toBeGreaterThan(0.75);
  });
});

describe('defensa y escapada', () => {
  it('HABILIDAD con el balón y sin dirección: escapada que gana metro y medio de agua', () => {
    const drill = makeDrill({ seed: 'escapada' });
    untilLive(drill);
    const holder = attacker(drill, 'cierre');
    const defender = drill.defenderOf(holder)!;
    const before = Math.hypot(holder.pos.x - defender.pos.x, holder.pos.y - defender.pos.y);
    const events = [...run(drill, { skill: true }, 3), ...run(drill, {}, 30)];
    expect(types(events)).toContain('escape');
    const after = Math.hypot(holder.pos.x - defender.pos.x, holder.pos.y - defender.pos.y);
    expect(after).toBeGreaterThan(before + 0.5);
  });

  it('los defensores levantan el brazo cuando el poseedor se arma para tirar', () => {
    const drill = makeDrill({ seed: 'brazo' });
    untilLive(drill);
    const holder = attacker(drill, 'cierre');
    run(drill, { shot: true }, 25);
    expect(drill.defenderOf(holder)!.armUp).toBeGreaterThan(0.5);
  });

  it('cien ataques con un jugador al azar: siempre terminan, sin estados imposibles', () => {
    const drill = makeDrill({ seed: 'azar', style: 'zone' });
    let rnd = 1;
    const random = (): number => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
    const results = new Map<string, number>();
    const pads: Partial<PadState>[] = [{ x: 1 }, { y: 1 }, { y: -1 }, { x: 0.7, y: 0.7 }, { x: 0.7, y: -0.7 }, { x: -1 }];
    let steps = 0;
    while (drill.stats.attacks < 100 && steps < 60 * 60 * 40) {
      const roll = random();
      const pad = pads[Math.floor(random() * pads.length)]!;
      const sequence: [Partial<PadState>, number][] =
        roll < 0.45 ? [[pad, 3], [{}, 20]] : roll < 0.6 ? [[{ skill: true }, 1], [{ skill: true, ...pad }, 5], [{}, 30]] : roll < 0.75 ? [[{ shot: true, ...pad }, 30 + Math.floor(random() * 40)], [{}, 60]] : [[{}, 40]];
      for (const [input, n] of sequence) {
        for (const e of run(drill, input, n)) if (e.type === 'attackEnd') results.set(e.result, (results.get(e.result) ?? 0) + 1);
        steps += n;
      }
      for (const s of drill.all) {
        expect(Number.isFinite(s.pos.x) && Number.isFinite(s.pos.y)).toBe(true);
        expect(s.pos.x).toBeGreaterThanOrEqual(0);
        expect(s.pos.x).toBeLessThanOrEqual(25.5);
      }
      expect(Number.isFinite(drill.ball.pos.x + drill.ball.pos.y + drill.ball.pos.z)).toBe(true);
    }
    expect(drill.stats.attacks).toBeGreaterThanOrEqual(100);
    expect(drill.stats.goals).toBeLessThanOrEqual(drill.stats.shots);
    const ended = [...results.values()].reduce((a, b) => a + b, 0);
    expect(ended).toBeGreaterThanOrEqual(98);
    expect(results.get('goal') ?? 0).toBeGreaterThan(0);
  });
});

// Used above so the import is not reported as unused when the drive test changes.
void insidePoint;
const _slot: Slot = 'boya';
void _slot;
