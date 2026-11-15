/** Test helpers: build spreadsheets in memory and throwaway project folders. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';
import type { RawSheet } from '../../tools/datos/leer-hoja';

export const PLAYER_HEADER = [
  'Activo', 'Dorsal', 'Mote', 'Nombre', 'Puesto', 'Mano', 'Velocidad', 'Resistencia', 'Potencia', 'Precisión',
  'Pase', 'Habilidad', 'Defensa', 'Agresividad', 'Reflejos', 'Colocación', 'Salida', 'Arquetipo', 'Rasgo',
  'Tiro especial', 'Tipo de tiro especial', 'Celebración', 'Frase', 'Fotos',
];
export const TEAM_HEADER = ['Activo', 'ID', 'Nombre', 'Siglas', 'Nivel', 'Estilo', 'En la Copa', 'Consejo de Emilio', 'Archivo de escudo'];
export const REFEREE_HEADER = [
  'Activo', 'ID', 'Nombre o apodo', 'Tolerancia al contacto', 'Exclusiones', 'Tarjetas', 'Sesgo', 'Regularidad',
  'Frase de presentación', 'Archivo de foto',
];

export type Cells = (string | number)[];

/** A sheet from a header and rows given as objects keyed by column name. */
export function sheet(name: string, header: string[], rows: Record<string, string | number>[]): RawSheet {
  return { name, rows: [header, ...rows.map((row) => header.map((column) => row[column] ?? ''))] };
}

export function playersSheet(rows: Record<string, string | number>[]): RawSheet {
  return sheet('Jugadores', PLAYER_HEADER, rows);
}

/** Writes sheets to a real .xlsx / .ods file. */
export function writeWorkbook(file: string, sheets: RawSheet[]): void {
  const book = XLSX.utils.book_new();
  for (const s of sheets) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(s.rows), s.name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const bookType = file.endsWith('.ods') ? 'ods' : 'xlsx';
  fs.writeFileSync(file, XLSX.write(book, { type: 'buffer', bookType }) as Buffer);
}

const REPO = path.resolve(__dirname, '..', '..');

/** Temp project root with the versioned data the pipeline needs (rules + provisional pack). */
export function tempProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wis-test-'));
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  fs.cpSync(path.join(REPO, 'data', 'provisional'), path.join(root, 'data', 'provisional'), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'data', 'reglas.json'), path.join(root, 'data', 'reglas.json'));
  return root;
}

export function removeProject(root: string): void {
  fs.rmSync(root, { recursive: true, force: true });
}

/** 1×1 PNG, enough for the image index (which only looks at names). */
export function touchImage(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    ),
  );
}
