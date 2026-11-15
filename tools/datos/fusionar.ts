/**
 * Merges the user's sheet with the provisional pack (GDD §18.2): every real row replaces an
 * invented one, and whatever is missing is filled in so the game is always complete.
 */
import {
  DEFAULT_BAR,
  KEEPER_STAT_KEYS,
  STAT_KEYS,
  type Archetype,
  type ClubData,
  type CupData,
  type DataWarning,
  type OurTeamData,
  type PhraseData,
  type PlayerData,
  type Position,
  type RefereeData,
  type RivalTeamData,
  type RulesData,
  type RulesOverride,
  type StatKey,
  type Style,
} from '../../src/data/schema';
import type { ImageIndex } from '../imagenes/indice';
import { dorsalOfFile } from '../imagenes/indice';
import type { Converted, SheetPlayer } from './convertir';

export type ProvisionalPlayer = Omit<PlayerData, 'id' | 'origen' | 'fotos' | 'barrasVacias' | 'estrella'>;
export interface ProvisionalPack {
  equipo: { jugadores: ProvisionalPlayer[] };
  equipos: { id: string; nombre: string; siglas: string; nivel: number; estilo: Style }[];
  arbitros: Omit<RefereeData, 'origen' | 'foto'>[];
  club: { nombre: string; siglas: string; presidente: string; competicion: string };
  frases: Omit<PhraseData, 'origen'>[];
}

export type ImageKind = 'retrato' | 'escudo' | 'logo';
export interface ImageJob {
  key: string;
  source: string;
  kind: ImageKind;
}
export interface MissingImage {
  tipo: string;
  de: string;
  esperado: string;
}
export interface ExtraImage {
  archivo: string;
  motivo: string;
}

export interface Merged {
  team: OurTeamData;
  teams: RivalTeamData[];
  referees: RefereeData[];
  club: ClubData;
  cup: CupData;
  rulesOverride: RulesOverride;
  phrases: PhraseData[];
  imageJobs: ImageJob[];
  missingImages: MissingImage[];
  extraImages: ExtraImage[];
  warnings: DataWarning[];
  emptyBars: number;
  playersWithoutBars: string[];
}

export const CUP_RIVALS = 7;
const CUP_ROUNDS = ['Cuartos de final', 'Semifinal', 'Final'];
/** Shape of a full squad, used to decide which position is most needed. */
const IDEAL_SQUAD: Record<Position, number> = { portero: 2, boya: 2, extremo: 3, lateral: 3, cierre: 3 };
const POSITION_ORDER: Position[] = ['boya', 'extremo', 'lateral', 'cierre', 'portero'];

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Play profile deduced from the position and the strongest bars. */
export function deduceArchetype(position: Position, stats: Record<StatKey, number>): Archetype {
  if (position === 'portero') return 'portero';
  if (position === 'boya') return 'boya';
  const values = STAT_KEYS.map((key) => stats[key]);
  const spread = Math.max(...values) - Math.min(...values);
  if (spread < 2) return position === 'extremo' ? 'extremo' : position === 'cierre' ? 'organizador' : 'todoterreno';
  const top = STAT_KEYS.reduce((best, key) => (stats[key] > stats[best] ? key : best), STAT_KEYS[0]);
  switch (top) {
    case 'velocidad':
      return 'velocista';
    case 'potencia':
    case 'precision':
      return position === 'extremo' ? 'extremo' : 'lanzador';
    case 'pase':
      return 'organizador';
    case 'defensa':
    case 'agresividad':
      return 'defensor';
    case 'habilidad':
      return position === 'extremo' ? 'extremo' : 'todoterreno';
    default:
      return 'todoterreno';
  }
}

/** Position with the largest shortfall against the ideal squad. */
function mostNeeded(counts: Record<Position, number>, candidates: Position[] = POSITION_ORDER): Position {
  let best = candidates[0] as Position;
  let bestGap = -Infinity;
  for (const position of candidates) {
    const gap = IDEAL_SQUAD[position] - counts[position];
    if (gap > bestGap) {
      best = position;
      bestGap = gap;
    }
  }
  return best;
}

/** k evenly spaced indices out of n, so provisional rivals cover the whole range of levels. */
export function spreadIndices(n: number, k: number): number[] {
  if (k <= 0 || n <= 0) return [];
  if (k >= n) return Array.from({ length: n }, (_, i) => i);
  if (k === 1) return [Math.floor(n / 2)];
  const out = new Set<number>();
  for (let i = 0; i < k; i++) out.add(Math.round((i * (n - 1)) / (k - 1)));
  for (let i = 0; out.size < k && i < n; i++) out.add(i);
  return [...out].sort((a, b) => a - b);
}

function initials(name: string): string {
  const letters = name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return (letters + 'XXX').slice(0, 3);
}

function mergeTeam(
  converted: Converted,
  pack: ProvisionalPack,
  rules: RulesData,
  images: ImageIndex,
  out: Pick<Merged, 'imageJobs' | 'missingImages' | 'extraImages' | 'warnings' | 'playersWithoutBars'>,
): { players: PlayerData[]; emptyBars: number } {
  const counts: Record<Position, number> = { portero: 0, boya: 0, extremo: 0, lateral: 0, cierre: 0 };
  for (const p of converted.players) if (p.puesto) counts[p.puesto]++;

  const photos = images.playerPhotos();
  const players: PlayerData[] = [];
  let emptyBars = 0;

  const toPlayer = (sheet: SheetPlayer): PlayerData => {
    let position = sheet.puesto;
    if (position === undefined) {
      position = mostNeeded(counts);
      counts[position]++;
    }
    const keeper = position === 'portero';
    const stats = {} as Record<StatKey, number>;
    let empty = 0;
    for (const key of STAT_KEYS) {
      const value = sheet.stats[key];
      if (value === undefined) empty++;
      stats[key] = value ?? DEFAULT_BAR;
    }
    const mote = sheet.mote ?? `Nº ${sheet.dorsal}`;
    const player: PlayerData = {
      id: `nuestro-${pad2(sheet.dorsal)}`,
      dorsal: sheet.dorsal,
      mote,
      puesto: position,
      mano: sheet.mano ?? 'diestro',
      arquetipo: sheet.arquetipo ?? deduceArchetype(position, stats),
      stats,
      frases: sheet.frase ? [sheet.frase] : [],
      fotos: [],
      origen: 'real',
    };
    if (keeper) {
      const keeperStats = {} as Record<(typeof KEEPER_STAT_KEYS)[number], number>;
      for (const key of KEEPER_STAT_KEYS) {
        const value = sheet.statsPortero[key];
        if (value === undefined) empty++;
        keeperStats[key] = value ?? DEFAULT_BAR;
      }
      player.statsPortero = keeperStats;
    }
    if (sheet.rasgo) {
      // The trait could not be checked against the position when the position was empty.
      const keeperTrait = ['muro', 'kamikaze', 'inseguro'].includes(sheet.rasgo);
      if (keeperTrait === keeper) player.rasgo = sheet.rasgo;
      else {
        out.warnings.push({
          pestana: 'Jugadores',
          fila: sheet.fila,
          columna: 'Rasgo',
          mensaje: `Rasgo = ${sheet.rasgo} no encaja con el puesto ${position}; se deja sin rasgo`,
        });
      }
    }
    if (sheet.tiroEspecial) player.tiroEspecial = sheet.tiroEspecial;
    if (sheet.celebracion) player.celebracion = sheet.celebracion;
    if (empty > 0) {
      player.barrasVacias = empty;
      emptyBars += empty;
      const total = STAT_KEYS.length + (keeper ? KEEPER_STAT_KEYS.length : 0);
      if (empty === total) out.playersWithoutBars.push(`Nº ${sheet.dorsal} ${mote}`);
    }

    const files = photos.get(sheet.dorsal) ?? [];
    if (files.length === 0) {
      out.missingImages.push({
        tipo: 'Foto de jugador',
        de: `Nº ${sheet.dorsal} ${mote}`,
        esperado: `assets/jugadores/${pad2(sheet.dorsal)}_….png`,
      });
    }
    files.slice(0, 2).forEach((file, index) => {
      const key = `jugador-${pad2(sheet.dorsal)}-${index === 0 ? 'a' : 'b'}`;
      player.fotos.push(key);
      out.imageJobs.push({ key, source: images.pathOf('jugadores', file), kind: 'retrato' });
    });
    for (const file of files.slice(2)) {
      out.extraImages.push({
        archivo: `assets/jugadores/${file}`,
        motivo: `el dorsal ${sheet.dorsal} ya tiene dos fotos; se usan las dos primeras por orden alfabético`,
      });
    }
    return player;
  };

  // Given positions were counted up front, so empty ones are assigned against the real picture.
  const ordered = [...converted.players].sort((a, b) => a.dorsal - b.dorsal);
  for (const sheet of ordered) players.push(toPlayer(sheet));

  // Photos that belong to no active player.
  const realDorsals = new Set(converted.players.map((p) => p.dorsal));
  for (const file of images.list('jugadores')) {
    const dorsal = dorsalOfFile(file);
    if (dorsal === null) {
      out.extraImages.push({
        archivo: `assets/jugadores/${file}`,
        motivo: 'el nombre no empieza por un dorsal (01, 02…); no se usa',
      });
    } else if (!realDorsals.has(dorsal)) {
      out.extraImages.push({
        archivo: `assets/jugadores/${file}`,
        motivo: `no hay ningún jugador activo con el dorsal ${dorsal} en la pestaña Jugadores; no se usa`,
      });
    }
  }

  // Fill up with provisional players until a full squad is possible.
  const minKeepers = rules.convocatoria.porteros + 1;
  const minField = rules.convocatoria.campo + rules.convocatoria.suplentesMax;
  const usedDorsals = new Set(players.map((p) => p.dorsal));
  const pool = pack.equipo.jugadores.slice();

  const addProvisional = (candidate: ProvisionalPlayer): void => {
    pool.splice(pool.indexOf(candidate), 1);
    let dorsal = candidate.dorsal;
    if (usedDorsals.has(dorsal)) {
      dorsal = 1;
      while (usedDorsals.has(dorsal)) dorsal++;
    }
    usedDorsals.add(dorsal);
    counts[candidate.puesto]++;
    players.push({ ...candidate, dorsal, id: `nuestro-${pad2(dorsal)}`, fotos: [], origen: 'provisional' });
  };

  while (players.filter((p) => p.puesto === 'portero').length < minKeepers) {
    const candidate = pool.find((p) => p.puesto === 'portero');
    if (!candidate) break;
    addProvisional(candidate);
  }
  while (players.filter((p) => p.puesto !== 'portero').length < minField) {
    const available = [...new Set(pool.filter((p) => p.puesto !== 'portero').map((p) => p.puesto))];
    if (available.length === 0) break;
    const position = mostNeeded(counts, available);
    addProvisional(pool.find((p) => p.puesto === position) as ProvisionalPlayer);
  }

  players.sort((a, b) => a.dorsal - b.dorsal);
  return { players, emptyBars };
}

export function mergeData(
  converted: Converted,
  pack: ProvisionalPack,
  rules: RulesData,
  images: ImageIndex,
): Merged {
  const imageJobs: ImageJob[] = [];
  const missingImages: MissingImage[] = [];
  const extraImages: ExtraImage[] = [];
  const warnings: DataWarning[] = [...converted.warnings];
  const playersWithoutBars: string[] = [];
  const shared = { imageJobs, missingImages, extraImages, warnings, playersWithoutBars };

  // --- Club -------------------------------------------------------------------------------
  const settings = converted.settings;
  const club: ClubData = {
    nombre: settings.nombreClub ?? pack.club.nombre,
    siglas: settings.siglasClub ?? pack.club.siglas,
    presidente: settings.presidente ?? pack.club.presidente,
    competicion: settings.competicion ?? pack.club.competicion,
  };

  const usedShields = new Set<string>();
  const ownShield =
    (settings.archivoEscudo ? images.find('escudos', settings.archivoEscudo) : null) ?? images.find('escudos', 'nuestro');
  let ownShieldKey: string | undefined;
  if (ownShield) {
    usedShields.add(ownShield);
    ownShieldKey = 'escudo-nuestro';
    imageJobs.push({ key: ownShieldKey, source: images.pathOf('escudos', ownShield), kind: 'escudo' });
  } else {
    missingImages.push({ tipo: 'Escudo del club', de: club.nombre, esperado: 'assets/escudos/nuestro.png' });
  }

  const presidentFiles = images.list('emilio');
  const presidentPhoto =
    (settings.archivoPresidente ? images.find('emilio', settings.archivoPresidente) : null) ??
    images.find('emilio', 'emilio') ??
    (presidentFiles.length === 1 ? (presidentFiles[0] as string) : null);
  if (presidentPhoto) {
    club.fotoPresidente = 'presidente';
    imageJobs.push({ key: 'presidente', source: images.pathOf('emilio', presidentPhoto), kind: 'retrato' });
  } else {
    missingImages.push({ tipo: 'Foto del presidente', de: club.presidente, esperado: 'assets/emilio/emilio.png' });
  }
  for (const file of presidentFiles) {
    if (file !== presidentPhoto) {
      extraImages.push({ archivo: `assets/emilio/${file}`, motivo: 'solo se usa una foto del presidente' });
    }
  }

  const logo = images.find('logo', 'logo');
  if (logo) {
    club.logo = 'logo';
    imageJobs.push({ key: 'logo', source: images.pathOf('logo', logo), kind: 'logo' });
  }

  // --- Our team ---------------------------------------------------------------------------
  const { players, emptyBars } = mergeTeam(converted, pack, rules, images, shared);
  const team: OurTeamData = { id: 'nuestro', nombre: club.nombre, siglas: club.siglas, jugadores: players };
  if (ownShieldKey) team.escudo = ownShieldKey;

  // --- Rivals -----------------------------------------------------------------------------
  const teams: RivalTeamData[] = [];
  for (const sheet of converted.teams) {
    const nombre = sheet.nombre ?? sheet.id;
    const rival: RivalTeamData = {
      id: sheet.id,
      nombre,
      siglas: sheet.siglas ?? initials(nombre),
      nivel: sheet.nivel ?? DEFAULT_BAR,
      estilo: sheet.estilo ?? 'equilibrado',
      enCopa: sheet.enCopa,
      consejosEmilio: sheet.consejo ? [sheet.consejo] : [],
      jugadoresReales: converted.realRivals.get(sheet.id) ?? [],
      origen: 'real',
    };
    const shield = images.find('escudos', sheet.id);
    if (shield) {
      usedShields.add(shield);
      rival.escudo = `escudo-${sheet.id}`;
      imageJobs.push({ key: rival.escudo, source: images.pathOf('escudos', shield), kind: 'escudo' });
    } else {
      missingImages.push({ tipo: 'Escudo', de: nombre, esperado: `assets/escudos/${sheet.id}.png` });
    }
    teams.push(rival);
  }

  const cupCandidates = teams.filter((t) => t.enCopa);
  if (cupCandidates.length > CUP_RIVALS) {
    warnings.push({
      pestana: 'Equipos',
      columna: 'En la Copa',
      mensaje: `hay ${cupCandidates.length} equipos con En la Copa = Sí y caben ${CUP_RIVALS}; entran los ${CUP_RIVALS} primeros`,
    });
    for (const extra of cupCandidates.slice(CUP_RIVALS)) extra.enCopa = false;
  }
  const realCup = cupCandidates.slice(0, CUP_RIVALS);
  const cupFill = new Set(spreadIndices(pack.equipos.length, CUP_RIVALS - realCup.length));
  // Provisional teams stay available (also for friendlies) while there are fewer than 7 real ones.
  if (teams.length < CUP_RIVALS || realCup.length < CUP_RIVALS) {
    pack.equipos.forEach((prov, index) => {
      const inCup = cupFill.has(index);
      if (!inCup && teams.filter((t) => t.origen === 'real').length >= CUP_RIVALS) return;
      teams.push({ ...prov, enCopa: inCup, consejosEmilio: [], jugadoresReales: [], origen: 'provisional' });
    });
  }
  const cupIds = teams.filter((t) => t.enCopa).map((t) => t.id);

  for (const file of images.list('escudos')) {
    if (!usedShields.has(file)) {
      const id = file.replace(/\.[^.]+$/, '');
      extraImages.push({
        archivo: `assets/escudos/${file}`,
        motivo: `no hay ningún equipo activo con ID = ${id.toLowerCase()} en la pestaña Equipos; no se usa`,
      });
    }
  }

  // --- Referees ---------------------------------------------------------------------------
  const usedRefereePhotos = new Set<string>();
  let referees: RefereeData[] = converted.referees.map((sheet) => {
    const referee: RefereeData = {
      id: sheet.id,
      nombre: sheet.nombre ?? `Árbitro ${sheet.id}`,
      toleranciaContacto: sheet.toleranciaContacto ?? DEFAULT_BAR,
      exclusiones: sheet.exclusiones ?? DEFAULT_BAR,
      tarjetas: sheet.tarjetas ?? DEFAULT_BAR,
      sesgo: sheet.sesgo ?? 0,
      regularidad: sheet.regularidad ?? DEFAULT_BAR,
      frases: sheet.frase ? [sheet.frase] : [],
      origen: 'real',
    };
    const photo = images.find('arbitros', sheet.id);
    if (photo) {
      usedRefereePhotos.add(photo);
      referee.foto = `arbitro-${sheet.id}`;
      imageJobs.push({ key: referee.foto, source: images.pathOf('arbitros', photo), kind: 'retrato' });
    } else {
      missingImages.push({
        tipo: 'Foto de árbitro (opcional)',
        de: referee.nombre,
        esperado: `assets/arbitros/${sheet.id}.png`,
      });
    }
    return referee;
  });
  if (referees.length === 0) referees = pack.arbitros.map((r) => ({ ...r, origen: 'provisional' as const }));
  for (const file of images.list('arbitros')) {
    if (!usedRefereePhotos.has(file)) {
      extraImages.push({
        archivo: `assets/arbitros/${file}`,
        motivo: 'no hay ningún árbitro activo con ese ID en la pestaña Árbitros; no se usa',
      });
    }
  }

  // --- Cup, phrases -----------------------------------------------------------------------
  const cup: CupData = {
    nombre: club.competicion,
    participantes: ['nuestro', ...cupIds],
    sorteo: 'aleatorio',
    rondas: CUP_ROUNDS,
    designacionArbitros: 'aleatoria',
    empate: 'penaltis',
  };

  const phrases: PhraseData[] = [
    ...converted.phrases.map((p) => ({ ...p, origen: 'real' as const })),
    ...pack.frases.map((p) => ({ ...p, origen: 'provisional' as const })),
  ];

  return {
    team,
    teams,
    referees,
    club,
    cup,
    rulesOverride: settings.reglas,
    phrases,
    imageJobs,
    missingImages,
    extraImages,
    warnings,
    emptyBars,
    playersWithoutBars,
  };
}
