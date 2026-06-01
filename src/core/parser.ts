import ExcelJS from 'exceljs';
import type { LocaleFields, LocalizedRow } from './domain.js';
import type { CollectionImport } from './orchestrator.js';
import type { ReferenceCollectionSpec } from './reference-collections.js';
import { REFERENCE_COLLECTIONS, referenceSpec } from './reference-collections.js';
import { MissingColumnError, SheetNotFoundError } from './errors.js';
import { cellValue, readHeader } from './cells.js';

/**
 * Reads one reference-collection sheet and returns its rows as LocalizedRows,
 * driven by the collection's declarative spec. Paired fields (`<attr>_en` /
 * `<attr>_de`) split across locales; single fields (one bare `<attr>` column)
 * land on the `en` base payload only.
 */
export async function parseReferenceSheet(
  filePath: string,
  spec: ReferenceCollectionSpec,
): Promise<LocalizedRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  return parseWorksheet(workbook, spec);
}

/**
 * Reads the workbook once and parses every registered reference collection,
 * returning them in the registry's order. The result feeds the orchestrator's
 * truncate-all-then-create-all sequencing.
 */
export async function parseAllReferences(filePath: string): Promise<CollectionImport[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  return REFERENCE_COLLECTIONS.map((spec) => ({
    collection: spec.collection,
    rows: parseWorksheet(workbook, spec),
  }));
}

/** Reads the `microorganism` sheet. Thin wrapper kept for the walking-skeleton CLI path. */
export function parseMicroorganismSheet(filePath: string): Promise<LocalizedRow[]> {
  return parseReferenceSheet(filePath, referenceSpec('microorganism'));
}

function parseWorksheet(workbook: ExcelJS.Workbook, spec: ReferenceCollectionSpec): LocalizedRow[] {
  const sheet = workbook.getWorksheet(spec.collection);
  if (!sheet) {
    throw new SheetNotFoundError(spec.collection);
  }

  const headers = readHeader(sheet);
  const columnsFor = resolveColumns(spec, headers);

  const rows: LocalizedRow[] = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    rows.push(buildRow(spec, columnsFor, sheet.getRow(r)));
  }
  return rows;
}

/** Resolves, and validates the presence of, every column each field needs. */
function resolveColumns(
  spec: ReferenceCollectionSpec,
  headers: Map<string, number>,
): Map<string, number> {
  const columns = new Map<string, number>();
  for (const field of spec.fields) {
    const names = field.paired ? [`${field.attr}_en`, `${field.attr}_de`] : [field.attr];
    for (const name of names) {
      const col = headers.get(name);
      if (col === undefined) {
        throw new MissingColumnError(spec.collection, name);
      }
      columns.set(name, col);
    }
  }
  return columns;
}

function buildRow(
  spec: ReferenceCollectionSpec,
  columns: Map<string, number>,
  row: ExcelJS.Row,
): LocalizedRow {
  const en: LocaleFields = { name: '' };
  const de: LocaleFields = { name: '' };
  let hasDe = false;

  for (const field of spec.fields) {
    if (field.paired) {
      const enValue = cellValue(row, columns.get(`${field.attr}_en`)!);
      const deValue = cellValue(row, columns.get(`${field.attr}_de`)!);
      if (enValue !== undefined) {
        setField(en, field.attr, enValue);
      }
      if (deValue !== undefined) {
        setField(de, field.attr, deValue);
        if (field.attr === 'name') {
          hasDe = true;
        }
      }
    } else {
      // Non-localized single column: lives on the en base payload only.
      const value = cellValue(row, columns.get(field.attr)!);
      if (value !== undefined) {
        setField(en, field.attr, value);
      }
    }
  }

  return hasDe ? { en, de } : { en };
}

function setField(fields: LocaleFields, attr: string, value: string): void {
  (fields as unknown as Record<string, string>)[attr] = value;
}
