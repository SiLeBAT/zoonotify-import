import ExcelJS from 'exceljs';
import type { LocalizedRow } from './domain.js';
import { MissingColumnError, SheetNotFoundError } from './errors.js';

const SHEET = 'microorganism';
const REQUIRED_COLUMNS = ['name_en', 'name_de'] as const;

/** Reads the `microorganism` sheet and returns its rows as LocalizedRows. */
export async function parseMicroorganismSheet(filePath: string): Promise<LocalizedRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const sheet = workbook.getWorksheet(SHEET);
  if (!sheet) {
    throw new SheetNotFoundError(SHEET);
  }

  const headers = readHeader(sheet);
  for (const column of REQUIRED_COLUMNS) {
    if (!headers.has(column)) {
      throw new MissingColumnError(SHEET, column);
    }
  }
  const enCol = headers.get('name_en')!;
  const deCol = headers.get('name_de')!;

  const rows: LocalizedRow[] = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const en = cellString(row.getCell(enCol));
    const de = cellString(row.getCell(deCol));
    const parsed: LocalizedRow = { en: { name: en } };
    if (de !== '') {
      parsed.de = { name: de };
    }
    rows.push(parsed);
  }
  return rows;
}

function readHeader(sheet: ExcelJS.Worksheet): Map<string, number> {
  const headers = new Map<string, number>();
  sheet.getRow(1).eachCell((cell, col) => {
    headers.set(String(cell.value).trim(), col);
  });
  return headers;
}

function cellString(cell: ExcelJS.Cell): string {
  const value = cell.value;
  return value === null || value === undefined ? '' : String(value).trim();
}
