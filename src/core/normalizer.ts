import ExcelJS from 'exceljs';
import type {
  AttrValue,
  FactImport,
  FactRelationRef,
  LocalizedRow,
  ParsedFactRow,
} from './domain.js';
import type { CollectionImport } from './orchestrator.js';
import type { ScalarType } from './fact-collections.js';
import { cellValue, parseNumeric, readHeader } from './cells.js';
import {
  FACT_SOURCES,
  MASTERDATA_REFERENCES,
  MATRIX_DETAIL_SOURCE,
  type FactSourceMap,
  type MasterdataPair,
} from './source-map.js';

/**
 * Front-end adapter of the 3-sheet contract (ADR 0007). Reads the steward's
 * native workbook (`masterdata` + `amr_resrate` + `prevalence`) and produces the
 * canonical in-memory model the rest of the import core already consumes — so
 * relation resolution, bulk-create, throughput, and orchestration are unchanged.
 *
 * The normalizer is **lenient about structure**: a missing sheet or column yields
 * an empty result for that slice rather than throwing. Structural validation is
 * the job of the (two-layer) pre-flight checks, not the normalizer.
 */

/**
 * Builds the ten reference-collection imports: the nine `masterdata` pairs plus
 * `matrix-detail` harvested from the fact sheets.
 */
export function normalizeReferences(workbook: ExcelJS.Workbook): CollectionImport[] {
  const masterdata = MASTERDATA_REFERENCES.map((pair) => ({
    collection: pair.collection,
    rows: parseMasterdataPair(workbook, pair),
  }));
  return [
    ...masterdata,
    { collection: MATRIX_DETAIL_SOURCE.collection, rows: harvestMatrixDetail(workbook) },
  ];
}

/** Reads the workbook from disk and normalizes its reference collections. */
export async function normalizeReferencesFromFile(path: string): Promise<CollectionImport[]> {
  return normalizeReferences(await readWorkbookFile(path));
}

/** Reads the workbook from disk and normalizes its fact collections. */
export async function normalizeFactsFromFile(path: string): Promise<FactImport[]> {
  return normalizeFacts(await readWorkbookFile(path));
}

async function readWorkbookFile(path: string): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  return workbook;
}

/** Builds the fact-collection imports (`resistance`, `prevalence`) from their source sheets. */
export function normalizeFacts(workbook: ExcelJS.Workbook): FactImport[] {
  return FACT_SOURCES.map((src) => ({
    collection: src.collection,
    rows: parseFactRows(workbook, src),
  }));
}

/** Maps each source-sheet data row to a ParsedFactRow via the fact source map. */
function parseFactRows(workbook: ExcelJS.Workbook, src: FactSourceMap): ParsedFactRow[] {
  const sheet = workbook.getWorksheet(src.sheet);
  if (!sheet) {
    return [];
  }
  const headers = readHeader(sheet);

  const rows: ParsedFactRow[] = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);

    // Scalars: one source column, shared into both locale payloads.
    const en: Record<string, AttrValue> = {};
    const de: Record<string, AttrValue> = {};
    for (const scalar of src.scalars) {
      const col = headers.get(scalar.column);
      if (col === undefined) {
        continue;
      }
      const value = coerce(cellValue(row, col), scalar.type);
      if (value !== undefined) {
        en[scalar.attr] = value;
        de[scalar.attr] = value;
      }
    }

    // Relations: kept by name+locale for the relation map. DE presence drives hasDe.
    const relations: FactRelationRef[] = [];
    let hasDe = false;
    for (const rel of src.relations) {
      const ref: FactRelationRef = { attr: rel.attr, collection: rel.collection };
      const enCol = headers.get(rel.en);
      const deCol = headers.get(rel.de);
      const enName = enCol === undefined ? undefined : cellValue(row, enCol);
      const deName = deCol === undefined ? undefined : cellValue(row, deCol);
      if (enName !== undefined) {
        ref.en = enName;
      }
      if (deName !== undefined) {
        ref.de = deName;
        hasDe = true;
      }
      relations.push(ref);
    }

    rows.push({ rowNumber: r, hasDe, scalars: { en, de }, relations });
  }
  return rows;
}

/** Coerces a raw cell string to the scalar's declared type (comma decimals normalized). */
function coerce(value: string | undefined, type: ScalarType): AttrValue | undefined {
  if (value === undefined) {
    return undefined;
  }
  return type === 'string' ? value : parseNumeric(value, type);
}

/** Distinct, first-seen `Matrixdetail` values unioned across both fact sheets, en-only. */
function harvestMatrixDetail(workbook: ExcelJS.Workbook): LocalizedRow[] {
  const rows: LocalizedRow[] = [];
  const seen = new Set<string>();
  for (const sheetName of MATRIX_DETAIL_SOURCE.sheets) {
    const sheet = workbook.getWorksheet(sheetName);
    if (!sheet) {
      continue;
    }
    const col = readHeader(sheet).get(MATRIX_DETAIL_SOURCE.column);
    if (col === undefined) {
      continue;
    }
    for (let r = 2; r <= sheet.rowCount; r++) {
      const name = cellValue(sheet.getRow(r), col);
      if (name === undefined || seen.has(name)) {
        continue;
      }
      seen.add(name);
      rows.push({ en: { name } });
    }
  }
  return rows;
}

/** Distinct (EN, DE) rows of one `masterdata` column pair, blank rows skipped. */
function parseMasterdataPair(workbook: ExcelJS.Workbook, pair: MasterdataPair): LocalizedRow[] {
  const sheet = workbook.getWorksheet('masterdata');
  if (!sheet) {
    return [];
  }
  const headers = readHeader(sheet);
  const enCol = headers.get(pair.en);
  const deCol = headers.get(pair.de);
  if (enCol === undefined || deCol === undefined) {
    return [];
  }

  const rows: LocalizedRow[] = [];
  const seen = new Set<string>();
  for (let r = 2; r <= sheet.rowCount; r++) {
    const en = cellValue(sheet.getRow(r), enCol);
    const de = cellValue(sheet.getRow(r), deCol);
    if (en === undefined && de === undefined) {
      continue;
    }
    const key = `${en ?? ''}||${de ?? ''}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    rows.push(
      de === undefined ? { en: { name: en ?? '' } } : { en: { name: en ?? '' }, de: { name: de } },
    );
  }
  return rows;
}
