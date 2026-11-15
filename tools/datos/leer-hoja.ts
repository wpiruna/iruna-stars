/** Reads the user's spreadsheet (.xlsx or .ods) into plain tables addressed by column name. */
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { cellText, normalize } from './texto';

export interface RawSheet {
  name: string;
  /** rows[0] is the header row; rows[i] is sheet row i + 1. */
  rows: unknown[][];
}

export const SHEET_EXTENSIONS = ['.xlsx', '.ods'] as const;

/** Finds datos/plantilla.xlsx or .ods. If both exist the most recently modified wins. */
export function findWorkbook(root: string): { file: string | null; ignored: string[] } {
  const dir = path.join(root, 'datos');
  if (!fs.existsSync(dir)) return { file: null, ignored: [] };
  const candidates = fs
    .readdirSync(dir)
    .filter((name) => {
      const ext = path.extname(name).toLowerCase();
      return (
        path.basename(name, path.extname(name)).toLowerCase() === 'plantilla' &&
        (SHEET_EXTENSIONS as readonly string[]).includes(ext)
      );
    })
    .map((name) => {
      const file = path.join(dir, name);
      return { file, mtime: fs.statSync(file).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  const first = candidates[0];
  if (!first) return { file: null, ignored: [] };
  return { file: first.file, ignored: candidates.slice(1).map((c) => path.basename(c.file)) };
}

export function readWorkbook(file: string): RawSheet[] {
  // SheetJS prints harmless "ODS number format" notes to the error stream; keep the output clean.
  const originalError = console.error;
  console.error = () => {};
  let book: XLSX.WorkBook;
  try {
    book = XLSX.read(fs.readFileSync(file), { type: 'buffer' });
  } finally {
    console.error = originalError;
  }
  return book.SheetNames.map((name) => {
    const sheet = book.Sheets[name];
    const rows = sheet
      ? (XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '', blankrows: true }) as unknown[][])
      : [];
    return { name, rows };
  });
}

export interface TableRow {
  /** 1-based row number as the user sees it in the spreadsheet. */
  rowNumber: number;
  /** Raw cell of the first matching column; '' when the column does not exist. */
  get(...columnNames: string[]): unknown;
  text(...columnNames: string[]): string;
}

/** A sheet with a header row. Columns are found by normalized name, in any order. */
export class Table {
  readonly name: string;
  readonly exists: boolean;
  private readonly rows: unknown[][];
  private readonly columns = new Map<string, number>();

  constructor(sheet: RawSheet | undefined, fallbackName: string) {
    this.name = sheet?.name ?? fallbackName;
    this.exists = sheet !== undefined;
    this.rows = sheet?.rows ?? [];
    const header = this.rows[0] ?? [];
    header.forEach((cell, index) => {
      const key = normalize(cell);
      if (key !== '' && !this.columns.has(key)) this.columns.set(key, index);
    });
  }

  hasColumn(name: string): boolean {
    return this.columns.has(normalize(name));
  }

  /** Data rows, skipping the header and fully empty rows. `ignore` lists helper columns (formulas). */
  *dataRows(ignore: string[] = []): Generator<TableRow> {
    const ignored = new Set(ignore.map((name) => this.columns.get(normalize(name))).filter((i) => i !== undefined));
    for (let i = 1; i < this.rows.length; i++) {
      const row = this.rows[i] ?? [];
      const empty = row.every((cell, index) => ignored.has(index) || cellText(cell) === '');
      if (empty) continue;
      const get = (...names: string[]): unknown => {
        for (const name of names) {
          const index = this.columns.get(normalize(name));
          if (index !== undefined) return row[index] ?? '';
        }
        return '';
      };
      yield { rowNumber: i + 1, get, text: (...names) => cellText(get(...names)) };
    }
  }
}

/** Finds a sheet by normalized name ("Árbitros" = "arbitros"). */
export function tableOf(sheets: RawSheet[], name: string): Table {
  const wanted = normalize(name);
  return new Table(
    sheets.find((sheet) => normalize(sheet.name) === wanted),
    name,
  );
}
