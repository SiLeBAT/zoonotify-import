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

/** Returns the trimmed cell text, or `undefined` for an empty/blank/sentinel cell. */
export function cellValue(row: ExcelJS.Row, col: number): string | undefined {
  const value = row.getCell(col).value;
  if (value === null || value === undefined) {
    return undefined;
  }
  const text = String(value).trim();
  return SENTINELS.has(text) ? undefined : text;
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
