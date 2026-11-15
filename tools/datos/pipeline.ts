/**
 * `npm run datos`: sheet → validation → merge with the provisional pack → rival rosters →
 * images → JSON files in /data and data/INFORME_DATOS.md. Bad data never makes it fail.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  LABELS,
  RosterSchema,
  RulesSchema,
  type DataStatus,
  type PhraseData,
  type RosterData,
  type RulesData,
} from '../../src/data/schema';
import { ImageIndex } from '../imagenes/indice';
import { generateIcons, processImages } from '../imagenes/procesar';
import { GENERATOR_VERSION, generateRoster } from '../rivales/generar';
import { convertWorkbook } from './convertir';
import { mergeData, type Merged, type ProvisionalPack } from './fusionar';
import { buildReport } from './informe';
import { findWorkbook, readWorkbook, type RawSheet } from './leer-hoja';

export interface PipelineOptions {
  /** Project root: contains datos/, assets/ and data/. */
  root: string;
  /** Process images and icons (slow). Tests switch it off. */
  images?: boolean;
  /** Team IDs whose saved roster must be regenerated, or 'todos'. */
  regenerate?: string[] | 'todos';
}

export interface PipelineResult {
  merged: Merged;
  status: DataStatus;
  report: string;
  rosters: Map<string, RosterData>;
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

export function loadProvisionalPack(root: string): ProvisionalPack {
  const dir = path.join(root, 'data', 'provisional');
  return {
    equipo: readJson(path.join(dir, 'equipo.json')),
    equipos: readJson(path.join(dir, 'equipos.json')),
    arbitros: readJson(path.join(dir, 'arbitros.json')),
    club: readJson(path.join(dir, 'club.json')),
    frases: readJson(path.join(dir, 'frases.json')),
  };
}

export function loadRules(root: string): RulesData {
  return RulesSchema.parse(readJson(path.join(root, 'data', 'reglas.json')));
}

/** Loads the saved roster of every team, generating (and saving) the ones that do not exist. */
function ensureRosters(
  root: string,
  merged: Merged,
  regenerate: PipelineOptions['regenerate'],
): { rosters: Map<string, RosterData>; notes: string[] } {
  const dir = path.join(root, 'data', 'generado', 'rivales');
  fs.mkdirSync(dir, { recursive: true });
  const rosters = new Map<string, RosterData>();
  const notes: string[] = [];

  for (const team of merged.teams) {
    const file = path.join(dir, `${team.id}.json`);
    const forced = regenerate === 'todos' || (Array.isArray(regenerate) && regenerate.includes(team.id));
    let roster: RosterData | null = null;

    if (fs.existsSync(file) && !forced) {
      const parsed = RosterSchema.safeParse(readJson(file));
      if (parsed.success) roster = parsed.data;
      else notes.push(`${team.nombre}: la plantilla guardada estaba dañada y se ha vuelto a generar.`);
    }
    if (roster === null) {
      roster = generateRoster({ id: team.id, nivel: team.nivel, estilo: team.estilo });
      writeJson(file, roster);
      notes.push(
        forced
          ? `${team.nombre}: plantilla regenerada (nivel ${team.nivel}, estilo ${LABELS.estilo[team.estilo]}).`
          : `${team.nombre}: plantilla nueva generada (nivel ${team.nivel}, estilo ${LABELS.estilo[team.estilo]}).`,
      );
    } else if (roster.nivel !== team.nivel || roster.estilo !== team.estilo) {
      notes.push(
        `${team.nombre}: su plantilla se generó con nivel ${roster.nivel} y estilo ${LABELS.estilo[roster.estilo]}, y ahora la hoja dice ` +
          `nivel ${team.nivel} y estilo ${LABELS.estilo[team.estilo]}. Se mantiene la guardada; para rehacerla: ` +
          `\`npm run rivales -- --regenerar ${team.id}\`.`,
      );
    } else if (roster.versionGenerador !== GENERATOR_VERSION) {
      notes.push(`${team.nombre}: plantilla de una versión anterior del generador; se mantiene.`);
    }
    rosters.set(team.id, roster);
  }
  return { rosters, notes };
}

/** Drops references to images that could not be processed, so a placeholder is drawn instead. */
function dropImageKeys(merged: Merged, failed: Set<string>): void {
  if (failed.size === 0) return;
  for (const player of merged.team.jugadores) player.fotos = player.fotos.filter((key) => !failed.has(key));
  if (merged.team.escudo && failed.has(merged.team.escudo)) delete merged.team.escudo;
  for (const team of merged.teams) if (team.escudo && failed.has(team.escudo)) delete team.escudo;
  for (const referee of merged.referees) if (referee.foto && failed.has(referee.foto)) delete referee.foto;
  if (merged.club.fotoPresidente && failed.has(merged.club.fotoPresidente)) delete merged.club.fotoPresidente;
  if (merged.club.logo && failed.has(merged.club.logo)) delete merged.club.logo;
}

function groupPhrases(phrases: PhraseData[], types: readonly string[]): Record<string, Omit<PhraseData, 'tipo'>[]> {
  const out: Record<string, Omit<PhraseData, 'tipo'>[]> = {};
  for (const type of types) {
    out[type] = phrases.filter((p) => p.tipo === type).map(({ para, frase, origen }) => ({ para, frase, origen }));
  }
  return out;
}

export async function runPipeline(options: PipelineOptions): Promise<PipelineResult> {
  const { root } = options;
  const withImages = options.images ?? true;
  const dataDir = path.join(root, 'data');

  // 1. Sheet. An unreadable file is treated as "no sheet" and reported.
  const found = findWorkbook(root);
  let sheets: RawSheet[] | null = null;
  const pipelineWarnings: { pestana: string; mensaje: string }[] = [];
  if (found.file) {
    try {
      sheets = readWorkbook(found.file);
    } catch (error) {
      pipelineWarnings.push({
        pestana: 'Hoja',
        mensaje: `no se ha podido leer ${path.basename(found.file)} (${error instanceof Error ? error.message : String(error)}); se usan datos provisionales`,
      });
    }
    for (const ignored of found.ignored) {
      pipelineWarnings.push({
        pestana: 'Hoja',
        mensaje: `hay más de una hoja en datos/; se usa ${path.basename(found.file)} (la más reciente) y se ignora ${ignored}`,
      });
    }
  }

  // 2–3. Convert and merge.
  const converted = convertWorkbook(sheets);
  const images = new ImageIndex(path.join(root, 'assets'));
  const merged = mergeData(converted, loadProvisionalPack(root), loadRules(root), images);
  merged.warnings.unshift(...pipelineWarnings);

  // 4. Images (before writing JSON, so broken ones fall back to placeholders).
  if (withImages) {
    const result = await processImages(merged.imageJobs, path.join(root, 'data', 'generado', 'img'), root);
    dropImageKeys(merged, new Set(result.failed.map((f) => f.key)));
    for (const failure of result.failed) {
      merged.warnings.push({
        pestana: 'Imágenes',
        mensaje: `${failure.source} no se ha podido leer (${failure.error}); se usa una genérica`,
      });
    }
    for (const note of result.notes) merged.warnings.push({ pestana: 'Imágenes', mensaje: `${note.source}: ${note.note}` });
    const shield = merged.imageJobs.find((job) => job.key === 'escudo-nuestro' && result.written.includes(job.key));
    await generateIcons(shield?.source ?? null, path.join(root, 'public', 'icons'));
  }

  // 5. Rival rosters.
  const { rosters, notes: rosterNotes } = ensureRosters(root, merged, options.regenerate);

  // 6. Status and report.
  const real = <T extends { origen: string }>(items: T[]): number => items.filter((i) => i.origen === 'real').length;
  const status: DataStatus = {
    generado: new Date().toISOString(),
    hoja: found.file && sheets ? path.relative(root, found.file).split(path.sep).join('/') : null,
    jugadores: { reales: real(merged.team.jugadores), provisionales: merged.team.jugadores.length - real(merged.team.jugadores) },
    equipos: { reales: real(merged.teams), provisionales: merged.teams.length - real(merged.teams) },
    arbitros: { reales: real(merged.referees), provisionales: merged.referees.length - real(merged.referees) },
    frases: { reales: real(merged.phrases), provisionales: merged.phrases.length - real(merged.phrases) },
    barrasVacias: merged.emptyBars,
    jugadoresSinBarras: merged.playersWithoutBars,
    imagenesFaltantes: merged.missingImages,
    imagenesSobrantes: merged.extraImages,
    avisos: merged.warnings,
    privacidad: converted.privacy,
  };
  const report = buildReport(status, rosterNotes);

  // 7. Write everything.
  writeJson(path.join(dataDir, 'equipo.json'), merged.team);
  writeJson(path.join(dataDir, 'equipos.json'), merged.teams);
  writeJson(path.join(dataDir, 'arbitros.json'), merged.referees);
  writeJson(path.join(dataDir, 'copa.json'), merged.cup);
  writeJson(path.join(dataDir, 'generado', 'club.json'), merged.club);
  writeJson(path.join(dataDir, 'generado', 'reglas.ajustes.json'), merged.rulesOverride);
  writeJson(path.join(dataDir, 'generado', 'estado.json'), status);
  writeJson(
    path.join(dataDir, 'textos', 'emilio.json'),
    groupPhrases(merged.phrases, ['emilio_previa', 'emilio_tiempo_muerto', 'emilio_cambio']),
  );
  writeJson(
    path.join(dataDir, 'textos', 'humor.json'),
    groupPhrases(merged.phrases, ['banquillo', 'gol', 'arbitro', 'victoria', 'derrota']),
  );
  fs.writeFileSync(path.join(dataDir, 'INFORME_DATOS.md'), report);

  return { merged, status, report, rosters };
}
