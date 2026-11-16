import { describe, expect, it } from 'vitest';
import tuning from '../../data/tuning.json';
import { applyRulesOverride } from '../../src/data/load';
import { toRivalTeam } from '../../src/data/model';
import { RulesSchema } from '../../src/data/schema';
import { defaultSave, memoryStore, parseSave, SaveStore } from '../../src/persist/storage';
import { QualityManager } from '../../src/render/quality';
import rulesJson from '../../data/reglas.json';
import { generateRoster } from '../../tools/rivales/generar';

describe('partida guardada', () => {
  it('sin nada guardado arranca con los valores por defecto', () => {
    expect(parseSave(null)).toEqual(defaultSave());
    expect(defaultSave().settings).toMatchObject({ quality: 'auto', padMode: 'flotante', swapSides: false });
  });

  it('un guardado corrupto no rompe nada', () => {
    expect(parseSave('{esto no es json')).toEqual(defaultSave());
    expect(parseSave('42')).toEqual(defaultSave());
  });

  it('conserva los ajustes válidos y repara solo los que están mal', () => {
    const save = parseSave(JSON.stringify({ version: 1, settings: { quality: 'baja', controlScale: 99, swapSides: true } }));
    expect(save.settings.quality).toBe('baja');
    expect(save.settings.swapSides).toBe(true);
    expect(save.settings.controlScale).toBe(1);
  });

  it('guarda los cambios y avisa a quien escucha', () => {
    const store = memoryStore();
    const first = new SaveStore(store);
    const seen: string[] = [];
    first.subscribe((data) => seen.push(data.settings.quality));
    first.setSetting('quality', 'media');
    expect(seen).toEqual(['media']);
    expect(new SaveStore(store).settings.quality).toBe('media');
    first.reset();
    expect(new SaveStore(store).settings.quality).toBe('auto');
  });
});

describe('calidad adaptativa', () => {
  const make = (): QualityManager => new QualityManager(tuning.calidad);

  it('baja sola de nivel si los fps caen de forma sostenida', () => {
    const quality = make();
    const changes: string[] = [];
    quality.onChange((level) => changes.push(level));
    for (let i = 0; i < 60 * 2; i++) quality.sample(16.7);
    expect(quality.level).toBe('alta');
    // ~30 fps for six seconds.
    for (let i = 0; i < 30 * 6; i++) quality.sample(33);
    expect(changes[0]).toBe('media');
    for (let i = 0; i < 30 * 12; i++) quality.sample(33);
    expect(quality.level).toBe('baja');
  });

  it('un tirón aislado no cambia la calidad y nunca vuelve a subir sola', () => {
    const quality = make();
    for (let i = 0; i < 600; i++) quality.sample(i % 100 === 0 ? 80 : 16.7);
    expect(quality.level).toBe('alta');
    quality.setChoice('baja');
    for (let i = 0; i < 600; i++) quality.sample(8);
    expect(quality.level).toBe('baja');
  });

  it('con un nivel fijado a mano no se mueve', () => {
    const quality = make();
    quality.setChoice('alta');
    for (let i = 0; i < 30 * 20; i++) quality.sample(40);
    expect(quality.level).toBe('alta');
    expect(quality.profile.maxDensity).toBe(2);
  });
});

describe('datos en el juego', () => {
  it('la pestaña Ajustes sobrescribe solo sus valores de reglas.json', () => {
    const base = RulesSchema.parse(rulesJson);
    const rules = applyRulesOverride(base, { segundosRealesPeriodo: 120, posesionPrimera: 30, modoTarjetas: 'reglamento' });
    expect(rules.velocidadRelojes.partido).toBe((base.partido.minutosMarcador * 60) / 120);
    expect(rules.posesion.primera).toBe(30);
    expect(rules.posesion.segunda).toBe(base.posesion.segunda);
    expect(rules.modoTarjetas).toBe('reglamento');
    expect(base.posesion.primera).toBe(28);
  });

  it('un rival real sustituye al generado con su mismo dorsal y hereda lo que se deja vacío', () => {
    const roster = generateRoster({ id: 'sestao', nivel: 5, estilo: 'equilibrado' });
    const generated = roster.jugadores.find((p) => p.dorsal === 7);
    const team = toRivalTeam(
      {
        id: 'sestao',
        nombre: 'Sestao',
        siglas: 'SES',
        nivel: 5,
        estilo: 'equilibrado',
        enCopa: true,
        consejosEmilio: [],
        jugadoresReales: [{ dorsal: 7, mote: 'Cañón', stats: { potencia: 10 } }],
        origen: 'real',
      },
      roster,
    );
    const seven = team.players.find((p) => p.number === 7);
    expect(team.players).toHaveLength(13);
    expect(seven).toMatchObject({ nickname: 'Cañón', origin: 'real' });
    expect(seven?.stats.power).toBe(10);
    expect(seven?.stats.speed).toBe(generated?.stats.velocidad);
    expect(team.style).toBe('balanced');
  });
});
