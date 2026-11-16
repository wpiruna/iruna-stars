/**
 * `npm run sim [-- partidos=20 periodo=480 velocidad=3.2 arbitro=prov-estricto]`: AI against AI
 * without a screen, to check that matches always finish and to tune the balance (goals, shots,
 * turnovers, time per phase, fouls, exclusions, penalties, cards). Uses the generated rival squads
 * and referees in data/, so levels, styles and referee profiles are the real ones.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Rng } from '../../src/core/rng';
import { toReferee, toRivalTeam, type Player, type Referee, type Team } from '../../src/data/model';
import { FormationsSchema, RefereeSchema, RivalTeamSchema, RosterSchema, RulesSchema } from '../../src/data/schema';
import { pickLineup } from '../../src/sim/attack/formation';
import { pickKeeper } from '../../src/sim/duel/shootout';
import { fieldFromRules } from '../../src/sim/field';
import { Match } from '../../src/sim/match/match';
import type { MatchPhase } from '../../src/sim/match/types';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (file: string): unknown => JSON.parse(fs.readFileSync(path.join(root, 'data', file), 'utf8'));
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=') as [string, string]));
const matches = Number(args.partidos ?? 20);
const tuning = read('tuning.json') as typeof import('../../data/tuning.json');
const rules = RulesSchema.parse(read('reglas.json'));
const periodSeconds = Number(args.periodo ?? rules.partido.minutosMarcador * 60);
const clockSpeed = Number(args.velocidad ?? rules.velocidadRelojes.partido);
const formations = FormationsSchema.parse(read('formaciones.json'));
const field = fieldFromRules(rules);

const teams: Team[] = RivalTeamSchema.array()
  .parse(read('equipos.json'))
  .map((t) => toRivalTeam(t, RosterSchema.parse(read(`generado/rivales/${t.id}.json`))));
const SLOTS = ['boya', 'extremoIzq', 'extremoDer', 'lateralIzq', 'lateralDer', 'cierre'] as const;
const sideOf = (team: Team) => {
  const field = [...pickLineup(team.players, [...SLOTS]).keys()] as Player[];
  const bench = team.players.filter((p) => p.position !== 'goalkeeper' && !field.includes(p)).slice(0, rules.convocatoria.suplentes);
  return { team, field, bench, keeper: pickKeeper(team), human: false };
};
const referees: Referee[] = RefereeSchema.array().parse(read('arbitros.json')).map(toReferee);
const chosenReferee = args.arbitro ? referees.find((r) => r.id === args.arbitro) : undefined;
if (args.arbitro && !chosenReferee) throw new Error(`No hay ningún árbitro con id ${args.arbitro}: ${referees.map((r) => r.id).join(', ')}`);
const fouls = { fouls: 0, exclusions: 0, penalties: 0, penaltyGoals: 0, manUp: 0, manUpGoals: 0, yellows: 0, reds: 0, subs: 0, held: 0, played: 0 };
const byReferee: Record<string, { matches: number; exclusions: number; fouls: number; againstUs: number; againstThem: number }> = {};
const motives: Record<string, number> = {};

const rng = new Rng(String(args.semilla ?? 'sim'));
const totals = { goals: 0, shots: 0, onTarget: 0, turnovers: 0, counters: 0, finished: 0, higherWins: 0, decided: 0, draws: 0 };
const phaseTime: Partial<Record<MatchPhase, number>> = {};
const reasons: Record<string, number> = {};
const shotsBy: Record<string, number> = {};
const goalsBy: Record<string, number> = {};
let possessions = 0;
let passes = 0;
let missedPasses = 0;
let riskSum = 0;
const scores: number[] = [];
const started = Date.now();

for (let i = 0; i < matches; i++) {
  const a = rng.pick(teams);
  let b = rng.pick(teams);
  while (b === a) b = rng.pick(teams);
  const referee = chosenReferee ?? rng.pick(referees);
  const match = new Match({
    field,
    formations,
    sides: [sideOf(a), sideOf(b)],
    rules,
    referee,
    refereeTuning: tuning.arbitro,
    penalty: tuning.penalti,
    periods: rules.partido.periodos,
    periodSeconds,
    clockSpeed,
    possession: { first: rules.posesion.primera, second: rules.posesion.segunda, clockSpeed: rules.velocidadRelojes.posesion },
    tuning: tuning.ataque,
    match: tuning.partido,
    shot: tuning.tiro,
    keeperTuning: tuning.portero,
    tilt: 0.82,
    rng: new Rng(`sim-${i}`),
    difficulty: 'normal',
    tapMs: 180,
    autoSwitch: true,
  });
  const neutral = { x: 0, y: 0, touching: false, shot: false, skill: false };
  let steps = 0;
  const limit = 60 * ((rules.partido.periodos * periodSeconds) / clockSpeed + 600);
  let shotPhase = '';
  let pending = false;
  while (match.phase !== 'fullTime' && steps < limit) {
    for (const e of match.step(neutral)) {
      if (e.type === 'pass') {
        passes++;
        riskSum += e.risk;
        pending = !e.intercepted;
      } else if (e.type === 'catch' || e.type === 'intercept') pending = false;
      else if (e.type === 'looseWon' && pending) {
        missedPasses++;
        pending = false;
      }
      if (e.type === 'foul') {
        motives[`${e.sanction}:${e.motive}`] = (motives[`${e.sanction}:${e.motive}`] ?? 0) + 1;
        if (e.card === 'yellow') fouls.yellows++;
        if (e.card === 'red' || e.sanction === 'violent') fouls.reds++;
      } else if (e.type === 'substitution') fouls.subs++;
      else if (e.type === 'heldCall') fouls.held++;
      else if (e.type === 'advantagePlayed') fouls.played++;
      else if (e.type === 'penalty') shotPhase = 'penalty';
      if (e.type === 'possession') {
        possessions++;
        reasons[e.reason] = (reasons[e.reason] ?? 0) + 1;
      } else if (e.type === 'release') {
        if (match.phase !== 'penalty') shotPhase = match.phase;
        shotsBy[shotPhase] = (shotsBy[shotPhase] ?? 0) + 1;
      } else if (e.type === 'goal') goalsBy[shotPhase] = (goalsBy[shotPhase] ?? 0) + 1;
    }
    phaseTime[match.phase] = (phaseTime[match.phase] ?? 0) + 1 / 60;
    steps++;
  }
  if (match.phase === 'fullTime') totals.finished++;
  const refStats = (byReferee[referee.id] ??= { matches: 0, exclusions: 0, fouls: 0, againstUs: 0, againstThem: 0 });
  refStats.matches++;
  refStats.againstUs += match.stats[0].exclusions + match.stats[0].penalties;
  refStats.againstThem += match.stats[1].exclusions + match.stats[1].penalties;
  for (const side of [0, 1] as const) {
    const s = match.stats[side];
    fouls.fouls += s.fouls;
    fouls.exclusions += s.exclusions;
    fouls.penalties += s.penalties;
    fouls.manUp += s.manUp;
    fouls.manUpGoals += s.manUpGoals;
    refStats.exclusions += s.exclusions;
    refStats.fouls += s.fouls;
    totals.goals += s.goals;
    totals.shots += s.shots;
    totals.onTarget += s.onTarget;
    totals.turnovers += s.turnovers;
    totals.counters += s.counterattacks;
    scores.push(s.goals);
  }
  const [ga, gb] = match.score;
  if (ga === gb) totals.draws++;
  else if ((a.level ?? 5) !== (b.level ?? 5)) {
    totals.decided++;
    const higherIsA = (a.level ?? 5) > (b.level ?? 5);
    if ((ga > gb) === higherIsA) totals.higherWins++;
  }
  const [s0, s1] = match.stats;
  console.log(
    `${String(i + 1).padStart(3)} ${a.code} (${a.level}) ${ga}–${gb} ${b.code} (${b.level})  tiros ${s0.shots}/${s1.shots}  pérdidas ${s0.turnovers}/${s1.turnovers}  contras ${s0.counterattacks}/${s1.counterattacks}  excl ${s0.exclusions}/${s1.exclusions}  pen ${s0.penalties}/${s1.penalties}  ${referee.name}`,
  );
}

const n = matches * 2;
const live = (phaseTime.transition ?? 0) + (phaseTime.positional ?? 0);
console.log('');
console.log(`Partidos terminados: ${totals.finished}/${matches} · ${((Date.now() - started) / 1000).toFixed(0)} s de cálculo`);
console.log(`Goles por equipo: ${(totals.goals / n).toFixed(1)} (mín ${Math.min(...scores)}, máx ${Math.max(...scores)}) · objetivo orientativo ${2 * rules.partido.periodos}–${4 * rules.partido.periodos} (8–16 en cuatro periodos)`);
console.log(`Tiros por equipo: ${(totals.shots / n).toFixed(1)} · a puerta ${((100 * totals.onTarget) / Math.max(1, totals.shots)).toFixed(0)} % · conversión ${((100 * totals.goals) / Math.max(1, totals.shots)).toFixed(0)} %`);
console.log(`Pérdidas por equipo: ${(totals.turnovers / n).toFixed(1)} · contraataques con superioridad: ${(totals.counters / n).toFixed(1)}`);
console.log(`Empates: ${totals.draws} · gana el de más nivel: ${totals.higherWins}/${totals.decided}`);
console.log(`Posesiones por equipo: ${(possessions / n).toFixed(1)} · duración media ${(live / possessions).toFixed(1)} s · cambios por: ${Object.entries(reasons).map(([k, v]) => `${k} ${(v / n).toFixed(1)}`).join(', ')}`);
console.log(`Pases por equipo: ${(passes / n).toFixed(1)} · riesgo medio ${(riskSum / Math.max(1, passes)).toFixed(3)} · pases que no llegan al receptor: ${(missedPasses / n).toFixed(1)}`);
console.log(`Tiros por fase: ${Object.entries(shotsBy).map(([k, v]) => `${k} ${(v / n).toFixed(1)} (goles ${((goalsBy[k] ?? 0) / n).toFixed(1)})`).join(' · ')}`);
console.log(`Tiempo con el balón en juego: transición ${((100 * (phaseTime.transition ?? 0)) / live).toFixed(0)} % · posicional ${((100 * (phaseTime.positional ?? 0)) / live).toFixed(0)} %`);
console.log('');
console.log(`Faltas ordinarias por equipo: ${(fouls.fouls / n).toFixed(1)} · exclusiones: ${(fouls.exclusions / n).toFixed(1)} · penaltis: ${(fouls.penalties / n).toFixed(2)}`);
console.log(`Superioridades por equipo: ${(fouls.manUp / n).toFixed(1)} · goles en superioridad ${(fouls.manUpGoals / n).toFixed(1)} (${((100 * fouls.manUpGoals) / Math.max(1, fouls.manUp)).toFixed(0)} %) · goles de penalti ${((goalsBy.penalty ?? 0) / n).toFixed(2)} de ${((shotsBy.penalty ?? 0) / n).toFixed(2)}`);
console.log(`Tarjetas por partido: amarillas ${(fouls.yellows / matches).toFixed(2)} · rojas ${(fouls.reds / matches).toFixed(2)} · cambios por expulsión ${(fouls.subs / matches).toFixed(2)} · ventajas: ${fouls.held} esperadas, ${fouls.played} sin pitar por gol`);
console.log(`Motivos: ${Object.entries(motives).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${(v / matches).toFixed(2)}`).join(' · ')}`);
console.log('Por árbitro (exclusiones y penaltis por partido; "nos" = equipo 0):');
for (const r of referees) {
  const x = byReferee[r.id];
  if (!x) continue;
  console.log(`  ${r.name.padEnd(14)} ${String(x.matches).padStart(3)} partidos · ${(x.exclusions / x.matches).toFixed(1)} excl. · ${(x.fouls / x.matches).toFixed(1)} ordinarias · contra "nos" ${(x.againstUs / x.matches).toFixed(1)} / contra el otro ${(x.againstThem / x.matches).toFixed(1)} (sesgo ${r.bias})`);
}
