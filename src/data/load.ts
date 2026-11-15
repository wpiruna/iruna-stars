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

export interface GameData {
  club: Club;
  ourTeam: Team;
  rivals: Team[];
  referees: Referee[];
  cup: CupData;
  rules: RulesData;
  formations: FormationsData;
  tuning: typeof tuningJson;
  status: DataStatus;
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
    status: checked('estado.json', DataStatusSchema, statusJson),
  };
}
