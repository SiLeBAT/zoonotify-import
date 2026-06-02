import ExcelJS from 'exceljs';
import type { AttrValue, FactRelationRef, ParsedFactRow } from './domain.js';
import type { FactCollectionSpec, FactScalarField, ScalarType } from './fact-collections.js';
import { FACT_COLLECTIONS } from './fact-collections.js';
import { MissingColumnError, SheetNotFoundError } from './errors.js';
import { cellValue, readHeader } from './cells.js';

export interface ParseFactOptions {
  /** When true, the returned object includes the list of dropped (ignored) columns. */
  reportDropped?: boolean;
}

export interface FactSheetResult {
  rows: ParsedFactRow[];
  /** Ignored columns (per the spec) that were actually present on the sheet. */
  droppedColumns: string[];
}

/** One fact collection's parsed rows, ready for relation resolution + import. */
export interface FactImport {
  collection: string;
  rows: ParsedFactRow[];
  /** Spec-ignored columns that were present on the sheet and dropped (e.g. prevalence's `matrixDetail_*`). */
  droppedColumns?: string[];
}

/**
 * Reads one fact-table sheet into ParsedFactRows, driven by the collection's
 * declarative spec. Scalars are coerced to their declared type (comma decimals
 * normalized); relation columns are kept by name+locale for later resolution.
 * Columns listed in the spec's `ignoredColumns` are dropped if present.
 *
 * Overloads: without options, resolves to `ParsedFactRow[]`; with
 * `{ reportDropped: true }`, resolves to a `FactSheetResult` carrying the
 * dropped-column list so the orchestrator can log it.
 */
export function parseFactSheet(
  filePath: string,
  spec: FactCollectionSpec,
): Promise<ParsedFactRow[]>;
export function parseFactSheet(
  filePath: string,
  spec: FactCollectionSpec,
  options: ParseFactOptions & { reportDropped: true },
): Promise<FactSheetResult>;
export async function parseFactSheet(
  filePath: string,
  spec: FactCollectionSpec,
  options: ParseFactOptions = {},
): Promise<ParsedFactRow[] | FactSheetResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const result = parseWorksheet(workbook, spec);
  return options.reportDropped ? result : result.rows;
}

/**
 * Reads the workbook once and parses every registered fact collection, in
 * registry order. Feeds the orchestrator's fact-table phase.
 */
export async function parseAllFacts(filePath: string): Promise<FactImport[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  return FACT_COLLECTIONS.map((spec) => {
    const { rows, droppedColumns } = parseWorksheet(workbook, spec);
    return { collection: spec.collection, rows, droppedColumns };
  });
}

interface ColumnPlan {
  /** scalar attr → its column(s) */
  scalars: Map<FactScalarField, { en: number; de?: number }>;
  /** relation attr → its en/de columns */
  relations: Map<string, { collection: string; en: number; de: number }>;
}

function parseWorksheet(workbook: ExcelJS.Workbook, spec: FactCollectionSpec): FactSheetResult {
  const sheet = workbook.getWorksheet(spec.collection);
  if (!sheet) {
    throw new SheetNotFoundError(spec.collection);
  }

  const headers = readHeader(sheet);
  const plan = resolveColumns(spec, headers);
  const droppedColumns = collectDroppedColumns(spec, headers);

  const rows: ParsedFactRow[] = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    rows.push(buildRow(spec, plan, sheet.getRow(r), r));
  }
  return { rows, droppedColumns };
}

function resolveColumns(spec: FactCollectionSpec, headers: Map<string, number>): ColumnPlan {
  const scalars = new Map<FactScalarField, { en: number; de?: number }>();
  for (const field of spec.scalars) {
    if (field.paired) {
      scalars.set(field, {
        en: requireColumn(spec, headers, `${field.attr}_en`),
        de: requireColumn(spec, headers, `${field.attr}_de`),
      });
    } else {
      scalars.set(field, { en: requireColumn(spec, headers, field.attr) });
    }
  }

  const relations = new Map<string, { collection: string; en: number; de: number }>();
  for (const field of spec.relations) {
    relations.set(field.attr, {
      collection: field.collection,
      en: requireColumn(spec, headers, `${field.attr}_en`),
      de: requireColumn(spec, headers, `${field.attr}_de`),
    });
  }

  return { scalars, relations };
}

function requireColumn(
  spec: FactCollectionSpec,
  headers: Map<string, number>,
  name: string,
): number {
  const col = headers.get(name);
  if (col === undefined) {
    throw new MissingColumnError(spec.collection, name);
  }
  return col;
}

/** Ignored-column stems (`<stem>`, `<stem>_en`, `<stem>_de`) actually present on the sheet. */
function collectDroppedColumns(spec: FactCollectionSpec, headers: Map<string, number>): string[] {
  const dropped: string[] = [];
  for (const stem of spec.ignoredColumns ?? []) {
    for (const candidate of [stem, `${stem}_en`, `${stem}_de`]) {
      if (headers.has(candidate)) {
        dropped.push(candidate);
      }
    }
  }
  return dropped;
}

function buildRow(
  spec: FactCollectionSpec,
  plan: ColumnPlan,
  row: ExcelJS.Row,
  rowNumber: number,
): ParsedFactRow {
  const en: Record<string, AttrValue> = {};
  const de: Record<string, AttrValue> = {};
  let hasDe = false;

  for (const [field, cols] of plan.scalars) {
    if (field.paired) {
      const enVal = coerce(cellValue(row, cols.en), field.type);
      const deVal = coerce(cellValue(row, cols.de!), field.type);
      if (enVal !== undefined) en[field.attr] = enVal;
      if (deVal !== undefined) {
        de[field.attr] = deVal;
        hasDe = true;
      }
    } else {
      // Single column: shared into both locale payloads.
      const val = coerce(cellValue(row, cols.en), field.type);
      if (val !== undefined) {
        en[field.attr] = val;
        de[field.attr] = val;
      }
    }
  }

  const relations: FactRelationRef[] = [];
  for (const [attr, cols] of plan.relations) {
    const ref: FactRelationRef = { attr, collection: cols.collection };
    const enName = cellValue(row, cols.en);
    const deName = cellValue(row, cols.de);
    if (enName !== undefined) ref.en = enName;
    if (deName !== undefined) {
      ref.de = deName;
      hasDe = true;
    }
    relations.push(ref);
  }

  return { rowNumber, hasDe, scalars: { en, de }, relations };
}

/** Coerces a raw cell string to the field's declared type. `undefined` stays `undefined`. */
function coerce(value: string | undefined, type: ScalarType): AttrValue | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (type === 'string') {
    return value;
  }
  const normalized = value.replace(/,/g, '.');
  const parsed = type === 'integer' ? parseInt(normalized, 10) : parseFloat(normalized);
  return Number.isNaN(parsed) ? undefined : parsed;
}
