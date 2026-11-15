import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CupSchema,
  DataStatusSchema,
  OurTeamSchema,
  RefereeSchema,
  RivalTeamSchema,
  RosterSchema,
} from '../../src/data/schema';
import { convertWorkbook } from '../../tools/datos/convertir';
import { deduceArchetype, mergeData, spreadIndices } from '../../tools/datos/fusionar';
import { formatWarning } from '../../tools/datos/informe';
import { loadProvisionalPack, loadRules, runPipeline } from '../../tools/datos/pipeline';
import { cellNumber, leadingInt, normalize, slugify } from '../../tools/datos/texto';
import { dorsalOfFile, ImageIndex } from '../../tools/imagenes/indice';
import {
  playersSheet,
  REFEREE_HEADER,
  removeProject,
  sheet,
  TEAM_HEADER,
  tempProject,
  touchImage,
  writeWorkbook,
} from './hoja';

const roots: string[] = [];
function project(): string {
  const root = tempProject();
  roots.push(root);
  return root;
}
afterEach(() => {
  while (roots.length > 0) removeProject(roots.pop() as string);
});

/** Converts + merges in memory against the real provisional pack. */
function merge(sheets: Parameters<typeof convertWorkbook>[0], root = project()) {
  const converted = convertWorkbook(sheets);
  return mergeData(converted, loadProvisionalPack(root), loadRules(root), new ImageIndex(path.join(root, 'assets')));
}

const warningsOf = (sheets: Parameters<typeof convertWorkbook>[0]): string[] =>
  convertWorkbook(sheets).warnings.map(formatWarning);

describe('texto', () => {
  it('normaliza tildes, mayúsculas y signos', () => {
    expect(normalize('  Precisión ')).toBe('precision');
    expect(normalize('Emilio: ¡cambio!')).toBe('emilio cambio');
    expect(normalize('Señalar al banquillo')).toBe('senalar al banquillo');
    expect(slugify('CN Ejemplo Ñ')).toBe('cn-ejemplo-n');
  });

  it('lee números como número o como texto', () => {
    expect(cellNumber(7)).toBe(7);
    expect(cellNumber('7')).toBe(7);
    expect(cellNumber('7,5')).toBe(7.5);
    expect(cellNumber('siete')).toBeNull();
    expect(cellNumber('')).toBeNull();
  });

  it('toma el número inicial del sesgo', () => {
    expect(leadingInt('+3 Muy en contra')).toBe(3);
    expect(leadingInt('-2 A favor')).toBe(-2);
    expect(leadingInt('0 Neutro')).toBe(0);
    expect(leadingInt('Neutro')).toBeNull();
  });
});

describe('conversor: lectura tolerante', () => {
  it('sin hoja no hay datos ni avisos', () => {
    const converted = convertWorkbook(null);
    expect(converted.players).toEqual([]);
    expect(converted.teams).toEqual([]);
    expect(converted.referees).toEqual([]);
    expect(converted.warnings).toEqual([]);
  });

  it('una hoja vacía (solo cabeceras) no da datos ni avisos', () => {
    const converted = convertWorkbook([playersSheet([]), sheet('Equipos', TEAM_HEADER, [])]);
    expect(converted.players).toEqual([]);
    expect(converted.warnings).toEqual([]);
  });

  it('encuentra las columnas por nombre, sin importar orden, tildes ni mayúsculas', () => {
    const converted = convertWorkbook([
      {
        name: 'JUGADORES',
        rows: [
          ['precision', 'MOTE', 'Columna rara', 'dorsal', 'PUESTO'],
          [9, 'Pepe', 'x', '7', 'lateral'],
        ],
      },
    ]);
    expect(converted.warnings).toEqual([]);
    expect(converted.players).toHaveLength(1);
    expect(converted.players[0]).toMatchObject({ dorsal: 7, mote: 'Pepe', puesto: 'lateral', stats: { precision: 9 } });
  });

  it('ignora filas vacías aunque la columna Fotos tenga la fórmula', () => {
    const converted = convertWorkbook([
      playersSheet([{ Dorsal: 1, Mote: 'Uno' }, { Fotos: '' }, { Fotos: 'Empiezan por' }, { Dorsal: 2, Mote: 'Dos' }]),
    ]);
    expect(converted.players.map((p) => p.dorsal)).toEqual([1, 2]);
    expect(converted.warnings).toEqual([]);
  });

  it('acepta barras como número o como texto y deja las vacías sin valor', () => {
    const [player] = convertWorkbook([playersSheet([{ Dorsal: 3, Velocidad: 8, Potencia: '9' }])]).players;
    expect(player?.stats).toEqual({ velocidad: 8, potencia: 9 });
  });
});

describe('conversor: valores erróneos', () => {
  it('explica el error señalando pestaña, fila y columna, y usa el valor por defecto', () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({ Dorsal: i + 1, Velocidad: i === 5 ? 12 : 6 }));
    const sheets = [playersSheet(rows)];
    // The sixth data row is spreadsheet row 7 (row 1 is the header).
    expect(warningsOf(sheets)).toEqual(['Jugadores, fila 7: Velocidad = 12 no es válida; se usa 5']);
    expect(convertWorkbook(sheets).players[5]?.stats.velocidad).toBe(5);
  });

  it('avisa de texto en una barra, decimales, puesto y rasgo desconocidos', () => {
    const messages = warningsOf([
      playersSheet([
        { Dorsal: 1, Potencia: 'mucha', Pase: '7,6', Puesto: 'Delantero', Rasgo: 'Volador' },
        { Dorsal: 2, Puesto: 'Boya', Rasgo: 'Muro' },
      ]),
    ]);
    expect(messages).toEqual([
      'Jugadores, fila 2: Puesto = Delantero no es válido; se elige el puesto que más falte',
      'Jugadores, fila 2: Potencia = mucha no es válida; se usa 5',
      'Jugadores, fila 2: Pase = 7,6 no es un número entero; se usa 8',
      'Jugadores, fila 2: Rasgo = Volador no es válido; se deja sin rasgo',
      'Jugadores, fila 3: Rasgo = Muro es solo para porteros; se deja sin rasgo',
    ]);
  });

  it('descarta filas sin dorsal o con dorsal repetido', () => {
    const sheets = [playersSheet([{ Mote: 'Sin dorsal' }, { Dorsal: 4 }, { Dorsal: 4, Mote: 'Repe' }, { Dorsal: 150 }])];
    expect(convertWorkbook(sheets).players.map((p) => p.dorsal)).toEqual([4]);
    expect(warningsOf(sheets)).toEqual([
      'Jugadores, fila 2: falta el Dorsal; la fila se ignora',
      'Jugadores, fila 4: el dorsal 4 ya está en la fila 3; esta fila se ignora',
      'Jugadores, fila 5: Dorsal = 150 no es válido (1 a 99); la fila se ignora',
    ]);
  });

  it('lee el sesgo del árbitro como texto y corrige los imposibles', () => {
    const sheets = [
      sheet('Árbitros', REFEREE_HEADER, [
        { ID: 'pitos', 'Nombre o apodo': 'Pitos', Sesgo: '+3 Muy en contra', Exclusiones: 9 },
        { ID: 'El Otro', Sesgo: '8 Exagerado' },
      ]),
    ];
    const converted = convertWorkbook(sheets);
    expect(converted.referees).toMatchObject([
      { id: 'pitos', sesgo: 3, exclusiones: 9 },
      { id: 'el-otro', sesgo: 0 },
    ]);
    expect(converted.warnings.map(formatWarning)).toEqual([
      'Árbitros, fila 3: ID = El Otro se usa como "el-otro" (minúsculas, sin espacios ni tildes)',
      'Árbitros, fila 3: Sesgo = 8 Exagerado no es válido (de -3 a +3); se usa 0',
    ]);
  });

  it('avisa de la privacidad si la columna Nombre tiene valores', () => {
    expect(convertWorkbook([playersSheet([{ Dorsal: 1, Nombre: 'Nombre Real' }])]).privacy).toHaveLength(1);
    expect(convertWorkbook([playersSheet([{ Dorsal: 1 }])]).privacy).toHaveLength(0);
  });

  it('lee los ajustes y descarta los valores imposibles', () => {
    const converted = convertWorkbook([
      {
        name: 'Ajustes',
        rows: [
          ['Ajuste', 'Valor', 'Si lo dejas vacío'],
          ['Nombre del club', 'Mi Club', ''],
          ['Siglas del club (3 letras)', 'mc', ''],
          ['Suplentes en la convocatoria', 4, ''],
          ['Duración real de cada periodo (segundos)', '120', ''],
          ['Tiempo de posesión (segundos)', 'mucho', ''],
          ['Tarjetas', 'Reglamento', ''],
          ['Segunda posesión (segundos)', '', '18'],
        ],
      },
    ]);
    expect(converted.settings).toMatchObject({
      nombreClub: 'Mi Club',
      siglasClub: 'MC',
      reglas: { suplentes: 4, segundosRealesPeriodo: 120, modoTarjetas: 'reglamento' },
    });
    expect(converted.settings.reglas.posesionPrimera).toBeUndefined();
    expect(converted.warnings.map(formatWarning)).toEqual([
      'Ajustes, fila 3: Siglas del club (3 letras) = mc no tiene 3 letras; se usa "MC"',
      'Ajustes, fila 6: Tiempo de posesión (segundos) = mucho no es válido; se deja el valor por defecto',
    ]);
  });
});

describe('fusión con los datos provisionales', () => {
  it('sin hoja el juego está completo con datos provisionales', () => {
    const merged = merge(null);
    expect(merged.team.jugadores).toHaveLength(13);
    expect(merged.team.jugadores.every((p) => p.origen === 'provisional')).toBe(true);
    expect(merged.team.jugadores.filter((p) => p.puesto === 'portero')).toHaveLength(2);
    expect(merged.team.nombre).toBe('Waterpolo Iruña 98 02');
    expect(merged.team.siglas).toBe('IRU');
    expect(merged.teams).toHaveLength(10);
    expect(merged.cup.participantes).toHaveLength(8);
    expect(merged.cup.participantes[0]).toBe('nuestro');
    expect(merged.referees).toHaveLength(4);
    expect(merged.warnings).toEqual([]);
  });

  it('cada jugador real retira a un provisional', () => {
    const merged = merge([playersSheet([{ Dorsal: 7, Mote: 'Pepe', Puesto: 'Lateral', Mano: 'Zurdo', Potencia: 9 }])]);
    const reals = merged.team.jugadores.filter((p) => p.origen === 'real');
    expect(reals).toHaveLength(1);
    expect(reals[0]).toMatchObject({ id: 'nuestro-07', dorsal: 7, mote: 'Pepe', mano: 'zurdo', arquetipo: 'lanzador' });
    expect(reals[0]?.stats).toMatchObject({ potencia: 9, velocidad: 5 });
    expect(reals[0]?.barrasVacias).toBe(7);
    // 1 real field player + 10 provisional field players + 2 provisional keepers.
    expect(merged.team.jugadores).toHaveLength(13);
    expect(new Set(merged.team.jugadores.map((p) => p.dorsal)).size).toBe(13);
  });

  it('con plantilla de sobra solo se añade lo que falta (un segundo portero)', () => {
    const rows = [
      { Dorsal: 1, Mote: 'Larry', Puesto: 'Portero' },
      ...Array.from({ length: 18 }, (_, i) => ({ Dorsal: i + 2, Puesto: ['Boya', 'Extremo', 'Lateral', 'Cierre'][i % 4] as string })),
    ];
    const merged = merge([playersSheet(rows)]);
    const provisional = merged.team.jugadores.filter((p) => p.origen === 'provisional');
    expect(merged.team.jugadores).toHaveLength(20);
    expect(provisional).toHaveLength(1);
    expect(provisional[0]?.puesto).toBe('portero');
    // Dorsals 1–19 are taken: the provisional keeper gets the first free one.
    expect(provisional[0]?.dorsal).toBe(20);
    expect(merged.playersWithoutBars).toHaveLength(19);
  });

  it('una fila desactivada desaparece y su hueco vuelve a ser provisional', () => {
    const merged = merge([
      playersSheet([
        { Dorsal: 7, Mote: 'Pepe', Puesto: 'Lateral' },
        { Activo: 'No', Dorsal: 8, Mote: 'Fuera', Puesto: 'Boya' },
      ]),
    ]);
    expect(merged.team.jugadores.some((p) => p.mote === 'Fuera')).toBe(false);
    expect(merged.team.jugadores.filter((p) => p.origen === 'real')).toHaveLength(1);
    expect(merged.team.jugadores).toHaveLength(13);
  });

  it('un puesto vacío toma el que más falta en la plantilla', () => {
    const rows: Record<string, string | number>[] = [
      { Dorsal: 1, Puesto: 'Portero' },
      { Dorsal: 2, Puesto: 'Portero' },
      { Dorsal: 3, Puesto: 'Boya' },
      { Dorsal: 4, Puesto: 'Boya' },
      { Dorsal: 5, Puesto: 'Extremo' },
      { Dorsal: 6, Puesto: 'Extremo' },
      { Dorsal: 7, Puesto: 'Extremo' },
      { Dorsal: 8, Puesto: 'Lateral' },
      { Dorsal: 9, Puesto: 'Lateral' },
      { Dorsal: 10, Puesto: 'Lateral' },
      { Dorsal: 11 },
    ];
    const merged = merge([playersSheet(rows)]);
    expect(merged.team.jugadores.find((p) => p.dorsal === 11)?.puesto).toBe('cierre');
  });

  it('los equipos reales entran en la Copa y los provisionales completan hasta 7', () => {
    const merged = merge([
      sheet('Equipos', TEAM_HEADER, [
        { ID: 'sestao', Nombre: 'Sestao', Siglas: 'SES', Nivel: 7, Estilo: 'Físico', 'En la Copa': 'Sí' },
        { ID: 'urbat', Nombre: 'Urbat', Nivel: 6, 'En la Copa': 'No' },
        { Activo: 'No', ID: 'fuera', Nombre: 'Desactivado' },
      ]),
    ]);
    expect(merged.teams.filter((t) => t.origen === 'real').map((t) => t.id)).toEqual(['sestao', 'urbat']);
    expect(merged.teams.find((t) => t.id === 'sestao')).toMatchObject({ estilo: 'fisico', nivel: 7, enCopa: true });
    expect(merged.teams.find((t) => t.id === 'urbat')).toMatchObject({ siglas: 'URB', estilo: 'equilibrado', enCopa: false });
    expect(merged.cup.participantes).toHaveLength(8);
    expect(merged.cup.participantes).toContain('sestao');
    expect(merged.cup.participantes).not.toContain('urbat');
    // Fewer than 7 real teams: every provisional team stays available for friendlies.
    expect(merged.teams.filter((t) => t.origen === 'provisional')).toHaveLength(10);
    expect(merged.missingImages.filter((m) => m.tipo === 'Escudo').map((m) => m.esperado)).toEqual([
      'assets/escudos/sestao.png',
      'assets/escudos/urbat.png',
    ]);
  });

  it('con más de 7 equipos en la Copa entran los 7 primeros y no hay provisionales', () => {
    const rows = Array.from({ length: 9 }, (_, i) => ({ ID: `club-${i + 1}`, Nombre: `Club ${i + 1}`, Nivel: 5 }));
    const merged = merge([sheet('Equipos', TEAM_HEADER, rows)]);
    expect(merged.teams).toHaveLength(9);
    expect(merged.teams.every((t) => t.origen === 'real')).toBe(true);
    expect(merged.cup.participantes).toEqual(['nuestro', ...rows.slice(0, 7).map((r) => r.ID)]);
    expect(merged.warnings.map(formatWarning)).toEqual([
      'Equipos: hay 9 equipos con En la Copa = Sí y caben 7; entran los 7 primeros',
    ]);
  });

  it('con árbitros propios no se usan los provisionales', () => {
    const merged = merge([sheet('Árbitros', REFEREE_HEADER, [{ ID: 'pitos', 'Nombre o apodo': 'Pitos' }])]);
    expect(merged.referees).toMatchObject([{ id: 'pitos', nombre: 'Pitos', toleranciaContacto: 5, sesgo: 0, origen: 'real' }]);
  });

  it('asocia los rivales reales a su equipo e ignora los de equipos inexistentes', () => {
    const header = ['Activo', 'ID del equipo', 'Dorsal', 'Mote', 'Puesto', 'Potencia'];
    const merged = merge([
      sheet('Equipos', TEAM_HEADER, [{ ID: 'sestao', Nombre: 'Sestao' }]),
      sheet('Rivales reales', header, [
        { 'ID del equipo': 'sestao', Dorsal: 7, Mote: 'Cañón', Potencia: 10 },
        { 'ID del equipo': 'nadie', Dorsal: 3 },
      ]),
    ]);
    expect(merged.teams.find((t) => t.id === 'sestao')?.jugadoresReales).toEqual([
      { dorsal: 7, mote: 'Cañón', stats: { potencia: 10 } },
    ]);
    expect(merged.warnings.map(formatWarning)).toEqual([
      'Rivales reales, fila 3: no hay ningún equipo activo con ID = nadie; la fila se ignora',
    ]);
  });

  it('reparte los provisionales de la Copa por todo el rango de niveles', () => {
    expect(spreadIndices(10, 7)).toEqual([0, 2, 3, 5, 6, 8, 9]);
    expect(spreadIndices(10, 0)).toEqual([]);
    expect(spreadIndices(10, 1)).toEqual([5]);
    expect(spreadIndices(3, 7)).toEqual([0, 1, 2]);
  });

  it('deduce el arquetipo del puesto y de la mejor barra', () => {
    const flat = { velocidad: 5, resistencia: 5, potencia: 5, precision: 5, pase: 5, habilidad: 5, defensa: 5, agresividad: 5 };
    expect(deduceArchetype('portero', flat)).toBe('portero');
    expect(deduceArchetype('cierre', flat)).toBe('organizador');
    expect(deduceArchetype('lateral', { ...flat, velocidad: 9 })).toBe('velocista');
    expect(deduceArchetype('cierre', { ...flat, defensa: 9 })).toBe('defensor');
  });
});

describe('imágenes por convención', () => {
  it('saca el dorsal del principio del nombre', () => {
    expect(dorsalOfFile('01-Larry.png')).toBe(1);
    expect(dorsalOfFile('1 larry celebrando.JPG')).toBe(1);
    expect(dorsalOfFile('07_pepe_gol.webp')).toBe(7);
    expect(dorsalOfFile('19.png')).toBe(19);
    expect(dorsalOfFile('100.png')).toBeNull();
    expect(dorsalOfFile('00-Emilio.png')).toBeNull();
    expect(dorsalOfFile('larry.png')).toBeNull();
  });

  it('asigna una o dos fotos por dorsal, avisa de las que sobran y de las que faltan', () => {
    const root = project();
    for (const name of ['07-Pepe_1.png', '07-Pepe.png', '07-Pepe_2.JPG', '09-Nadie.png', 'suelta.png']) {
      touchImage(path.join(root, 'assets', 'jugadores', name));
    }
    touchImage(path.join(root, 'assets', 'escudos', 'SESTAO.PNG'));
    touchImage(path.join(root, 'assets', 'escudos', 'otro.png'));
    const merged = merge(
      [
        playersSheet([{ Dorsal: 7, Mote: 'Pepe' }, { Dorsal: 8, Mote: 'Sin foto' }]),
        sheet('Equipos', TEAM_HEADER, [{ ID: 'sestao', Nombre: 'Sestao' }]),
      ],
      root,
    );
    const pepe = merged.team.jugadores.find((p) => p.dorsal === 7);
    expect(pepe?.fotos).toEqual(['jugador-07-a', 'jugador-07-b']);
    // Main photo first: names are compared without their extension.
    expect(merged.imageJobs.filter((j) => j.key.startsWith('jugador-07')).map((j) => path.basename(j.source))).toEqual([
      '07-Pepe.png',
      '07-Pepe_1.png',
    ]);
    expect(merged.teams.find((t) => t.id === 'sestao')?.escudo).toBe('escudo-sestao');
    expect(merged.missingImages.map((m) => m.de)).toContain('Nº 8 Sin foto');
    expect(merged.extraImages.map((e) => e.archivo).sort()).toEqual([
      'assets/escudos/otro.png',
      'assets/jugadores/07-Pepe_2.JPG',
      'assets/jugadores/09-Nadie.png',
      'assets/jugadores/suelta.png',
    ]);
  });
});

describe('pipeline completo (npm run datos)', () => {
  const read = (root: string, file: string): unknown => JSON.parse(fs.readFileSync(path.join(root, 'data', file), 'utf8'));

  it('sin hoja escribe un juego completo y válido', async () => {
    const root = project();
    const result = await runPipeline({ root, images: false });
    expect(result.status.hoja).toBeNull();
    expect(OurTeamSchema.parse(read(root, 'equipo.json')).jugadores).toHaveLength(13);
    const teams = RivalTeamSchema.array().parse(read(root, 'equipos.json'));
    expect(teams).toHaveLength(10);
    expect(RefereeSchema.array().parse(read(root, 'arbitros.json'))).toHaveLength(4);
    expect(CupSchema.parse(read(root, 'copa.json')).participantes).toHaveLength(8);
    DataStatusSchema.parse(read(root, 'generado/estado.json'));
    for (const team of teams) RosterSchema.parse(read(root, `generado/rivales/${team.id}.json`));
    expect(fs.readFileSync(path.join(root, 'data', 'INFORME_DATOS.md'), 'utf8')).toContain('No hay hoja de cálculo');
  });

  it.each(['plantilla.xlsx', 'plantilla.ods'])('lee %s y nunca publica la columna Nombre', async (file) => {
    const root = project();
    writeWorkbook(path.join(root, 'datos', file), [
      playersSheet([{ Dorsal: 7, Mote: 'Pepe', Nombre: 'Apellido Secreto', Puesto: 'Lateral', Velocidad: 12 }]),
    ]);
    const result = await runPipeline({ root, images: false });
    expect(result.status.hoja).toBe(`datos/${file}`);
    expect(result.status.jugadores).toEqual({ reales: 1, provisionales: 12 });
    expect(result.report).toContain('Jugadores, fila 2: Velocidad = 12 no es válida; se usa 5');
    expect(result.status.privacidad).toHaveLength(1);
    const written = fs.readdirSync(path.join(root, 'data'), { recursive: true, withFileTypes: true });
    for (const entry of written) {
      if (!entry.isFile()) continue;
      const text = fs.readFileSync(path.join(entry.parentPath, entry.name), 'utf8');
      expect(text, entry.name).not.toContain('Apellido Secreto');
    }
  });

  it('una hoja ilegible no rompe nada: se usan los provisionales y se avisa', async () => {
    const root = project();
    fs.mkdirSync(path.join(root, 'datos'));
    fs.writeFileSync(path.join(root, 'datos', 'plantilla.xlsx'), 'esto no es una hoja de cálculo');
    const result = await runPipeline({ root, images: false });
    expect(result.merged.team.jugadores).toHaveLength(13);
  });

  it('las plantillas de rivales se congelan y solo se rehacen si se pide', async () => {
    const root = project();
    const teamsWith = (nivel: number) => [sheet('Equipos', TEAM_HEADER, [{ ID: 'sestao', Nombre: 'Sestao', Nivel: nivel }])];
    writeWorkbook(path.join(root, 'datos', 'plantilla.xlsx'), teamsWith(4));
    const first = await runPipeline({ root, images: false });
    expect(first.rosters.get('sestao')?.nivel).toBe(4);

    writeWorkbook(path.join(root, 'datos', 'plantilla.xlsx'), teamsWith(9));
    const second = await runPipeline({ root, images: false });
    expect(second.rosters.get('sestao')).toEqual(first.rosters.get('sestao'));
    expect(second.report).toContain('npm run rivales -- --regenerar sestao');

    const third = await runPipeline({ root, images: false, regenerate: ['sestao'] });
    expect(third.rosters.get('sestao')?.nivel).toBe(9);
  });
});
