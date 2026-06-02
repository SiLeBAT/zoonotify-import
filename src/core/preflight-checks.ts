import type ExcelJS from 'exceljs';
import type { CollectionDescriptor } from './descriptors.js';
import type { LiveSchema } from './strapi-client.js';
import { cellValue, parseNumeric, readHeader } from './cells.js';

/** One data row, with column access by header name (1-based worksheet rows). */
interface RowView {
  rowNumber: number;
  value(columnName: string): string | undefined;
}

/** Iterates the data rows (2..rowCount) of a sheet, reading cells by column name. */
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

/**
 * The ten pre-flight checks, each a small pure function returning findings.
 * They never throw and never fail fast within a check: every problem is
 * collected so the operator gets the whole list in one pass. The orchestrator
 * in preflight.ts composes them and decides abort-vs-continue from the levels.
 * See CONTEXT.md § Pre-flight validation.
 */

export type PreflightLevel = 'error' | 'warning';

export interface PreflightFinding {
  /** Which numbered check (1–10) produced this. */
  check: number;
  level: PreflightLevel;
  /** Sheet the problem is on, when applicable. */
  sheet?: string;
  /** 1-based worksheet row number, when applicable. */
  row?: number;
  /** Offending column, when applicable. */
  field?: string;
  /** Observed value, when relevant. */
  value?: string;
  /** Human-readable, single-pass message for the result file. */
  message: string;
}

/**
 * Check #2 — every expected sheet is present. One finding per missing sheet.
 */
export function checkSheetsPresent(
  workbook: ExcelJS.Workbook,
  descriptors: CollectionDescriptor[],
): PreflightFinding[] {
  const findings: PreflightFinding[] = [];
  for (const descriptor of descriptors) {
    if (!workbook.getWorksheet(descriptor.collection)) {
      findings.push({
        check: 2,
        level: 'error',
        sheet: descriptor.collection,
        message: `Missing required sheet \`${descriptor.collection}\``,
      });
    }
  }
  return findings;
}

/**
 * Check #3 — every column the collection declares is present in the row-1
 * header. One finding per absent column.
 */
export function checkRequiredColumns(
  sheet: ExcelJS.Worksheet,
  descriptor: CollectionDescriptor,
): PreflightFinding[] {
  const header = readHeader(sheet);
  const findings: PreflightFinding[] = [];
  for (const column of descriptor.columns) {
    if (!header.has(column.name)) {
      findings.push({
        check: 3,
        level: 'error',
        sheet: descriptor.collection,
        field: column.name,
        message: `Sheet \`${descriptor.collection}\` is missing required column \`${column.name}\``,
      });
    }
  }
  return findings;
}

/**
 * Check #9 — cut-off pivot sanity. A documented no-op for v1: the cut-off
 * ("AMR Cutoff Table") is loaded by the legacy mechanism and excluded from this
 * CLI (ADR 0006). Kept as an explicit, numbered placeholder so the ten-check
 * contract is visible and the slot is reserved for when cut-off is brought in.
 */
export function checkCutoff(): PreflightFinding[] {
  return [];
}

/**
 * Check #10 — schema drift. Compares the live Strapi schema against the
 * workbook: every attribute that is `required` in the live schema must have a
 * matching column in the sheet (the `_en` base column for localized attributes,
 * the bare name otherwise). Catches a required field added on the CMS side that
 * the xlsx exporter never learned about.
 */
export function checkSchemaDrift(
  sheet: ExcelJS.Worksheet,
  descriptor: CollectionDescriptor,
  liveSchema: LiveSchema,
): PreflightFinding[] {
  const header = readHeader(sheet);
  const modelled = new Set(descriptor.columns.map((c) => c.attr));
  const findings: PreflightFinding[] = [];
  for (const [attr, definition] of Object.entries(liveSchema.attributes)) {
    // Attributes our spec already models have their columns enforced by check
    // #3; drift is specifically a *new* required field the exporter never learned.
    if (!definition.required || modelled.has(attr)) {
      continue;
    }
    const expectedColumn = definition.localized ? `${attr}_en` : attr;
    if (!header.has(expectedColumn)) {
      findings.push({
        check: 10,
        level: 'error',
        sheet: descriptor.collection,
        field: expectedColumn,
        message: `Sheet \`${descriptor.collection}\`: live schema requires \`${attr}\` but column \`${expectedColumn}\` is missing (schema drift)`,
      });
    }
  }
  return findings;
}

/**
 * Check #8 — locale completeness for the localized identity (`name`). Missing
 * DE for a row that has EN is a warning (the DE half is skipped); missing EN for
 * a row that has DE is an error (EN is the base locale). Collections without a
 * localized `name` (fact tables) are skipped.
 */
export function checkLocaleCompleteness(
  sheet: ExcelJS.Worksheet,
  descriptor: CollectionDescriptor,
): PreflightFinding[] {
  const enColumn = descriptor.columns.find((c) => c.attr === 'name' && c.locale === 'en');
  const deColumn = descriptor.columns.find((c) => c.attr === 'name' && c.locale === 'de');
  if (!enColumn || !deColumn) {
    return [];
  }

  const findings: PreflightFinding[] = [];
  for (const row of dataRows(sheet)) {
    const en = row.value(enColumn.name);
    const de = row.value(deColumn.name);
    if (en !== undefined && de === undefined) {
      findings.push({
        check: 8,
        level: 'warning',
        sheet: descriptor.collection,
        row: row.rowNumber,
        field: deColumn.name,
        message: `Sheet \`${descriptor.collection}\` row ${row.rowNumber}: missing DE translation; the DE half is skipped`,
      });
    } else if (en === undefined && de !== undefined) {
      findings.push({
        check: 8,
        level: 'error',
        sheet: descriptor.collection,
        row: row.rowNumber,
        field: enColumn.name,
        value: de,
        message: `Sheet \`${descriptor.collection}\` row ${row.rowNumber}: DE present but EN base locale is missing`,
      });
    }
  }
  return findings;
}

/**
 * Check #7 — every relation reference resolves to a row in its target reference
 * sheet, same locale. The name index is built from the reference sheets' own
 * `name` columns in the parsed workbook — no server round-trip.
 */
export function checkRelations(
  workbook: ExcelJS.Workbook,
  descriptors: CollectionDescriptor[],
): PreflightFinding[] {
  const names = new Set<string>();
  const indexKey = (collection: string, locale: string, name: string): string =>
    `${collection} ${locale} ${name}`;

  for (const descriptor of descriptors) {
    const sheet = workbook.getWorksheet(descriptor.collection);
    if (!sheet) {
      continue;
    }
    const nameColumns = descriptor.columns.filter((c) => c.attr === 'name');
    for (const row of dataRows(sheet)) {
      for (const column of nameColumns) {
        const value = row.value(column.name);
        if (value !== undefined) {
          names.add(indexKey(descriptor.collection, column.locale ?? 'en', value));
        }
      }
    }
  }

  const findings: PreflightFinding[] = [];
  for (const descriptor of descriptors) {
    const sheet = workbook.getWorksheet(descriptor.collection);
    if (!sheet) {
      continue;
    }
    const relationColumns = descriptor.columns.filter((c) => c.isRelation);
    for (const row of dataRows(sheet)) {
      for (const column of relationColumns) {
        const value = row.value(column.name);
        const target = column.relationCollection!;
        if (value !== undefined && !names.has(indexKey(target, column.locale ?? 'en', value))) {
          findings.push({
            check: 7,
            level: 'error',
            sheet: descriptor.collection,
            row: row.rowNumber,
            field: column.name,
            value,
            message: `Sheet \`${descriptor.collection}\` row ${row.rowNumber}: \`${column.name} = '${value}'\` not found in ${target} sheet`,
          });
        }
      }
    }
  }
  return findings;
}

/**
 * Check #6 — values in a unique column have no duplicates within the sheet.
 * The first occurrence is accepted; every later repeat is flagged.
 */
export function checkUnique(
  sheet: ExcelJS.Worksheet,
  descriptor: CollectionDescriptor,
): PreflightFinding[] {
  const header = readHeader(sheet);
  const unique = descriptor.columns.filter((c) => c.unique && header.has(c.name));
  const findings: PreflightFinding[] = [];
  for (const column of unique) {
    const seen = new Set<string>();
    for (const row of dataRows(sheet)) {
      const value = row.value(column.name);
      if (value === undefined) {
        continue;
      }
      if (seen.has(value)) {
        findings.push({
          check: 6,
          level: 'error',
          sheet: descriptor.collection,
          row: row.rowNumber,
          field: column.name,
          value,
          message: `Sheet \`${descriptor.collection}\` row ${row.rowNumber}: duplicate \`${column.name} = '${value}'\` (must be unique)`,
        });
      } else {
        seen.add(value);
      }
    }
  }
  return findings;
}

/**
 * Check #5 — every required field has a value (sentinels count as empty). Only
 * the base-locale (`en` or single) column of a required field is mandatory; the
 * DE half is governed by locale completeness (check #8).
 */
export function checkRequiredFields(
  sheet: ExcelJS.Worksheet,
  descriptor: CollectionDescriptor,
): PreflightFinding[] {
  // A column absent from the header is check #3's concern, not this one.
  const header = readHeader(sheet);
  const required = descriptor.columns.filter((c) => c.required && header.has(c.name));
  const findings: PreflightFinding[] = [];
  for (const row of dataRows(sheet)) {
    for (const column of required) {
      if (row.value(column.name) === undefined) {
        findings.push({
          check: 5,
          level: 'error',
          sheet: descriptor.collection,
          row: row.rowNumber,
          field: column.name,
          message: `Sheet \`${descriptor.collection}\` row ${row.rowNumber}: required field \`${column.name}\` is empty`,
        });
      }
    }
  }
  return findings;
}

/**
 * Check #4 — every numeric cell parses to its declared type. Sentinels are
 * "no value" (handled by cellValue) and never type errors. String columns and
 * relations are not type-checked.
 */
export function checkCellTypes(
  sheet: ExcelJS.Worksheet,
  descriptor: CollectionDescriptor,
): PreflightFinding[] {
  const numeric = descriptor.columns.filter(
    (c) => !c.isRelation && (c.type === 'integer' || c.type === 'float'),
  );
  const findings: PreflightFinding[] = [];
  for (const row of dataRows(sheet)) {
    for (const column of numeric) {
      const raw = row.value(column.name);
      if (
        raw !== undefined &&
        parseNumeric(raw, column.type as 'integer' | 'float') === undefined
      ) {
        findings.push({
          check: 4,
          level: 'error',
          sheet: descriptor.collection,
          row: row.rowNumber,
          field: column.name,
          value: raw,
          message: `Sheet \`${descriptor.collection}\` row ${row.rowNumber}: \`${column.name} = '${raw}'\` is not a valid ${column.type}`,
        });
      }
    }
  }
  return findings;
}
