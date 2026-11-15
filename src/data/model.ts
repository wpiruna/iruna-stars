/**
 * Domain model used by the game (English). The JSON files keep Spanish keys (see schema.ts);
 * this module is the only place where one becomes the other.
 */
import type {
  ClubData,
  KeeperStatKey,
  Origin,
  PlayerData,
  RealRivalData,
  RefereeData,
  RivalTeamData,
  RosterData,
  StatKey,
} from './schema';

export type Position = 'center' | 'wing' | 'driver' | 'point' | 'goalkeeper';
export type Hand = 'right' | 'left';
export type Archetype = 'center' | 'defender' | 'shooter' | 'wing' | 'playmaker' | 'sprinter' | 'allRounder' | 'goalkeeper';
export type Trait = 'missile' | 'magnet' | 'diesel' | 'dribbler' | 'enforcer' | 'brain' | 'wall' | 'kamikaze' | 'shaky';
export type Style = 'balanced' | 'defensive' | 'fast' | 'shooters' | 'physical' | 'stars';
export type SpecialShotType = 'power' | 'lob' | 'skip' | 'sweep';
export type Celebration = 'fistUp' | 'splash' | 'pointBench' | 'hug' | 'silly';

export interface Stats {
  speed: number;
  stamina: number;
  power: number;
  accuracy: number;
  passing: number;
  skill: number;
  defense: number;
  aggression: number;
}
export interface KeeperStats {
  reflexes: number;
  positioning: number;
  rushing: number;
}

export interface Player {
  id: string;
  number: number;
  nickname: string;
  position: Position;
  hand: Hand;
  archetype: Archetype;
  stats: Stats;
  keeperStats?: KeeperStats;
  trait?: Trait;
  specialShot?: { name: string; type: SpecialShotType };
  celebration?: Celebration;
  phrases: string[];
  /** Image catalog keys: [main, special]. Empty → placeholder. */
  photos: string[];
  origin: Origin;
  star: boolean;
  /** Bars left empty in the sheet (they hold the default 5). */
  emptyBars: number;
}

export interface Team {
  id: string;
  name: string;
  code: string;
  shield?: string;
  /** 1–10. Our own team has no level. */
  level?: number;
  style?: Style;
  inCup: boolean;
  emilioTips: string[];
  players: Player[];
  origin: Origin;
}

export interface Referee {
  id: string;
  name: string;
  photo?: string;
  contactTolerance: number;
  exclusionTendency: number;
  cardTendency: number;
  /** −3 (favours us) … +3 (against us). */
  bias: number;
  consistency: number;
  phrases: string[];
  origin: Origin;
}

export interface Club {
  name: string;
  code: string;
  president: string;
  presidentPhoto?: string;
  competition: string;
  logo?: string;
}

const POSITION: Record<PlayerData['puesto'], Position> = {
  boya: 'center',
  extremo: 'wing',
  lateral: 'driver',
  cierre: 'point',
  portero: 'goalkeeper',
};
const ARCHETYPE: Record<PlayerData['arquetipo'], Archetype> = {
  boya: 'center',
  defensor: 'defender',
  lanzador: 'shooter',
  extremo: 'wing',
  organizador: 'playmaker',
  velocista: 'sprinter',
  todoterreno: 'allRounder',
  portero: 'goalkeeper',
};
const TRAIT: Record<NonNullable<PlayerData['rasgo']>, Trait> = {
  misil: 'missile',
  iman: 'magnet',
  diesel: 'diesel',
  regateador: 'dribbler',
  lenador: 'enforcer',
  cerebro: 'brain',
  muro: 'wall',
  kamikaze: 'kamikaze',
  inseguro: 'shaky',
};
const STYLE: Record<RivalTeamData['estilo'], Style> = {
  equilibrado: 'balanced',
  defensivo: 'defensive',
  rapido: 'fast',
  lanzadores: 'shooters',
  fisico: 'physical',
  estrellas: 'stars',
};
const SHOT: Record<NonNullable<PlayerData['tiroEspecial']>['tipo'], SpecialShotType> = {
  potencia: 'power',
  vaselina: 'lob',
  bote: 'skip',
  rosca: 'sweep',
};
const CELEBRATION: Record<NonNullable<PlayerData['celebracion']>, Celebration> = {
  puno_arriba: 'fistUp',
  salpicar: 'splash',
  senalar_banquillo: 'pointBench',
  abrazo: 'hug',
  absurda: 'silly',
};
const STAT: Record<StatKey, keyof Stats> = {
  velocidad: 'speed',
  resistencia: 'stamina',
  potencia: 'power',
  precision: 'accuracy',
  pase: 'passing',
  habilidad: 'skill',
  defensa: 'defense',
  agresividad: 'aggression',
};
const KEEPER_STAT: Record<KeeperStatKey, keyof KeeperStats> = {
  reflejos: 'reflexes',
  colocacion: 'positioning',
  salida: 'rushing',
};

/** Spanish labels for the model, for anything shown on screen. */
export const POSITION_LABEL: Record<Position, string> = {
  center: 'Boya',
  wing: 'Extremo',
  driver: 'Lateral',
  point: 'Cierre',
  goalkeeper: 'Portero',
};
export const STYLE_LABEL: Record<Style, string> = {
  balanced: 'Equilibrado',
  defensive: 'Defensivo',
  fast: 'Rápido',
  shooters: 'Lanzadores',
  physical: 'Físico',
  stars: 'Estrellas',
};
export const STAT_LABEL: Record<keyof Stats | keyof KeeperStats, string> = {
  speed: 'Velocidad',
  stamina: 'Resistencia',
  power: 'Potencia',
  accuracy: 'Precisión',
  passing: 'Pase',
  skill: 'Habilidad',
  defense: 'Defensa',
  aggression: 'Agresividad',
  reflexes: 'Reflejos',
  positioning: 'Colocación',
  rushing: 'Salida',
};
export const STAT_ORDER: (keyof Stats)[] = ['speed', 'stamina', 'power', 'accuracy', 'passing', 'skill', 'defense', 'aggression'];
export const KEEPER_STAT_ORDER: (keyof KeeperStats)[] = ['reflexes', 'positioning', 'rushing'];

export function toPlayer(data: PlayerData): Player {
  const stats = {} as Stats;
  for (const key of Object.keys(STAT) as StatKey[]) stats[STAT[key]] = data.stats[key];
  const player: Player = {
    id: data.id,
    number: data.dorsal,
    nickname: data.mote,
    position: POSITION[data.puesto],
    hand: data.mano === 'zurdo' ? 'left' : 'right',
    archetype: ARCHETYPE[data.arquetipo],
    stats,
    phrases: data.frases,
    photos: data.fotos,
    origin: data.origen,
    star: data.estrella ?? false,
    emptyBars: data.barrasVacias ?? 0,
  };
  if (data.statsPortero) {
    const keeper = {} as KeeperStats;
    for (const key of Object.keys(KEEPER_STAT) as KeeperStatKey[]) keeper[KEEPER_STAT[key]] = data.statsPortero[key];
    player.keeperStats = keeper;
  }
  if (data.rasgo) player.trait = TRAIT[data.rasgo];
  if (data.tiroEspecial) player.specialShot = { name: data.tiroEspecial.nombre, type: SHOT[data.tiroEspecial.tipo] };
  if (data.celebracion) player.celebration = CELEBRATION[data.celebracion];
  return player;
}

/** Applies a "Rivales reales" row on top of the generated player with the same dorsal. */
function applyRealRival(base: PlayerData, real: RealRivalData): PlayerData {
  const merged: PlayerData = {
    ...base,
    mote: real.mote ?? base.mote,
    puesto: real.puesto ?? base.puesto,
    mano: real.mano ?? base.mano,
    stats: { ...base.stats, ...real.stats },
    origen: 'real',
  };
  if (merged.puesto === 'portero') {
    merged.arquetipo = 'portero';
    merged.statsPortero = {
      reflejos: 5,
      colocacion: 5,
      salida: 5,
      ...base.statsPortero,
      ...real.statsPortero,
    };
  } else {
    delete merged.statsPortero;
    if (base.puesto === 'portero') merged.arquetipo = 'todoterreno';
  }
  if (real.rasgo) merged.rasgo = real.rasgo;
  return merged;
}

/** A rival team: its saved generated roster plus the real players the user knows. */
export function toRivalTeam(data: RivalTeamData, roster: RosterData | undefined): Team {
  const byDorsal = new Map((roster?.jugadores ?? []).map((p) => [p.dorsal, p]));
  for (const real of data.jugadoresReales) {
    const base = byDorsal.get(real.dorsal);
    if (base) byDorsal.set(real.dorsal, applyRealRival(base, real));
  }
  const team: Team = {
    id: data.id,
    name: data.nombre,
    code: data.siglas,
    level: data.nivel,
    style: STYLE[data.estilo],
    inCup: data.enCopa,
    emilioTips: data.consejosEmilio,
    players: [...byDorsal.values()].sort((a, b) => a.dorsal - b.dorsal).map(toPlayer),
    origin: data.origen,
  };
  if (data.escudo) team.shield = data.escudo;
  return team;
}

export function toReferee(data: RefereeData): Referee {
  const referee: Referee = {
    id: data.id,
    name: data.nombre,
    contactTolerance: data.toleranciaContacto,
    exclusionTendency: data.exclusiones,
    cardTendency: data.tarjetas,
    bias: data.sesgo,
    consistency: data.regularidad,
    phrases: data.frases,
    origin: data.origen,
  };
  if (data.foto) referee.photo = data.foto;
  return referee;
}

export function toClub(data: ClubData): Club {
  const club: Club = { name: data.nombre, code: data.siglas, president: data.presidente, competition: data.competicion };
  if (data.fotoPresidente) club.presidentPhoto = data.fotoPresidente;
  if (data.logo) club.logo = data.logo;
  return club;
}
