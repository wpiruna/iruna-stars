/** Text helpers for tolerant spreadsheet reading. */

/** Lowercase, no accents, punctuation → spaces, collapsed. "Precisión " → "precision". */
export function normalize(value: unknown): string {
  return cellText(value)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Cell → trimmed text. Numbers keep their natural form (7, not "7.0"). */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  return String(value).replace(/\s+/g, ' ').trim();
}

/** "CN Ejemplo Ñ" → "cn-ejemplo-n". Used for IDs and output file names. */
export function slugify(value: unknown): string {
  return normalize(value).replace(/ /g, '-');
}

/** Number from a cell: accepts 7, "7", "7,5". Returns null when it is not a number. */
export function cellNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = cellText(value).replace(',', '.');
  if (text === '' || !/^[-+]?\d+(\.\d+)?$/.test(text)) return null;
  return Number(text);
}

/** Leading signed integer of a text: "+3 Muy en contra" → 3, "-2 A favor" → -2. */
export function leadingInt(value: unknown): number | null {
  if (typeof value === 'number') return Number.isInteger(value) ? value : null;
  const match = /^\s*([-+−]?\d+)/.exec(cellText(value));
  if (!match || match[1] === undefined) return null;
  return Number(match[1].replace('−', '-'));
}

/** Natural, accent-insensitive comparison for file names. */
export function compareNames(a: string, b: string): number {
  return a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' });
}
