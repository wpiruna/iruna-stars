/**
 * Spreadsheet → validated raw entities. Never throws on bad data: a wrong value takes its
 * default and produces a warning in Spanish naming the tab, the row and the column.
 */
import {
  ARCHETYPES,
  CARD_MODES,
  CELEBRATIONS,
  DEFAULT_BAR,
  KEEPER_STAT_KEYS,
  KEEPER_TRAITS,
  POSITIONS,
  SPECIAL_SHOT_TYPES,
  STAT_KEYS,
  STYLES,
  TRAITS,
  type Archetype,
  type DataWarning,
  type Hand,
  type KeeperStatKey,
  type PhraseType,
  type Position,
  type RealRivalData,
  type RulesOverride,
  type StatKey,
  type Style,
  type Trait,
} from '../../src/data/schema';
import { tableOf, type RawSheet, type TableRow } from './leer-hoja';
import { cellNumber, cellText, leadingInt, normalize, slugify } from './texto';

export interface SheetPlayer {
  fila: number;
  dorsal: number;
  mote?: string;
  puesto?: Position;
  mano?: Hand;
  stats: Partial<Record<StatKey, number>>;
  statsPortero: Partial<Record<KeeperStatKey, number>>;
  arquetipo?: Archetype;
  rasgo?: Trait;
  tiroEspecial?: { nombre: string; tipo: (typeof SPECIAL_SHOT_TYPES)[number] };
  celebracion?: (typeof CELEBRATIONS)[number];
  frase?: string;
}

export interface SheetTeam {
  fila: number;
  id: string;
  nombre?: string;
  siglas?: string;
  nivel?: number;
  estilo?: Style;
  enCopa: boolean;
  consejo?: string;
}

export interface SheetReferee {
  fila: number;
  id: string;
  nombre?: string;
  toleranciaContacto?: number;
  exclusiones?: number;
  tarjetas?: number;
  sesgo?: number;
  regularidad?: number;
  frase?: string;
}

export interface SheetSettings {
  nombreClub?: string;
  siglasClub?: string;
  archivoEscudo?: string;
  presidente?: string;
  archivoPresidente?: string;
  competicion?: string;
  reglas: RulesOverride;
}

export interface SheetPhrase {
  tipo: PhraseType;
  para: string;
  frase: string;
}

export interface Converted {
  players: SheetPlayer[];
  teams: SheetTeam[];
  realRivals: Map<string, RealRivalData[]>;
  referees: SheetReferee[];
  settings: SheetSettings;
  phrases: SheetPhrase[];
  warnings: DataWarning[];
  privacy: string[];
}

export const TABS = {
  players: 'Jugadores',
  teams: 'Equipos',
  realRivals: 'Rivales reales',
  referees: 'Árbitros',
  settings: 'Ajustes',
  phrases: 'Frases',
} as const;

const STAT_COLUMNS: Record<StatKey, string> = {
  velocidad: 'Velocidad',
  resistencia: 'Resistencia',
  potencia: 'Potencia',
  precision: 'Precisión',
  pase: 'Pase',
  habilidad: 'Habilidad',
  defensa: 'Defensa',
  agresividad: 'Agresividad',
};
const KEEPER_COLUMNS: Record<KeeperStatKey, string> = {
  reflejos: 'Reflejos',
  colocacion: 'Colocación',
  salida: 'Salida',
};

const CELEBRATION_LABELS: Record<string, (typeof CELEBRATIONS)[number]> = {
  'puno arriba': 'puno_arriba',
  salpicar: 'salpicar',
  'senalar al banquillo': 'senalar_banquillo',
  'senalar banquillo': 'senalar_banquillo',
  abrazo: 'abrazo',
  absurda: 'absurda',
};
const PHRASE_LABELS: Record<string, PhraseType> = {
  'emilio antes del partido': 'emilio_previa',
  'emilio previa': 'emilio_previa',
  'emilio tiempo muerto': 'emilio_tiempo_muerto',
  'emilio cambio': 'emilio_cambio',
  banquillo: 'banquillo',
  gol: 'gol',
  arbitro: 'arbitro',
  victoria: 'victoria',
  derrota: 'derrota',
};
const HAND_LABELS: Record<string, Hand> = {
  diestro: 'diestro',
  diestra: 'diestro',
  derecha: 'diestro',
  zurdo: 'zurdo',
  zurda: 'zurdo',
  izquierda: 'zurdo',
};

/** Builds a lookup "normalized label → key" for enums whose labels are their own keys. */
function selfLabels<T extends string>(keys: readonly T[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const key of keys) out[normalize(key)] = key;
  return out;
}
const POSITION_LABELS = selfLabels(POSITIONS);
const ARCHETYPE_LABELS = selfLabels(ARCHETYPES);
const TRAIT_LABELS = selfLabels(TRAITS);
const STYLE_LABELS = selfLabels(STYLES);
const SHOT_LABELS = selfLabels(SPECIAL_SHOT_TYPES);
const CARD_LABELS = selfLabels(CARD_MODES);

class Reporter {
  readonly warnings: DataWarning[] = [];
  constructor(private readonly tab: string) {}

  warn(fila: number | undefined, columna: string | undefined, mensaje: string): void {
    this.warnings.push({ pestana: this.tab, fila, columna, mensaje });
  }

  /** 1–10 bar. Empty → undefined (the caller applies the default silently). */
  bar(row: TableRow, column: string): number | undefined {
    const raw = row.get(column);
    if (cellText(raw) === '') return undefined;
    const value = cellNumber(raw);
    if (value === null || value < 1 || value > 10) {
      this.warn(row.rowNumber, column, `${column} = ${cellText(raw)} no es válida; se usa ${DEFAULT_BAR}`);
      return DEFAULT_BAR;
    }
    if (!Number.isInteger(value)) {
      const rounded = Math.round(value);
      this.warn(row.rowNumber, column, `${column} = ${cellText(raw)} no es un número entero; se usa ${rounded}`);
      return rounded;
    }
    return value;
  }

  /** Dropdown value. Empty → undefined. Unknown → undefined + warning naming the fallback. */
  choice<T extends string>(
    row: TableRow,
    column: string,
    labels: Record<string, T>,
    fallbackText: string,
  ): T | undefined {
    const raw = row.text(column);
    if (raw === '') return undefined;
    const found = labels[normalize(raw)];
    if (found === undefined) {
      this.warn(row.rowNumber, column, `${column} = ${raw} no es válido; ${fallbackText}`);
    }
    return found;
  }
}

function isActive(row: TableRow): boolean {
  const value = normalize(row.get('Activo'));
  return !(value === 'no' || value === 'n' || value === '0' || value === 'false');
}

function parseYesNo(value: unknown, whenEmpty: boolean): boolean {
  const text = normalize(value);
  if (text === '') return whenEmpty;
  return !(text === 'no' || text === 'n' || text === '0' || text === 'false');
}

function parseDorsal(rep: Reporter, row: TableRow): number | null {
  const raw = row.get('Dorsal');
  const value = cellNumber(raw);
  if (value === null || !Number.isInteger(value) || value < 1 || value > 99) {
    rep.warn(
      row.rowNumber,
      'Dorsal',
      cellText(raw) === ''
        ? 'falta el Dorsal; la fila se ignora'
        : `Dorsal = ${cellText(raw)} no es válido (1 a 99); la fila se ignora`,
    );
    return null;
  }
  return value;
}

function parseId(rep: Reporter, row: TableRow, column: string): string | null {
  const raw = row.text(column);
  if (raw === '') {
    rep.warn(row.rowNumber, column, `falta el ${column}; la fila se ignora`);
    return null;
  }
  const id = slugify(raw);
  if (id === '') {
    rep.warn(row.rowNumber, column, `${column} = ${raw} no es válido; la fila se ignora`);
    return null;
  }
  if (id !== raw) {
    rep.warn(row.rowNumber, column, `${column} = ${raw} se usa como "${id}" (minúsculas, sin espacios ni tildes)`);
  }
  return id;
}

function parseTrait(rep: Reporter, row: TableRow, isKeeper: boolean | undefined): Trait | undefined {
  const trait = rep.choice(row, 'Rasgo', TRAIT_LABELS, 'se deja sin rasgo');
  if (trait === undefined || isKeeper === undefined) return trait;
  const keeperTrait = (KEEPER_TRAITS as readonly string[]).includes(trait);
  if (keeperTrait !== isKeeper) {
    rep.warn(
      row.rowNumber,
      'Rasgo',
      isKeeper
        ? `Rasgo = ${row.text('Rasgo')} no es de portero; se deja sin rasgo`
        : `Rasgo = ${row.text('Rasgo')} es solo para porteros; se deja sin rasgo`,
    );
    return undefined;
  }
  return trait;
}

function parseMote(rep: Reporter, row: TableRow): string | undefined {
  const mote = row.text('Mote');
  if (mote === '') return undefined;
  if (mote.length > 12) {
    rep.warn(row.rowNumber, 'Mote', `Mote = ${mote} es demasiado largo; se recorta a "${mote.slice(0, 12)}"`);
    return mote.slice(0, 12);
  }
  if (mote.length > 8) {
    rep.warn(row.rowNumber, 'Mote', `Mote = ${mote} tiene más de 8 letras; puede no caber en el cromo`);
  }
  return mote;
}

function convertPlayers(sheets: RawSheet[], privacy: string[]): { players: SheetPlayer[]; warnings: DataWarning[] } {
  const table = tableOf(sheets, TABS.players);
  const rep = new Reporter(TABS.players);
  const players: SheetPlayer[] = [];
  const seen = new Map<number, number>();
  let names = 0;

  for (const row of table.dataRows(['Fotos'])) {
    if (row.text('Nombre') !== '') names++;
    if (!isActive(row)) continue;
    const dorsal = parseDorsal(rep, row);
    if (dorsal === null) continue;
    const previous = seen.get(dorsal);
    if (previous !== undefined) {
      rep.warn(row.rowNumber, 'Dorsal', `el dorsal ${dorsal} ya está en la fila ${previous}; esta fila se ignora`);
      continue;
    }
    seen.set(dorsal, row.rowNumber);

    const puesto = rep.choice(row, 'Puesto', POSITION_LABELS, 'se elige el puesto que más falte');
    const stats: SheetPlayer['stats'] = {};
    for (const key of STAT_KEYS) {
      const value = rep.bar(row, STAT_COLUMNS[key]);
      if (value !== undefined) stats[key] = value;
    }
    const statsPortero: SheetPlayer['statsPortero'] = {};
    for (const key of KEEPER_STAT_KEYS) {
      const value = rep.bar(row, KEEPER_COLUMNS[key]);
      if (value !== undefined) statsPortero[key] = value;
    }

    const player: SheetPlayer = { fila: row.rowNumber, dorsal, stats, statsPortero };
    const mote = parseMote(rep, row);
    if (mote !== undefined) player.mote = mote;
    if (puesto !== undefined) player.puesto = puesto;
    const mano = rep.choice(row, 'Mano', HAND_LABELS, 'se usa Diestro');
    if (mano !== undefined) player.mano = mano;
    const arquetipo = rep.choice(row, 'Arquetipo', ARCHETYPE_LABELS, 'se deduce de su puesto y sus barras');
    if (arquetipo !== undefined) player.arquetipo = arquetipo;
    const rasgo = parseTrait(rep, row, puesto === undefined ? undefined : puesto === 'portero');
    if (rasgo !== undefined) player.rasgo = rasgo;

    const shotName = row.text('Tiro especial');
    const shotType = rep.choice(row, 'Tipo de tiro especial', SHOT_LABELS, 'se usa Potencia');
    if (shotName !== '') player.tiroEspecial = { nombre: shotName, tipo: shotType ?? 'potencia' };
    else if (shotType !== undefined) {
      rep.warn(row.rowNumber, 'Tiro especial', 'hay tipo de tiro especial pero falta su nombre; se ignora');
    }
    const celebracion = rep.choice(row, 'Celebración', CELEBRATION_LABELS, 'se usa la celebración por defecto');
    if (celebracion !== undefined) player.celebracion = celebracion;
    const frase = row.text('Frase');
    if (frase !== '') player.frase = frase;
    players.push(player);
  }

  if (names > 0) {
    privacy.push(
      `La columna Nombre de la pestaña Jugadores tiene ${names} ${names === 1 ? 'valor' : 'valores'}. ` +
        'El juego no los usa ni los publica (solo salen el mote y el dorsal), pero la hoja entera es visible ' +
        'en un repositorio público: vacía esa columna antes de subirla.',
    );
  }
  return { players, warnings: rep.warnings };
}

function convertTeams(sheets: RawSheet[]): { teams: SheetTeam[]; warnings: DataWarning[] } {
  const table = tableOf(sheets, TABS.teams);
  const rep = new Reporter(TABS.teams);
  const teams: SheetTeam[] = [];
  const seen = new Map<string, number>();

  for (const row of table.dataRows(['Archivo de escudo'])) {
    if (!isActive(row)) continue;
    const id = parseId(rep, row, 'ID');
    if (id === null) continue;
    if (id === 'nuestro' || id.startsWith('prov-')) {
      rep.warn(row.rowNumber, 'ID', `ID = ${id} está reservado por el juego; la fila se ignora`);
      continue;
    }
    const previous = seen.get(id);
    if (previous !== undefined) {
      rep.warn(row.rowNumber, 'ID', `el ID ${id} ya está en la fila ${previous}; esta fila se ignora`);
      continue;
    }
    seen.set(id, row.rowNumber);

    const team: SheetTeam = { fila: row.rowNumber, id, enCopa: parseYesNo(row.get('En la Copa'), true) };
    const nombre = row.text('Nombre');
    if (nombre !== '') team.nombre = nombre;
    const siglas = row.text('Siglas');
    if (siglas !== '') {
      const clean = siglas.toUpperCase().replace(/\s+/g, '');
      if (clean.length !== 3) {
        rep.warn(row.rowNumber, 'Siglas', `Siglas = ${siglas} no tiene 3 letras; se usa "${clean.slice(0, 3)}"`);
      }
      team.siglas = clean.slice(0, 3);
    }
    const nivel = rep.bar(row, 'Nivel');
    if (nivel !== undefined) team.nivel = nivel;
    const estilo = rep.choice(row, 'Estilo', STYLE_LABELS, 'se usa Equilibrado');
    if (estilo !== undefined) team.estilo = estilo;
    const consejo = row.text('Consejo de Emilio');
    if (consejo !== '') team.consejo = consejo;
    teams.push(team);
  }
  return { teams, warnings: rep.warnings };
}

function convertRealRivals(
  sheets: RawSheet[],
  teamIds: Set<string>,
): { realRivals: Map<string, RealRivalData[]>; warnings: DataWarning[] } {
  const table = tableOf(sheets, TABS.realRivals);
  const rep = new Reporter(TABS.realRivals);
  const realRivals = new Map<string, RealRivalData[]>();

  for (const row of table.dataRows()) {
    if (!isActive(row)) continue;
    const teamId = parseId(rep, row, 'ID del equipo');
    if (teamId === null) continue;
    if (!teamIds.has(teamId)) {
      rep.warn(row.rowNumber, 'ID del equipo', `no hay ningún equipo activo con ID = ${teamId}; la fila se ignora`);
      continue;
    }
    const dorsal = parseDorsal(rep, row);
    if (dorsal === null) continue;
    const list = realRivals.get(teamId) ?? [];
    if (list.some((p) => p.dorsal === dorsal)) {
      rep.warn(row.rowNumber, 'Dorsal', `el dorsal ${dorsal} de ${teamId} está repetido; esta fila se ignora`);
      continue;
    }

    const rival: RealRivalData = { dorsal };
    const mote = parseMote(rep, row);
    if (mote !== undefined) rival.mote = mote;
    const puesto = rep.choice(row, 'Puesto', POSITION_LABELS, 'se deja el del jugador generado');
    if (puesto !== undefined) rival.puesto = puesto;
    const mano = rep.choice(row, 'Mano', HAND_LABELS, 'se deja la del jugador generado');
    if (mano !== undefined) rival.mano = mano;
    const stats: NonNullable<RealRivalData['stats']> = {};
    for (const key of STAT_KEYS) {
      const value = rep.bar(row, STAT_COLUMNS[key]);
      if (value !== undefined) stats[key] = value;
    }
    if (Object.keys(stats).length > 0) rival.stats = stats;
    const keeper: NonNullable<RealRivalData['statsPortero']> = {};
    for (const key of KEEPER_STAT_KEYS) {
      const value = rep.bar(row, KEEPER_COLUMNS[key]);
      if (value !== undefined) keeper[key] = value;
    }
    if (Object.keys(keeper).length > 0) rival.statsPortero = keeper;
    const rasgo = parseTrait(rep, row, puesto === undefined ? undefined : puesto === 'portero');
    if (rasgo !== undefined) rival.rasgo = rasgo;

    list.push(rival);
    realRivals.set(teamId, list);
  }
  return { realRivals, warnings: rep.warnings };
}

function convertReferees(sheets: RawSheet[]): { referees: SheetReferee[]; warnings: DataWarning[] } {
  const table = tableOf(sheets, TABS.referees);
  const rep = new Reporter(TABS.referees);
  const referees: SheetReferee[] = [];
  const seen = new Map<string, number>();

  for (const row of table.dataRows(['Archivo de foto'])) {
    if (!isActive(row)) continue;
    const id = parseId(rep, row, 'ID');
    if (id === null) continue;
    const previous = seen.get(id);
    if (previous !== undefined) {
      rep.warn(row.rowNumber, 'ID', `el ID ${id} ya está en la fila ${previous}; esta fila se ignora`);
      continue;
    }
    seen.set(id, row.rowNumber);

    const referee: SheetReferee = { fila: row.rowNumber, id };
    const nombre = row.text('Nombre o apodo', 'Nombre', 'Apodo');
    if (nombre !== '') referee.nombre = nombre;
    const tolerancia = rep.bar(row, 'Tolerancia al contacto');
    if (tolerancia !== undefined) referee.toleranciaContacto = tolerancia;
    const exclusiones = rep.bar(row, 'Exclusiones');
    if (exclusiones !== undefined) referee.exclusiones = exclusiones;
    const tarjetas = rep.bar(row, 'Tarjetas');
    if (tarjetas !== undefined) referee.tarjetas = tarjetas;
    const regularidad = rep.bar(row, 'Regularidad');
    if (regularidad !== undefined) referee.regularidad = regularidad;

    const rawBias = row.text('Sesgo');
    if (rawBias !== '') {
      const bias = leadingInt(row.get('Sesgo'));
      if (bias === null || bias < -3 || bias > 3) {
        rep.warn(row.rowNumber, 'Sesgo', `Sesgo = ${rawBias} no es válido (de -3 a +3); se usa 0`);
        referee.sesgo = 0;
      } else {
        referee.sesgo = bias;
      }
    }
    const frase = row.text('Frase de presentación', 'Frase');
    if (frase !== '') referee.frase = frase;
    referees.push(referee);
  }
  return { referees, warnings: rep.warnings };
}

function convertSettings(sheets: RawSheet[]): { settings: SheetSettings; warnings: DataWarning[] } {
  const table = tableOf(sheets, TABS.settings);
  const rep = new Reporter(TABS.settings);
  const settings: SheetSettings = { reglas: {} };

  const positive = (row: TableRow, label: string): number | undefined => {
    const value = cellNumber(row.get('Valor'));
    if (value === null || value <= 0) {
      rep.warn(row.rowNumber, 'Valor', `${label} = ${row.text('Valor')} no es válido; se deja el valor por defecto`);
      return undefined;
    }
    return value;
  };

  for (const row of table.dataRows(['Si lo dejas vacío'])) {
    const label = row.text('Ajuste');
    const key = normalize(label);
    const value = row.text('Valor');
    if (key === '' || value === '') continue;

    if (key.startsWith('nombre del club')) settings.nombreClub = value;
    else if (key.startsWith('siglas del club')) {
      const clean = value.toUpperCase().replace(/\s+/g, '');
      if (clean.length !== 3) {
        rep.warn(row.rowNumber, 'Valor', `${label} = ${value} no tiene 3 letras; se usa "${clean.slice(0, 3)}"`);
      }
      settings.siglasClub = clean.slice(0, 3);
    } else if (key.startsWith('archivo del escudo')) settings.archivoEscudo = value;
    else if (key.startsWith('nombre del presidente')) settings.presidente = value;
    else if (key.startsWith('archivo de la foto del presidente')) settings.archivoPresidente = value;
    else if (key.startsWith('nombre de la competicion')) settings.competicion = value;
    else if (key.startsWith('suplentes')) {
      const n = cellNumber(row.get('Valor'));
      if (n === 4 || n === 5) settings.reglas.suplentes = n;
      else rep.warn(row.rowNumber, 'Valor', `${label} = ${value} no es válido (4 o 5); se deja el valor por defecto`);
    } else if (key.startsWith('minutos por periodo')) {
      const n = positive(row, label);
      if (n !== undefined) settings.reglas.minutosMarcador = n;
    } else if (key.startsWith('duracion real')) {
      const n = positive(row, label);
      if (n !== undefined) settings.reglas.segundosRealesPeriodo = n;
    } else if (key.startsWith('tiempo de posesion')) {
      const n = positive(row, label);
      if (n !== undefined) settings.reglas.posesionPrimera = n;
    } else if (key.startsWith('segunda posesion')) {
      const n = positive(row, label);
      if (n !== undefined) settings.reglas.posesionSegunda = n;
    } else if (key.startsWith('exclusion')) {
      const n = positive(row, label);
      if (n !== undefined) settings.reglas.exclusionSegundos = n;
    } else if (key.startsWith('tarjetas')) {
      const mode = CARD_LABELS[normalize(value)];
      if (mode) settings.reglas.modoTarjetas = mode;
      else rep.warn(row.rowNumber, 'Valor', `${label} = ${value} no es válido (Arcade o Reglamento); se usa Arcade`);
    } else {
      rep.warn(row.rowNumber, 'Ajuste', `no conozco el ajuste "${label}"; se ignora`);
    }
  }
  return { settings, warnings: rep.warnings };
}

function convertPhrases(sheets: RawSheet[]): { phrases: SheetPhrase[]; warnings: DataWarning[] } {
  const table = tableOf(sheets, TABS.phrases);
  const rep = new Reporter(TABS.phrases);
  const phrases: SheetPhrase[] = [];

  for (const row of table.dataRows()) {
    const frase = row.text('Frase');
    const tipo = rep.choice(row, 'Tipo', PHRASE_LABELS, 'la frase se ignora');
    if (frase === '') {
      rep.warn(row.rowNumber, 'Frase', 'la frase está vacía; la fila se ignora');
      continue;
    }
    if (tipo === undefined) {
      if (row.text('Tipo') === '') rep.warn(row.rowNumber, 'Tipo', 'falta el Tipo; la frase se ignora');
      continue;
    }
    const rawTarget = row.text('Para');
    const asNumber = cellNumber(row.get('Para'));
    const para = rawTarget === '' ? '' : asNumber !== null ? String(asNumber) : slugify(rawTarget);
    phrases.push({ tipo, para, frase });
  }
  return { phrases, warnings: rep.warnings };
}

/** Converts the whole workbook. `sheets = null` means "there is no spreadsheet". */
export function convertWorkbook(sheets: RawSheet[] | null): Converted {
  const all = sheets ?? [];
  const privacy: string[] = [];
  const players = convertPlayers(all, privacy);
  const teams = convertTeams(all);
  const realRivals = convertRealRivals(all, new Set(teams.teams.map((t) => t.id)));
  const referees = convertReferees(all);
  const settings = convertSettings(all);
  const phrases = convertPhrases(all);

  return {
    players: players.players,
    teams: teams.teams,
    realRivals: realRivals.realRivals,
    referees: referees.referees,
    settings: settings.settings,
    phrases: phrases.phrases,
    warnings: [
      ...players.warnings,
      ...teams.warnings,
      ...realRivals.warnings,
      ...referees.warnings,
      ...settings.warnings,
      ...phrases.warnings,
    ],
    privacy,
  };
}
