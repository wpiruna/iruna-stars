/**
 * Data schemas. JSON keys stay in Spanish (they mirror the spreadsheet and docs/GDD.md §18.3);
 * everything else in the codebase is English. Shared by the converter (tools/) and the game.
 */
import { z } from 'zod';

export const POSITIONS = ['boya', 'extremo', 'lateral', 'cierre', 'portero'] as const;
export const HANDS = ['diestro', 'zurdo'] as const;
export const ARCHETYPES = [
  'boya',
  'defensor',
  'lanzador',
  'extremo',
  'organizador',
  'velocista',
  'todoterreno',
  'portero',
] as const;
export const FIELD_TRAITS = ['misil', 'iman', 'diesel', 'regateador', 'lenador', 'cerebro'] as const;
export const KEEPER_TRAITS = ['muro', 'kamikaze', 'inseguro'] as const;
export const TRAITS = [...FIELD_TRAITS, ...KEEPER_TRAITS] as const;
export const STYLES = ['equilibrado', 'defensivo', 'rapido', 'lanzadores', 'fisico', 'estrellas'] as const;
export const SPECIAL_SHOT_TYPES = ['potencia', 'vaselina', 'bote', 'rosca'] as const;
export const CELEBRATIONS = ['puno_arriba', 'salpicar', 'senalar_banquillo', 'abrazo', 'absurda'] as const;
export const ORIGINS = ['real', 'provisional', 'generado'] as const;
export const CARD_MODES = ['arcade', 'reglamento'] as const;
export type CardMode = (typeof CARD_MODES)[number];
export const STAT_KEYS = [
  'velocidad',
  'resistencia',
  'potencia',
  'precision',
  'pase',
  'habilidad',
  'defensa',
  'agresividad',
] as const;
export const KEEPER_STAT_KEYS = ['reflejos', 'colocacion', 'salida'] as const;

export type Position = (typeof POSITIONS)[number];
export type Hand = (typeof HANDS)[number];
export type Archetype = (typeof ARCHETYPES)[number];
export type Trait = (typeof TRAITS)[number];
export type Style = (typeof STYLES)[number];
export type Origin = (typeof ORIGINS)[number];
export type StatKey = (typeof STAT_KEYS)[number];
export type KeeperStatKey = (typeof KEEPER_STAT_KEYS)[number];

/** Spanish labels for everything the user reads (screens, report). */
export const LABELS = {
  puesto: { boya: 'Boya', extremo: 'Extremo', lateral: 'Lateral', cierre: 'Cierre', portero: 'Portero' },
  mano: { diestro: 'Diestro', zurdo: 'Zurdo' },
  estilo: {
    equilibrado: 'Equilibrado',
    defensivo: 'Defensivo',
    rapido: 'Rápido',
    lanzadores: 'Lanzadores',
    fisico: 'Físico',
    estrellas: 'Estrellas',
  },
  stat: {
    velocidad: 'Velocidad',
    resistencia: 'Resistencia',
    potencia: 'Potencia',
    precision: 'Precisión',
    pase: 'Pase',
    habilidad: 'Habilidad',
    defensa: 'Defensa',
    agresividad: 'Agresividad',
    reflejos: 'Reflejos',
    colocacion: 'Colocación',
    salida: 'Salida',
  },
  rasgo: {
    misil: 'Misil',
    iman: 'Imán',
    diesel: 'Diésel',
    regateador: 'Regateador',
    lenador: 'Leñador',
    cerebro: 'Cerebro',
    muro: 'Muro',
    kamikaze: 'Kamikaze',
    inseguro: 'Inseguro',
  },
} as const;

export const DEFAULT_BAR = 5;
const bar = z.number().int().min(1).max(10);

export const StatsSchema = z.object({
  velocidad: bar,
  resistencia: bar,
  potencia: bar,
  precision: bar,
  pase: bar,
  habilidad: bar,
  defensa: bar,
  agresividad: bar,
});
export const KeeperStatsSchema = z.object({ reflejos: bar, colocacion: bar, salida: bar });

export const PlayerSchema = z.object({
  id: z.string().min(1),
  dorsal: z.number().int().min(1).max(99),
  mote: z.string().min(1),
  puesto: z.enum(POSITIONS),
  mano: z.enum(HANDS),
  arquetipo: z.enum(ARCHETYPES),
  stats: StatsSchema,
  statsPortero: KeeperStatsSchema.optional(),
  rasgo: z.enum(TRAITS).optional(),
  tiroEspecial: z.object({ nombre: z.string().min(1), tipo: z.enum(SPECIAL_SHOT_TYPES) }).optional(),
  celebracion: z.enum(CELEBRATIONS).optional(),
  frases: z.array(z.string()).default([]),
  /** Image catalog keys: [main, special?]. Empty → a placeholder is drawn with code. */
  fotos: z.array(z.string()).max(2).default([]),
  origen: z.enum(ORIGINS),
  estrella: z.boolean().optional(),
  /** Bars the user left empty in the sheet (they hold the default). Only for the data screen. */
  barrasVacias: z.number().int().min(0).optional(),
});
export type PlayerData = z.infer<typeof PlayerSchema>;

/** A real rival player from the "Rivales reales" tab: overrides the generated one with the same dorsal. */
export const RealRivalSchema = z.object({
  dorsal: z.number().int().min(1).max(99),
  mote: z.string().optional(),
  puesto: z.enum(POSITIONS).optional(),
  mano: z.enum(HANDS).optional(),
  stats: StatsSchema.partial().optional(),
  statsPortero: KeeperStatsSchema.partial().optional(),
  rasgo: z.enum(TRAITS).optional(),
});
export type RealRivalData = z.infer<typeof RealRivalSchema>;

export const OurTeamSchema = z.object({
  id: z.literal('nuestro'),
  nombre: z.string().min(1),
  siglas: z.string().min(1).max(4),
  escudo: z.string().optional(),
  jugadores: z.array(PlayerSchema).min(7),
});
export type OurTeamData = z.infer<typeof OurTeamSchema>;

export const RivalTeamSchema = z.object({
  id: z.string().min(1),
  nombre: z.string().min(1),
  siglas: z.string().min(1).max(4),
  escudo: z.string().optional(),
  nivel: bar,
  estilo: z.enum(STYLES),
  enCopa: z.boolean(),
  consejosEmilio: z.array(z.string()).default([]),
  jugadoresReales: z.array(RealRivalSchema).default([]),
  origen: z.enum(ORIGINS),
});
export type RivalTeamData = z.infer<typeof RivalTeamSchema>;

export const RosterSchema = z.object({
  equipoId: z.string().min(1),
  semilla: z.number().int(),
  versionGenerador: z.number().int(),
  nivel: bar,
  estilo: z.enum(STYLES),
  jugadores: z.array(PlayerSchema).length(13),
});
export type RosterData = z.infer<typeof RosterSchema>;

export const RefereeSchema = z.object({
  id: z.string().min(1),
  nombre: z.string().min(1),
  foto: z.string().optional(),
  toleranciaContacto: bar,
  exclusiones: bar,
  tarjetas: bar,
  sesgo: z.number().int().min(-3).max(3),
  regularidad: bar,
  frases: z.array(z.string()).default([]),
  origen: z.enum(ORIGINS),
});
export type RefereeData = z.infer<typeof RefereeSchema>;

export const ClubSchema = z.object({
  nombre: z.string().min(1),
  siglas: z.string().min(1).max(4),
  presidente: z.string().min(1),
  fotoPresidente: z.string().optional(),
  competicion: z.string().min(1),
  logo: z.string().optional(),
});
export type ClubData = z.infer<typeof ClubSchema>;

export const CupSchema = z.object({
  nombre: z.string().min(1),
  participantes: z.array(z.string()).length(8),
  sorteo: z.literal('aleatorio'),
  rondas: z.array(z.string()).length(3),
  designacionArbitros: z.literal('aleatoria'),
  empate: z.literal('penaltis'),
});
export type CupData = z.infer<typeof CupSchema>;

export const RulesSchema = z.object({
  version: z.string(),
  modoTarjetas: z.enum(CARD_MODES),
  campo: z.object({
    largo: z.number().positive(),
    ancho: z.number().positive(),
    porteriaAncho: z.number().positive(),
    porteriaAlto: z.number().positive(),
    lineas: z.object({ dosMetros: z.number(), penalti: z.number(), seisMetros: z.number() }),
  }),
  /** Goal area in front of each goal (WP 20.4): 2 m deep, 2 m beyond each post. */
  areaGol: z.object({ ancho: z.number().positive() }),
  partido: z.object({
    periodos: z.number().int().positive(),
    minutosMarcador: z.number().positive(),
    tiemposMuertos: z.number().int().min(0),
    cambioDeCampo: z.boolean(),
  }),
  posesion: z.object({
    primera: z.number().positive(),
    segunda: z.number().positive(),
    trasExclusion: z.number().positive(),
    trasCorner: z.number().positive(),
    trasPenalti: z.number().positive(),
  }),
  exclusion: z.object({
    segundos: z.number().positive(),
    faltasPersonalesMax: z.number().int().positive(),
    brutalidadMinutos: z.number().positive(),
  }),
  /** Arcade cards: a second yellow to the same player is a red. */
  tarjetas: z.object({ amarillasParaRoja: z.number().int().positive() }),
  tiroDirectoFueraDe: z.number().positive(),
  /** Arcade reading of "sin demora": real seconds the taker of a free throw outside 6 m has to shoot directly. */
  tiroDirectoSegundos: z.number().positive(),
  penaltiDesde: z.number().positive(),
  tiroLibreSegundos: z.number().positive(),
  velocidadRelojes: z.object({
    partido: z.number().positive(),
    posesion: z.number().positive(),
    exclusion: z.number().positive(),
  }),
  convocatoria: z.object({
    campo: z.number().int().positive(),
    porteros: z.number().int().positive(),
    suplentesMin: z.number().int().min(0),
    suplentesMax: z.number().int().min(0),
    suplentes: z.number().int().min(0),
  }),
  cambios: z.object({ volantes: z.boolean() }),
  tandaPenaltis: z.object({ lanzadores: z.number().int().positive(), muerteSubita: z.boolean() }),
});
export type RulesData = z.infer<typeof RulesSchema>;

/** Values the "Ajustes" tab may override on top of reglas.json. Every key is optional. */
export const RulesOverrideSchema = z.object({
  suplentes: z.number().int().min(4).max(5).optional(),
  minutosMarcador: z.number().positive().optional(),
  segundosRealesPeriodo: z.number().positive().optional(),
  posesionPrimera: z.number().positive().optional(),
  posesionSegunda: z.number().positive().optional(),
  exclusionSegundos: z.number().positive().optional(),
  modoTarjetas: z.enum(CARD_MODES).optional(),
});
export type RulesOverride = z.infer<typeof RulesOverrideSchema>;

const slot = z.object({ x: z.number(), y: z.number(), radioZona: z.number().positive() });
export const FormationsSchema = z.record(
  z.string(),
  z.object({ descripcion: z.string().optional(), puestos: z.record(z.string(), slot) }),
);
export type FormationsData = z.infer<typeof FormationsSchema>;

export const PHRASE_TYPES = [
  'emilio_previa',
  'emilio_tiempo_muerto',
  'emilio_cambio',
  'banquillo',
  'gol',
  'arbitro',
  'victoria',
  'derrota',
] as const;
export type PhraseType = (typeof PHRASE_TYPES)[number];

export const PhraseSchema = z.object({
  tipo: z.enum(PHRASE_TYPES),
  /** Team ID, referee ID or player dorsal (as text). Empty = anyone. */
  para: z.string().default(''),
  frase: z.string().min(1),
  origen: z.enum(ORIGINS),
});
export type PhraseData = z.infer<typeof PhraseSchema>;

export const WarningSchema = z.object({
  pestana: z.string(),
  fila: z.number().int().optional(),
  columna: z.string().optional(),
  mensaje: z.string(),
});
export type DataWarning = z.infer<typeof WarningSchema>;

const count = z.object({ reales: z.number().int(), provisionales: z.number().int() });
export const DataStatusSchema = z.object({
  generado: z.string(),
  hoja: z.string().nullable(),
  jugadores: count,
  equipos: count,
  arbitros: count,
  frases: count,
  barrasVacias: z.number().int(),
  jugadoresSinBarras: z.array(z.string()),
  imagenesFaltantes: z.array(z.object({ tipo: z.string(), de: z.string(), esperado: z.string() })),
  imagenesSobrantes: z.array(z.object({ archivo: z.string(), motivo: z.string() })),
  avisos: z.array(WarningSchema),
  privacidad: z.array(z.string()),
});
export type DataStatus = z.infer<typeof DataStatusSchema>;
