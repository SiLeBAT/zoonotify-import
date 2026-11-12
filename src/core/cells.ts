import type ExcelJS from 'exceljs';

/**
 * Shared worksheet-cell helpers for the reference and fact parsers. Columns are
 * identified by header name (row 1), never by position; cell sentinels are
 * treated as "no value". See docs/import-cli-spec/source-xlsx-format.md §2.
 */

/** Maps each row-1 header name to its 1-based column index. */
export function readHeader(sheet: ExcelJS.Worksheet): Map<string, number> {
  const headers = new Map<string, number>();
  sheet.getRow(1).eachCell((cell, col) => {
    headers.set(String(cell.value).trim(), col);
  });
  return headers;
}

/** Cell values treated as "no value". */
const SENTINELS = new Set(['', '-', '_']);

/**
 * Returns the trimmed cell text, or `undefined` for an empty/blank/sentinel cell.
 * A real Excel date cell (ExcelJS reads it as a UTC-midnight `Date`) comes back
 * as ISO date text `YYYY-MM-DD`, the same shape the steward types as text.
 */
export function cellValue(row: ExcelJS.Row, col: number): string | undefined {
  const value = row.getCell(col).value;
  if (value === null || value === undefined) {
    return undefined;
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  return SENTINELS.has(text) ? undefined : text;
}

/** Returns `text` when it is a real calendar date written `YYYY-MM-DD`, else `undefined`. */
export function parseIsoDate(text: string): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) {
    return undefined;
  }
  const [, y, m, d] = match.map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  return date.getUTCMonth() === m! - 1 && date.getUTCDate() === d ? text : undefined;
}

/** Parses a typed (non-string) source cell: numeric or ISO date. */
export function parseTyped(
  text: string,
  type: 'integer' | 'float' | 'date',
): number | string | undefined {
  return type === 'date' ? parseIsoDate(text) : parseNumeric(text, type);
}

/**
 * Parses a numeric cell string to a number, normalizing a comma decimal
 * separator to a dot first (source-xlsx-format.md §2). Returns `undefined` when
 * the text does not parse to a finite number.
 */
export function parseNumeric(text: string, type: 'integer' | 'float'): number | undefined {
  const normalized = text.replace(/,/g, '.');
  const parsed = type === 'integer' ? parseInt(normalized, 10) : parseFloat(normalized);
  return Number.isNaN(parsed) ? undefined : parsed;
}
