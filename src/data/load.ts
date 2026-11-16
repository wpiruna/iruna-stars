/**
 * Loads the game data. Everything is bundled at build time (so the single-file build and the
 * offline app need no network); in development Vite reloads the page when a JSON changes.
 */
import type { z } from 'zod';
import refereesJson from '../../data/arbitros.json';
import cupJson from '../../data/copa.json';
import ourTeamJson from '../../data/equipo.json';
import teamsJson from '../../data/equipos.json';
import formationsJson from '../../data/formaciones.json';
import clubJson from '../../data/generado/club.json';
import statusJson from '../../data/generado/estado.json';
import rulesOverrideJson from '../../data/generado/reglas.ajustes.json';
import rulesJson from '../../data/reglas.json';
import emilioJson from '../../data/textos/emilio.json';
import humorJson from '../../data/textos/humor.json';
import tuningJson from '../../data/tuning.json';
import { toClub, toPlayer, toReferee, toRivalTeam, type Club, type Referee, type Team } from './model';
import {
  ClubSchema,
  CupSchema,
  DataStatusSchema,
  FormationsSchema,
  OurTeamSchema,
  RefereeSchema,
  RivalTeamSchema,
  RosterSchema,
  RulesOverrideSchema,
  RulesSchema,
  type CupData,
  type DataStatus,
  type FormationsData,
  type RosterData,
  type RulesData,
  type RulesOverride,
} from './schema';

const rosterModules = import.meta.glob<RosterData>('../../data/generado/rivales/*.json', {
  eager: true,
  import: 'default',
});

/**
 * Validates a generated file. These come from our own converter, so a failure means a bug, not
 * a user mistake; even then the game keeps going with the raw data (GDD §2: never break).
 */
function checked<S extends z.ZodType>(name: string, schema: S, raw: unknown): z.infer<S> {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  console.warn(`[datos] ${name} no cumple el esquema; se usa tal cual.`, result.error.issues);
  return raw as z.infer<S>;
}

/** Rules with the "Ajustes" tab applied on top of reglas.json. */
export function applyRulesOverride(base: RulesData, override: RulesOverride): RulesData {
  const rules: RulesData = structuredClone(base);
  if (override.suplentes !== undefined) rules.convocatoria.suplentes = override.suplentes;
  if (override.minutosMarcador !== undefined) rules.partido.minutosMarcador = override.minutosMarcador;
  if (override.posesionPrimera !== undefined) rules.posesion.primera = override.posesionPrimera;
  if (override.posesionSegunda !== undefined) rules.posesion.segunda = override.posesionSegunda;
  if (override.exclusionSegundos !== undefined) rules.exclusion.segundos = override.exclusionSegundos;
  if (override.modoTarjetas !== undefined) rules.modoTarjetas = override.modoTarjetas;
  // The user thinks in "real seconds per period"; the engine wants a clock speed factor.
  if (override.segundosRealesPeriodo !== undefined) {
    rules.velocidadRelojes.partido = (rules.partido.minutosMarcador * 60) / override.segundosRealesPeriodo;
  }
  return rules;
}

export interface Phrase {
  /** Team ID, referee ID or player dorsal this phrase is for; empty = anyone. */
  target: string;
  text: string;
}

type RawPhrases = Record<string, { para?: string; frase?: string }[] | undefined>;

function phrasesOf(...sources: RawPhrases[]): Record<string, Phrase[]> {
  const out: Record<string, Phrase[]> = {};
  for (const source of sources) {
    for (const [type, list] of Object.entries(source)) {
      out[type] = (list ?? []).flatMap((item) => (item.frase ? [{ target: item.para ?? '', text: item.frase }] : []));
    }
  }
  return out;
}

export interface GameData {
  club: Club;
  ourTeam: Team;
  rivals: Team[];
  referees: Referee[];
  cup: CupData;
  rules: RulesData;
  formations: FormationsData;
  tuning: typeof tuningJson;
  /** Humour and Emilio's lines by type (`victoria`, `derrota`, `gol`, `emilio_previa`…). */
  phrases: Record<string, Phrase[]>;
  status: DataStatus;
}

/** A line of the given type, preferring the ones written for this target. `{rival}` is filled in. */
export function pickPhrase(data: GameData, type: string, random: () => number, target = '', rival = ''): string {
  const all = data.phrases[type] ?? [];
  const specific = all.filter((p) => p.target !== '' && p.target === target);
  const pool = specific.length > 0 ? specific : all.filter((p) => p.target === '');
  const chosen = pool[Math.floor(random() * pool.length)];
  return chosen ? chosen.text.replaceAll('{rival}', rival) : '';
}

export function loadGameData(): GameData {
  const rosters = new Map<string, RosterData>();
  for (const [file, raw] of Object.entries(rosterModules)) {
    const roster = checked(file, RosterSchema, raw);
    rosters.set(roster.equipoId, roster);
  }

  const ourTeamData = checked('equipo.json', OurTeamSchema, ourTeamJson);
  const club = toClub(checked('club.json', ClubSchema, clubJson));
  const ourTeam: Team = {
    id: ourTeamData.id,
    name: ourTeamData.nombre,
    code: ourTeamData.siglas,
    inCup: true,
    emilioTips: [],
    players: ourTeamData.jugadores.map(toPlayer),
    origin: 'real',
  };
  if (ourTeamData.escudo) ourTeam.shield = ourTeamData.escudo;

  const rules = applyRulesOverride(
    checked('reglas.json', RulesSchema, rulesJson),
    checked('reglas.ajustes.json', RulesOverrideSchema, rulesOverrideJson),
  );

  return {
    club,
    ourTeam,
    rivals: checked('equipos.json', RivalTeamSchema.array(), teamsJson).map((team) => toRivalTeam(team, rosters.get(team.id))),
    referees: checked('arbitros.json', RefereeSchema.array(), refereesJson).map(toReferee),
    cup: checked('copa.json', CupSchema, cupJson),
    rules,
    formations: checked('formaciones.json', FormationsSchema, formationsJson),
    tuning: tuningJson,
    phrases: phrasesOf(humorJson as RawPhrases, emilioJson as RawPhrases),
    status: checked('estado.json', DataStatusSchema, statusJson),
  };
}
