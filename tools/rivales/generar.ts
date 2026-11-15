/**
 * Rival roster generator (GDD §15). Deterministic: the seed comes from the team ID, so the
 * same team always gets the same 13 players. Bump GENERATOR_VERSION when the algorithm changes;
 * rosters already saved in data/generado/rivales are never regenerated on their own.
 */
import { hashString, Rng } from '../../src/core/rng';
import {
  KEEPER_STAT_KEYS,
  STAT_KEYS,
  type Archetype,
  type PlayerData,
  type Position,
  type RosterData,
  type StatKey,
  type Style,
  type Trait,
} from '../../src/data/schema';

export const GENERATOR_VERSION = 1;

type Offsets = Record<StatKey, number>;
const offsets = (v: number[]): Offsets =>
  Object.fromEntries(STAT_KEYS.map((key, i) => [key, v[i] ?? 0])) as Offsets;

//                                       vel res pot pre pas hab def agr
const ARCHETYPE_PROFILE: Record<Archetype, Offsets> = {
  boya: offsets([-2, 0, 1, 0, -1, 2, 1, 2]),
  defensor: offsets([0, 1, -1, -1, 0, -1, 3, 2]),
  lanzador: offsets([0, -1, 3, 2, 0, 0, -1, -1]),
  extremo: offsets([1, 0, 0, 1, 0, 1, -1, -1]),
  organizador: offsets([0, 0, -1, 0, 3, 1, 0, -2]),
  velocista: offsets([3, 1, -1, -1, 0, 1, -1, -1]),
  todoterreno: offsets([0, 1, 0, 0, 0, 0, 0, 0]),
  portero: offsets([-1, 0, 0, 0, 1, 0, 0, -2]),
};

const STYLE_PROFILE: Record<Style, Offsets> = {
  equilibrado: offsets([0, 0, 0, 0, 0, 0, 0, 0]),
  defensivo: offsets([0, 0, -1, 0, 0, 0, 2, 0]),
  rapido: offsets([2, 1, 0, 0, 0, 0, -1, 0]),
  lanzadores: offsets([0, 0, 1, 1, 0, 0, -1, 0]),
  fisico: offsets([-1, 1, 0, 0, -1, 0, 1, 2]),
  estrellas: offsets([0, 0, 0, 0, 0, 0, 0, 0]),
};

/** The stats a star of each archetype excels at. */
const STAR_STATS: Record<Archetype, StatKey[]> = {
  boya: ['habilidad', 'potencia', 'agresividad'],
  defensor: ['defensa', 'resistencia', 'agresividad'],
  lanzador: ['potencia', 'precision', 'habilidad'],
  extremo: ['precision', 'velocidad', 'habilidad'],
  organizador: ['pase', 'habilidad', 'precision'],
  velocista: ['velocidad', 'resistencia', 'habilidad'],
  todoterreno: ['resistencia', 'defensa', 'pase'],
  portero: ['pase', 'resistencia', 'habilidad'],
};

const ARCHETYPE_TRAIT: Record<Archetype, Trait[]> = {
  boya: ['iman', 'lenador'],
  defensor: ['lenador', 'diesel'],
  lanzador: ['misil'],
  extremo: ['regateador'],
  organizador: ['cerebro'],
  velocista: ['diesel', 'regateador'],
  todoterreno: ['diesel', 'cerebro'],
  portero: ['muro', 'kamikaze'],
};

type Weighted<T> = [T, number][];
const POSITION_ARCHETYPES: Record<Exclude<Position, 'portero'>, Weighted<Archetype>> = {
  boya: [
    ['boya', 80],
    ['defensor', 20],
  ],
  extremo: [
    ['extremo', 60],
    ['velocista', 25],
    ['lanzador', 15],
  ],
  lateral: [
    ['lanzador', 40],
    ['todoterreno', 35],
    ['velocista', 25],
  ],
  cierre: [
    ['organizador', 40],
    ['defensor', 35],
    ['todoterreno', 15],
    ['lanzador', 10],
  ],
};
const STYLE_BOOST: Partial<Record<Style, Partial<Record<Archetype, number>>>> = {
  rapido: { velocista: 30 },
  lanzadores: { lanzador: 30 },
  defensivo: { defensor: 30 },
  fisico: { defensor: 20, boya: 10 },
};

const FIELD_LAYOUT: Exclude<Position, 'portero'>[] = [
  'boya',
  'boya',
  'extremo',
  'extremo',
  'extremo',
  'lateral',
  'lateral',
  'lateral',
  'cierre',
  'cierre',
  'cierre',
];

/** Generic nicknames, 8 letters at most, with no relation to real people. */
const NICKNAMES = [
  'TORO', 'LOBO', 'FLACO', 'TURBO', 'PELUCA', 'JEFE', 'PIRATA', 'VIKINGO', 'RUBIO', 'BARBAS',
  'MOSCA', 'GATO', 'OSO', 'CABRA', 'PULGA', 'TRUENO', 'ROCA', 'FOCA', 'NUTRIA', 'CAIMÁN',
  'MORSA', 'ERIZO', 'HALCÓN', 'BÚFALO', 'GALLO', 'PANTERA', 'ORCA', 'MANTA', 'CONGRIO', 'BESUGO',
  'MERLUZO', 'PERCEBE', 'CANGREJO', 'ANCHOA', 'SEPIA', 'CALAMAR', 'MEJILLÓN', 'TIZA', 'CHISPA', 'YUNQUE',
  'MAZO', 'TORNADO', 'CICLÓN', 'GEISER', 'TÉMPANO', 'CORAL', 'NUDO', 'REMO', 'TIMÓN', 'FARO',
] as const;

function clampBar(value: number): number {
  return Math.max(1, Math.min(10, Math.round(value)));
}

function weightedPick<T>(rng: Rng, options: Weighted<T>): T {
  const total = options.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rng.next() * total;
  for (const [item, weight] of options) {
    roll -= weight;
    if (roll < 0) return item;
  }
  return (options[options.length - 1] as [T, number])[0];
}

function starCount(rng: Rng, level: number, style: Style): number {
  let count: number;
  if (level <= 3) count = rng.int(0, 1);
  else if (level <= 6) count = rng.int(1, 2);
  else if (level <= 8) count = rng.int(2, 3);
  else count = rng.int(3, 4);
  if (style === 'estrellas') count += 1;
  return Math.min(count, 4);
}

export interface RosterRequest {
  id: string;
  nivel: number;
  estilo: Style;
}

export function generateRoster(team: RosterRequest): RosterData {
  const seed = hashString(`rival:${team.id}`);
  const rng = new Rng(seed);
  const level = clampBar(team.nivel);
  const nicknames = rng.shuffle(NICKNAMES);
  const positions = rng.shuffle(FIELD_LAYOUT);
  const stars = starCount(rng, level, team.estilo);
  // Field dorsals 2..12; a star keeper happens now and then.
  const starKeeper = stars > 0 && rng.chance(0.2);
  const starDorsals = new Set(rng.shuffle([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]).slice(0, stars - (starKeeper ? 1 : 0)));
  const base = team.estilo === 'estrellas' ? level - 1 : level;
  const cap = Math.min(10, level + 3);

  const players: PlayerData[] = [];
  for (let dorsal = 1; dorsal <= 13; dorsal++) {
    const keeper = dorsal === 1 || dorsal === 13;
    const position: Position = keeper ? 'portero' : (positions[dorsal - 2] as Position);
    let archetype: Archetype = 'portero';
    if (!keeper) {
      const boost = STYLE_BOOST[team.estilo] ?? {};
      const options = POSITION_ARCHETYPES[position as Exclude<Position, 'portero'>].map(
        ([item, weight]): [Archetype, number] => [item, weight + (boost[item] ?? 0)],
      );
      archetype = weightedPick(rng, options);
    }
    const star = keeper ? starKeeper && dorsal === 1 : starDorsals.has(dorsal);

    const stats = {} as Record<StatKey, number>;
    for (const key of STAT_KEYS) {
      const raw = base + ARCHETYPE_PROFILE[archetype][key] + STYLE_PROFILE[team.estilo][key] + rng.gauss();
      stats[key] = Math.min(clampBar(raw), star ? 10 : cap);
    }
    if (star && !keeper) {
      const keys = rng.shuffle(STAR_STATS[archetype]).slice(0, rng.int(2, 3));
      for (const key of keys) stats[key] = rng.int(8, 10);
    }

    const player: PlayerData = {
      id: `${team.id}-${String(dorsal).padStart(2, '0')}`,
      dorsal,
      mote: nicknames[dorsal - 1] as string,
      puesto: position,
      mano: rng.chance(0.15) ? 'zurdo' : 'diestro',
      arquetipo: archetype,
      stats,
      frases: [],
      fotos: [],
      origen: 'generado',
    };

    if (keeper) {
      const keeperStats = {} as Record<(typeof KEEPER_STAT_KEYS)[number], number>;
      // The reserve keeper (13) is a notch below the starter.
      for (const key of KEEPER_STAT_KEYS) keeperStats[key] = clampBar(level + (dorsal === 13 ? -1 : 0) + rng.gauss());
      if (star) for (const key of rng.shuffle(KEEPER_STAT_KEYS).slice(0, 2)) keeperStats[key] = rng.int(8, 10);
      player.statsPortero = keeperStats;
    }

    const traitRoll = rng.next();
    if (star && traitRoll < 0.6) player.rasgo = rng.pick(ARCHETYPE_TRAIT[archetype]);
    else if (!star && keeper && level <= 4 && traitRoll < 0.15) player.rasgo = 'inseguro';
    else if (!star && !keeper && traitRoll < 0.1) player.rasgo = rng.pick(ARCHETYPE_TRAIT[archetype]);
    if (star) player.estrella = true;

    players.push(player);
  }

  return {
    equipoId: team.id,
    semilla: seed,
    versionGenerador: GENERATOR_VERSION,
    nivel: level,
    estilo: team.estilo,
    jugadores: players,
  };
}
