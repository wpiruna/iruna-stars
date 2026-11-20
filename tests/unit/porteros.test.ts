import { describe, expect, it } from 'vitest';
import tuning from '../../data/tuning.json';
import { autoSquad, resolveSquad, squadProblems } from '../../src/app/squad';
import { Rng } from '../../src/core/rng';
import { passRisk, passSpeed } from '../../src/sim/attack/passing';
import { keeperProfile } from '../../src/sim/duel/shootout';
import type { Goal } from '../../src/sim/field';
import { estimateSave, planShot, resolveShot } from '../../src/sim/shooting/model';
import { parseSave } from '../../src/persist/storage';
import { makePlayer, makeSwimmer, makeTeam } from './escena';

const goal: Goal = { x: 25, y: 10, halfWidth: 1.5, height: 0.9, facing: 1 };
const K = tuning.portero;
const P = tuning.ataque.pase;

/** A pass from `from` to `to` against only the keeper of the right-hand goal (Salida `rushing`). */
function keeperRisk(rushing: number, from: { x: number; y: number }, to: { x: number; y: number }, trait?: 'kamikaze'): number {
  const keeper = makeSwimmer(24.65, 10, 1, {}, true);
  (keeper.player.keeperStats as { rushing: number }).rushing = rushing;
  if (trait) (keeper.player as { trait?: string }).trait = trait;
  const passer = makeSwimmer(from.x, from.y, 0);
  const receiver = makeSwimmer(to.x, to.y, 0);
  const speed = passSpeed(passer, 'wet', P);
  return passRisk(passer, { ...from, z: 0.8 }, to, 0.05, P.arco.mojado, speed, receiver, [keeper], P).total;
}

describe('porteros: Salida y rasgos (GDD §10)', () => {
  it('corta pases a su área, más con más Salida (y el Kamikaze aún más); lejos de la portería, ninguno', () => {
    const into = (r: number) => keeperRisk(r, { x: 19.5, y: 5 }, { x: 22.4, y: 9.6 });
    expect(into(10)).toBeGreaterThan(into(5));
    expect(into(5)).toBeGreaterThan(into(1));
    expect(keeperRisk(5, { x: 19.5, y: 5 }, { x: 22.4, y: 9.6 }, 'kamikaze')).toBeGreaterThan(into(5));
    expect(keeperRisk(10, { x: 10, y: 5 }, { x: 15, y: 9 })).toBe(0);
  });

  it('Salida le hace salir ante un tirador solo; el Muro llega más lejos', () => {
    const plan = planShot({ from: { x: 21.5, y: 10 }, releaseHeight: 0.9, charge: 0.78, side: 1, mode: 'direct', pressure: 0 }, { power: 6, accuracy: 7, energy: 1 }, goal, 0, new Rng('solo'), tuning.tiro);
    const normal = { reflexes: 5, positioning: 5, energy: 1 };
    const base = estimateSave(plan, normal, { u: 0 }, 'open', K);
    const out = estimateSave(plan, normal, { u: 0, rushed: 1 }, 'open', K);
    expect(out.reach).toBeCloseTo(base.reach + K.salida.alcance, 5);
    const wall = estimateSave(plan, { ...normal, trait: 'wall' }, { u: 0 }, 'open', K);
    expect(wall.reach).toBeCloseTo(base.reach * (1 + K.rasgos.muro), 5);
    // In a penalty there is no coming out.
    expect(estimateSave(plan, normal, { u: 0, rushed: 1 }, 'penalty', K).reach).toBeCloseTo(estimateSave(plan, normal, { u: 0 }, 'penalty', K).reach, 5);
  });

  it('el Inseguro, de vez en cuando, deja entrar una que tenía parada (la cantada)', () => {
    const plan = planShot({ from: { x: 18, y: 10 }, releaseHeight: 0.9, charge: 0.78, side: 0, mode: 'direct', pressure: 0 }, { power: 3, accuracy: 6, energy: 1 }, goal, 0, new Rng('flojo'), tuning.tiro);
    const rng = new Rng('cantadas');
    let saves = 0;
    let blunders = 0;
    for (let i = 0; i < 4000; i++) {
      const r = resolveShot(plan, goal, { reflexes: 9, positioning: 9, energy: 1, trait: 'shaky' }, { u: 0 }, 'open', rng, tuning.tiro, K);
      if (r.outcome.type === 'save') saves++;
      if (r.outcome.type === 'goal' && r.outcome.blunder) blunders++;
    }
    expect(saves).toBeGreaterThan(1000);
    const rate = blunders / (saves + blunders);
    expect(rate).toBeGreaterThan(K.rasgos.inseguro * 0.6);
    expect(rate).toBeLessThan(K.rasgos.inseguro * 1.5);
  });

  it('en la portería solo cuentan los rasgos de portero', () => {
    const keeper = makePlayer('goalkeeper');
    (keeper as { trait?: string }).trait = 'wall';
    expect(keeperProfile(keeper).trait).toBe('wall');
    (keeper as { trait?: string }).trait = 'missile';
    expect(keeperProfile(keeper).trait).toBeUndefined();
  });
});

describe('convocatoria (GDD §3.2)', () => {
  const team = makeTeam('nuestro');
  const hand = tuning.ataque.zona.mano;

  it('la automática tiene seis titulares, un portero y los suplentes pedidos, sin repetir a nadie', () => {
    const squad = autoSquad(team, 2, hand);
    expect(squad.starters).toHaveLength(6);
    expect(squad.keeper).not.toBeNull();
    expect(squad.bench).toHaveLength(2);
    expect(new Set([...squad.starters, ...squad.bench, squad.keeper]).size).toBe(9);
    expect(squadProblems(squad, 2)).toEqual([]);
  });

  it('una guardada con jugadores que ya no existen se completa sola y nunca repite', () => {
    const field = team.players.filter((p) => p.position !== 'goalkeeper');
    const saved = { starters: [field[0]!.id, 'borrado', field[0]!.id, field[1]!.id], keeper: 'otro-borrado', bench: [field[1]!.id, field[6]!.id] };
    const squad = resolveSquad(team, saved, 2, hand);
    expect(squad.field).toHaveLength(6);
    expect(squad.keeper.position).toBe('goalkeeper');
    expect(squad.field.slice(0, 2)).toEqual([field[0], field[1]]);
    const all = [...squad.field, ...squad.bench, squad.keeper];
    expect(new Set(all).size).toBe(all.length);
    expect(squad.bench).toContain(field[6]);
    expect(squadProblems({ starters: ['a'], keeper: null, bench: ['x', 'y', 'z'] }, 2)).toHaveLength(3);
  });

  it('se guarda (convocatoria y gorro) y una partida antigua sin ellas sigue valiendo', () => {
    const old = parseSave(JSON.stringify({ version: 1, settings: { sound: false } }));
    expect(old.squad).toBeNull();
    expect(old.settings.cap).toBe('white');
    expect(old.settings.sound).toBe(false);
    const saved = parseSave(JSON.stringify({ version: 1, settings: { cap: 'blue' }, squad: { starters: ['a'], keeper: 'k', bench: [] } }));
    expect(saved.settings.cap).toBe('blue');
    expect(saved.squad).toEqual({ starters: ['a'], keeper: 'k', bench: [] });
  });
});
