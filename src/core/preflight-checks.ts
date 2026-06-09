import type ExcelJS from 'exceljs';
import type { CollectionImport } from './orchestrator.js';
import type { FactImport } from './domain.js';
import type { LiveSchema } from './strapi-client.js';
import { cellValue, parseNumeric, readHeader } from './cells.js';
import {
  FACT_SOURCES,
  MASTERDATA_REFERENCES,
  MATRIX_DETAIL_SOURCE,
  type FactSourceMap,
} from './source-map.js';
import { factSpec } from './fact-collections.js';

/**
 * The pre-flight checks for the 3-sheet contract (ADR 0007), in two layers:
 *
 * - **Structural** (#2 sheets present, #3 required columns, #4 cell types) read
 *   the *raw* `masterdata` / `amr_resrate` / `prevalence` sheets, so every finding
 *   names the steward's own sheet and column.
 * - **Semantic** (#5 required fields, #6 uniqueness, #7 relation resolution, #8
 *   locale completeness) read the *normalized* model produced by the normalizer.
 *
 * Every check is pure, never throws, and never fails fast: all findings accumulate
 * so the operator gets the whole list in one pass. See CONTEXT.md § Pre-flight.
 */

export type PreflightLevel = 'error' | 'warning';

export interface PreflightFinding {
  /** Which numbered check (1–10) produced this. */
  check: number;
  level: PreflightLevel;
  /** Source sheet the problem is on, when applicable. */
  sheet?: string;
  /** 1-based worksheet row number, when applicable. */
  row?: number;
  /** Offending source column, when applicable. */
  field?: string;
  /** Observed value, when relevant. */
  value?: string;
  /** Human-readable, single-pass message for the result file. */
  message: string;
}

/** The three sheets the 3-sheet contract requires. */
export const REQUIRED_SHEETS = ['masterdata', 'amr_resrate', 'prevalence'] as const;

// ---------------------------------------------------------------------------
// Raw structural expectations, derived from the source map.
// ---------------------------------------------------------------------------

interface RawSheetSpec {
  sheet: string;
  requiredColumns: string[];
  numericColumns: { column: string; type: 'integer' | 'float' }[];
}

/** Per-source-sheet required columns and numeric columns, derived from the source map. */
function rawSheetSpecs(): RawSheetSpec[] {
  const masterdata: RawSheetSpec = {
    sheet: 'masterdata',
    requiredColumns: MASTERDATA_REFERENCES.flatMap((p) => [p.de, p.en]),
    numericColumns: [],
  };
  const facts = FACT_SOURCES.map((src) => ({
    sheet: src.sheet,
    requiredColumns: [
      ...src.scalars.map((s) => s.column),
      ...src.relations.flatMap((r) => [r.de, r.en]),
      MATRIX_DETAIL_SOURCE.column,
    ],
    numericColumns: src.scalars
      .filter((s) => s.type !== 'string')
      .map((s) => ({ column: s.column, type: s.type as 'integer' | 'float' })),
  }));
  return [masterdata, ...facts];
}

// ---------------------------------------------------------------------------
// Shared row iteration.
// ---------------------------------------------------------------------------

interface RowView {
  rowNumber: number;
  value(columnName: string): string | undefined;
}

function* dataRows(sheet: ExcelJS.Worksheet): Generator<RowView> {
  const header = readHeader(sheet);
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    yield {
      rowNumber: r,
      value(columnName: string): string | undefined {
        const col = header.get(columnName);
        return col === undefined ? undefined : cellValue(row, col);
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Structural checks (raw sheets).
// ---------------------------------------------------------------------------

/** Check #2 — the three required source sheets are present. */
export function checkSheetsPresent(workbook: ExcelJS.Workbook): PreflightFinding[] {
  const findings: PreflightFinding[] = [];
  for (const sheet of REQUIRED_SHEETS) {
    if (!workbook.getWorksheet(sheet)) {
      findings.push({
        check: 2,
        level: 'error',
        sheet,
        message: `Missing required sheet \`${sheet}\``,
      });
    }
  }
  return findings;
}

/** Check #3 — each present sheet carries its required source columns. */
export function checkRequiredColumns(workbook: ExcelJS.Workbook): PreflightFinding[] {
  const findings: PreflightFinding[] = [];
  for (const spec of rawSheetSpecs()) {
    const sheet = workbook.getWorksheet(spec.sheet);
    if (!sheet) {
      continue; // absence is check #2's concern
    }
    const header = readHeader(sheet);
    for (const column of spec.requiredColumns) {
      if (!header.has(column)) {
        findings.push({
          check: 3,
          level: 'error',
          sheet: spec.sheet,
          field: column,
          message: `Sheet \`${spec.sheet}\` is missing required column \`${column}\``,
        });
      }
    }
  }
  return findings;
}

/** Check #4 — every numeric source cell parses to its declared type. */
export function checkCellTypes(workbook: ExcelJS.Workbook): PreflightFinding[] {
  const findings: PreflightFinding[] = [];
  for (const spec of rawSheetSpecs()) {
    const sheet = workbook.getWorksheet(spec.sheet);
    if (!sheet || spec.numericColumns.length === 0) {
      continue;
    }
    for (const row of dataRows(sheet)) {
      for (const { column, type } of spec.numericColumns) {
        const raw = row.value(column);
        if (raw !== undefined && parseNumeric(raw, type) === undefined) {
          findings.push({
            check: 4,
            level: 'error',
            sheet: spec.sheet,
            row: row.rowNumber,
            field: column,
            value: raw,
            message: `Sheet \`${spec.sheet}\` row ${row.rowNumber}: \`${column} = '${raw}'\` is not a valid ${type}`,
          });
        }
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Semantic checks (normalized model).
// ---------------------------------------------------------------------------

/** The source sheet + per-attribute source columns for one fact collection. */
function factSource(collection: string): FactSourceMap {
  const src = FACT_SOURCES.find((s) => s.collection === collection);
  if (!src) {
    throw new Error(`No fact source map for "${collection}"`);
  }
  return src;
}

/** Maps a fact scalar/relation attr back to the source column for that locale. */
function scalarColumn(src: FactSourceMap, attr: string): string {
  return src.scalars.find((s) => s.attr === attr)?.column ?? attr;
}
function relationColumn(src: FactSourceMap, attr: string, locale: 'en' | 'de'): string {
  const rel = src.relations.find((r) => r.attr === attr);
  return (rel ? rel[locale] : undefined) ?? attr;
}

/** Check #5 — every required fact scalar has a value in the normalized row. */
export function checkRequiredFields(facts: FactImport[]): PreflightFinding[] {
  const findings: PreflightFinding[] = [];
  for (const { collection, rows } of facts) {
    const src = factSource(collection);
    const required = factSpec(collection).scalars.filter((s) => s.required);
    for (const row of rows) {
      for (const field of required) {
        if (row.scalars.en[field.attr] === undefined) {
          const column = scalarColumn(src, field.attr);
          findings.push({
            check: 5,
            level: 'error',
            sheet: src.sheet,
            row: row.rowNumber,
            field: column,
            message: `Sheet \`${src.sheet}\` row ${row.rowNumber}: required field \`${column}\` is empty`,
          });
        }
      }
    }
  }
  return findings;
}

/** Check #6 — `dbId` is unique within a fact collection (the only unique fact field). */
export function checkUnique(facts: FactImport[]): PreflightFinding[] {
  const findings: PreflightFinding[] = [];
  for (const { collection, rows } of facts) {
    if (!factSpec(collection).scalars.some((s) => s.attr === 'dbId')) {
      continue;
    }
    const src = factSource(collection);
    const column = scalarColumn(src, 'dbId');
    const seen = new Set<string>();
    for (const row of rows) {
      const value = row.scalars.en.dbId;
      if (value === undefined) {
        continue; // emptiness is check #5's concern
      }
      const key = String(value);
      if (seen.has(key)) {
        findings.push({
          check: 6,
          level: 'error',
          sheet: src.sheet,
          row: row.rowNumber,
          field: column,
          value: key,
          message: `Sheet \`${src.sheet}\` row ${row.rowNumber}: duplicate \`${column} = '${key}'\` (must be unique)`,
        });
      } else {
        seen.add(key);
      }
    }
  }
  return findings;
}

/**
 * Check #7 — every fact relation name resolves to a reference row in the same
 * locale. The name index is built from the normalized reference collections
 * (masterdata-derived), so a name the steward forgot to add to `masterdata`
 * still fails. No server round-trip.
 */
export function checkRelations(
  references: CollectionImport[],
  facts: FactImport[],
): PreflightFinding[] {
  const index = new Set<string>();
  const key = (collection: string, locale: string, name: string): string =>
    `${collection} ${locale} ${name}`;
  for (const { collection, rows } of references) {
    for (const row of rows) {
      index.add(key(collection, 'en', row.en.name));
      if (row.de) {
        index.add(key(collection, 'de', row.de.name));
      }
    }
  }

  const findings: PreflightFinding[] = [];
  for (const { collection, rows } of facts) {
    const src = factSource(collection);
    for (const row of rows) {
      for (const ref of row.relations) {
        for (const locale of ['en', 'de'] as const) {
          const name = ref[locale];
          if (name === undefined || index.has(key(ref.collection, locale, name))) {
            continue;
          }
          const column = relationColumn(src, ref.attr, locale);
          findings.push({
            check: 7,
            level: 'error',
            sheet: src.sheet,
            row: row.rowNumber,
            field: column,
            value: name,
            message: `Sheet \`${src.sheet}\` row ${row.rowNumber}: \`${column} = '${name}'\` not found in ${ref.collection} (${locale})`,
          });
        }
      }
    }
  }
  return findings;
}

/**
 * Check #8 (references) — every `masterdata` pair entry carries both locales. A
 * cell present in one column of a pair but blank in the other is an error (both
 * locales are mandatory). Row numbers within a single pair *are* meaningful (the
 * DE and EN cell at row r describe the same entity).
 */
export function checkReferenceLocales(workbook: ExcelJS.Workbook): PreflightFinding[] {
  const sheet = workbook.getWorksheet('masterdata');
  if (!sheet) {
    return [];
  }
  const findings: PreflightFinding[] = [];
  for (const row of dataRows(sheet)) {
    for (const pair of MASTERDATA_REFERENCES) {
      const en = row.value(pair.en);
      const de = row.value(pair.de);
      if (en !== undefined && de === undefined) {
        findings.push(localeFinding(row.rowNumber, pair.de, pair.en, en));
      } else if (de !== undefined && en === undefined) {
        findings.push(localeFinding(row.rowNumber, pair.en, pair.de, de));
      }
    }
  }
  return findings;
}

function localeFinding(
  rowNumber: number,
  missingColumn: string,
  presentColumn: string,
  presentValue: string,
): PreflightFinding {
  return {
    check: 8,
    level: 'error',
    sheet: 'masterdata',
    row: rowNumber,
    field: missingColumn,
    value: presentValue,
    message: `Sheet \`masterdata\` row ${rowNumber}: \`${presentColumn} = '${presentValue}'\` has no \`${missingColumn}\` value (both locales required)`,
  };
}

/**
 * Check #8 (facts) — every fact relation present in one locale must be present in
 * both. A relation populated in EN but blank in DE (or vice versa) is an error.
 * A relation blank in both locales is allowed (it carries no value).
 */
export function checkFactLocales(facts: FactImport[]): PreflightFinding[] {
  const findings: PreflightFinding[] = [];
  for (const { collection, rows } of facts) {
    const src = factSource(collection);
    for (const row of rows) {
      for (const ref of row.relations) {
        const enPresent = ref.en !== undefined;
        const dePresent = ref.de !== undefined;
        if (enPresent === dePresent) {
          continue; // both present or both absent
        }
        const missing = enPresent ? ('de' as const) : ('en' as const);
        const presentLocale = enPresent ? ('en' as const) : ('de' as const);
        findings.push({
          check: 8,
          level: 'error',
          sheet: src.sheet,
          row: row.rowNumber,
          field: relationColumn(src, ref.attr, missing),
          value: (enPresent ? ref.en : ref.de)!,
          message: `Sheet \`${src.sheet}\` row ${row.rowNumber}: \`${ref.attr}\` has ${presentLocale.toUpperCase()} but no ${missing.toUpperCase()} value (both locales required)`,
        });
      }
    }
  }
  return findings;
}

/**
 * Check #9 — cut-off pivot sanity. A documented no-op for v1 (cut-off is loaded
 * by the legacy mechanism, ADR 0006). Kept so the ten-check contract is visible.
 */
export function checkCutoff(): PreflightFinding[] {
  return [];
}

/** The attributes the normalizer produces for a collection (for schema-drift). */
export function knownAttrs(collection: string): Set<string> {
  const src = FACT_SOURCES.find((s) => s.collection === collection);
  if (!src) {
    return new Set(['name']); // every reference collection produces only `name`
  }
  return new Set([...src.scalars.map((s) => s.attr), ...src.relations.map((r) => r.attr)]);
}

/**
 * Check #10 — schema drift. A field the live Strapi schema marks `required` but
 * the importer does not produce is drift the exporter never learned about.
 */
export function checkSchemaDrift(
  collection: string,
  liveSchema: LiveSchema,
  produced: Set<string>,
): PreflightFinding[] {
  const findings: PreflightFinding[] = [];
  for (const [attr, definition] of Object.entries(liveSchema.attributes)) {
    if (definition.required && !produced.has(attr)) {
      findings.push({
        check: 10,
        level: 'error',
        sheet: collection,
        field: attr,
        message: `Collection \`${collection}\`: live schema requires \`${attr}\` but the importer provides no value for it (schema drift)`,
      });
    }
  }
  return findings;
}
