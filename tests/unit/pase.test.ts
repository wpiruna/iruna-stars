import { describe, expect, it } from 'vitest';
import { choosePass, passTypeFor, riskColor, type PassWorld } from '../../src/sim/attack/passing';
import type { Swimmer } from '../../src/sim/attack/types';
import { attacker, makeDrill, makeSwimmer, T, TILT } from './escena';

const P = T.pase;
/** Screen pad direction → world direction, as the game does it. */
const aim = (x: number, y: number) => {
  const wy = y / TILT;
  const l = Math.hypot(x, wy);
  return { x: x / l, y: wy / l };
};

/** The pass world of a full 6-against-6 set attack, with the ball in a given player's hand. */
function scene(from: Parameters<typeof attacker>[1], tweak?: (drill: ReturnType<typeof makeDrill>) => void) {
  const drill = makeDrill({ seed: 'escena' });
  tweak?.(drill);
  const holder = attacker(drill, from);
  const world: PassWorld = { ...drill.passWorld(holder), from: { x: holder.pos.x, y: holder.pos.y, z: 0.75 } };
  return { drill, world, holder };
}

describe('selector de receptor: el pad nunca pasa a quien no esperas', () => {
  it('lateral izquierdo, ↓: el cierre (más cerca y más seguro que el otro lateral)', () => {
    const { drill, world } = scene('lateralIzq');
    expect(choosePass(world, aim(0, 1), null, P).best?.receiver).toBe(attacker(drill, 'cierre'));
  });

  it('lateral izquierdo, →: su extremo', () => {
    const { drill, world } = scene('lateralIzq');
    expect(choosePass(world, aim(1, 0), null, P).best?.receiver).toBe(attacker(drill, 'extremoIzq'));
  });

  it('cierre, →: el boya; ↑: el lateral izquierdo; ↗: el extremo izquierdo', () => {
    const { drill, world } = scene('cierre');
    expect(choosePass(world, aim(1, 0), null, P).best?.receiver).toBe(attacker(drill, 'boya'));
    expect(choosePass(world, aim(0, -1), null, P).best?.receiver).toBe(attacker(drill, 'lateralIzq'));
    expect(choosePass(world, aim(Math.SQRT1_2, -Math.SQRT1_2), null, P).best?.receiver).toBe(attacker(drill, 'extremoIzq'));
    expect(choosePass(world, aim(0, 1), null, P).best?.receiver).toBe(attacker(drill, 'lateralDer'));
  });

  it('una dirección clara gana aunque el pase sea arriesgado: se avisa en rojo, no se cambia de receptor', () => {
    const { drill, world } = scene('cierre', (d) => {
      // The centre's defender fronts him, right in the lane.
      const boya = attacker(d, 'boya');
      const defender = d.defenderOf(boya) as Swimmer;
      defender.pos = { x: boya.pos.x - 0.7, y: boya.pos.y };
    });
    const choice = choosePass({ ...world, post: -1 }, aim(1, 0), null, P);
    expect(choice.best?.receiver).toBe(attacker(drill, 'boya'));
    expect(riskColor(choice.best?.risk ?? 0, P)).toBe('red');
  });

  it('sin nadie en ±50° amplía a ±90°; sin nadie en ±90° no pasa', () => {
    const { drill, world } = scene('lateralIzq');
    const widened = choosePass(world, aim(Math.SQRT1_2, -Math.SQRT1_2), null, P);
    expect(widened.cone).toBe(P.conoAmplio);
    expect(widened.best?.receiver).toBe(attacker(drill, 'extremoIzq'));
    const nobody = choosePass(world, aim(0, -1), null, P);
    expect(nobody.best).toBeNull();
  });

  it('en un empate se queda con el que ya estaba marcado (la flecha no baila)', () => {
    const holder = makeSwimmer(15, 10, 0);
    const a = makeSwimmer(20, 10 - 5 * Math.tan((10 * Math.PI) / 180), 0);
    const b = makeSwimmer(20, 10 + 5 * Math.tan((10 * Math.PI) / 180), 0);
    const world: PassWorld = {
      holder,
      from: { x: 15, y: 10, z: 0.75 },
      teammates: [a, b],
      defenders: [],
      goal: { x: 25, y: 10, halfWidth: 1.5, height: 0.9, facing: 1 },
      drives: new Map(),
      boya: null,
      post: 0,
    };
    expect(choosePass(world, { x: 1, y: 0 }, a, P).best?.receiver).toBe(a);
    expect(choosePass(world, { x: 1, y: 0 }, b, P).best?.receiver).toBe(b);
  });

  it('nunca al propio portero salvo que se apunte claramente hacia él', () => {
    const holder = makeSwimmer(10, 10, 0);
    const keeper = makeSwimmer(1, 10, 0, {}, true);
    const mate = makeSwimmer(12, 5, 0);
    const world: PassWorld = {
      holder,
      from: { x: 10, y: 10, z: 0.75 },
      teammates: [keeper, mate],
      defenders: [],
      goal: { x: 25, y: 10, halfWidth: 1.5, height: 0.9, facing: 1 },
      drives: new Map(),
      boya: null,
      post: 0,
    };
    expect(choosePass(world, { x: -1, y: 0 }, null, P).best?.receiver).toBe(keeper);
    const twenty = (20 * Math.PI) / 180;
    expect(choosePass(world, { x: -Math.cos(twenty), y: Math.sin(twenty) }, null, P).best).toBeNull();
    // Diagonally back-up the field player (within the wide cone) is preferred over the keeper.
    expect(choosePass(world, { x: 0, y: -1 }, null, P).best?.receiver).toBe(mate);
  });
});

describe('tipo de pase y riesgo', () => {
  it('al boya, mojado; a un exterior con su defensor por dentro, seco; a más de 9 m, largo (bombeado)', () => {
    const { drill, world } = scene('cierre');
    expect(passTypeFor(world, attacker(drill, 'boya'), P)).toBe('wet');
    expect(passTypeFor(world, attacker(drill, 'lateralIzq'), P)).toBe('dry');
    const far = scene('lateralIzq');
    expect(passTypeFor(far.world, attacker(far.drill, 'extremoDer'), P)).toBe('long');
  });

  it('a un compañero que entra, adelantado: el balón va a donde estará', () => {
    const { drill, world } = scene('cierre');
    const driver = attacker(drill, 'lateralDer');
    const destination = { x: 22.5, y: 11.3 };
    const drives = new Map([[driver, { destination, free: true, speed: 2 }]]);
    // Aimed roughly at the driver (screen down-right, steeper than the wing).
    const choice = choosePass({ ...world, drives }, { x: 0.35, y: 0.94 }, null, P);
    expect(choice.best?.receiver).toBe(driver);
    expect(choice.best?.type).toBe('lead');
    const point = choice.best?.point as { x: number; y: number };
    // Ahead of the driver, on the way to the destination.
    expect(Math.hypot(point.x - destination.x, point.y - destination.y)).toBeLessThan(Math.hypot(driver.pos.x - destination.x, driver.pos.y - destination.y));
  });

  it('el pase mojado cae al lado contrario de su defensor', () => {
    const { drill, world } = scene('cierre');
    const boya = attacker(drill, 'boya');
    const defender = drill.defenderOf(boya) as Swimmer;
    const choice = choosePass(world, aim(1, 0), null, P);
    const point = choice.best?.point as { x: number; y: number };
    const fromDefender = Math.hypot(point.x - defender.pos.x, point.y - defender.pos.y);
    expect(fromDefender).toBeGreaterThan(Math.hypot(boya.pos.x - defender.pos.x, boya.pos.y - defender.pos.y));
  });

  it('línea limpia: verde; con un defensor plantado en medio de un pase raso: rojo', () => {
    const { drill, world } = scene('cierre');
    const clean = choosePass(world, aim(0, -1), null, P).best;
    expect(riskColor(clean?.risk ?? 1, P)).toBe('green');
    // A defender floats in the middle of the low pass to the centre.
    const lateral = drill.defenderOf(attacker(drill, 'lateralIzq')) as Swimmer;
    lateral.pos = { x: 20.7, y: 10.1 };
    const blocked = choosePass(world, aim(1, 0), null, P).best;
    expect(blocked?.receiver).toBe(attacker(drill, 'boya'));
    expect(riskColor(blocked?.risk ?? 0, P)).toBe('red');
  });

  it('el boya bien colocado recibe con menos riesgo que el boya tapado', () => {
    const { drill, world } = scene('cierre');
    const boya = attacker(drill, 'boya');
    const defender = drill.defenderOf(boya) as Swimmer;
    defender.pos = { x: boya.pos.x + 0.62, y: boya.pos.y };
    const won = choosePass(world, aim(1, 0), null, P).best?.risk ?? 1;
    defender.pos = { x: boya.pos.x - 0.62, y: boya.pos.y };
    const fronted = choosePass(world, aim(1, 0), null, P).best?.risk ?? 0;
    expect(won).toBeLessThan(0.2);
    expect(fronted).toBeGreaterThan(won + 0.3);
  });
});
