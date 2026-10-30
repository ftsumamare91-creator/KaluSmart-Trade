/**
 * CSV building for report exports. Pure functions, no I/O.
 * - Cells that a spreadsheet would read as a formula (starting with = + - @, tab or carriage return) get a leading
 *   apostrophe, so user-typed text such as "=HYPERLINK(...)" is shown as text, not run.
 * - Output starts with a UTF-8 byte-order mark so Excel shows Amharic correctly.
 * - Values are quoted when needed (comma, quote, line break), with quotes doubled.
 */

const FORMULA_START = /^[=+\-@\t\r]/;

export function safeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = value instanceof Date ? value.toISOString() : String(value);
  if (FORMULA_START.test(s)) s = `'${s}`;
  return s;
}

export function csvField(value: unknown): string {
  const s = safeCell(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvField).join(',')];
  for (const row of rows) lines.push(row.map(csvField).join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/** A filename made only of letters, digits, dashes and dots. Never includes user-entered text. */
export function safeFilename(parts: string[]): string {
  return parts.map((p) => p.replace(/[^A-Za-z0-9-]/g, '')).filter(Boolean).join('_') + '.csv';
}
