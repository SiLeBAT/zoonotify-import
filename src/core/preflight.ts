import type ExcelJS from 'exceljs';
import type { CollectionDescriptor } from './descriptors.js';
import type { LiveSchema } from './strapi-client.js';
import type { PreflightFinding } from './preflight-checks.js';
import {
  checkCellTypes,
  checkCutoff,
  checkLocaleCompleteness,
  checkRelations,
  checkRequiredColumns,
  checkRequiredFields,
  checkSchemaDrift,
  checkSheetsPresent,
  checkUnique,
} from './preflight-checks.js';

/**
 * Pre-flight orchestrator: composes the ten checks over an already-loaded
 * workbook, accumulating every finding in a single pass, and reports the result
 * with a parsed-rows summary. The caller owns check #1 (reading the file) and
 * decides abort/continue from `ok`. See CONTEXT.md § Pre-flight validation.
 */

export interface PreflightSummary {
  /** Number of expected sheets actually present. */
  collections: number;
  /** Data-row count per present collection. */
  rowsByCollection: Record<string, number>;
  totalRows: number;
}

export interface PreflightReport {
  /** True when there are no error-level findings (warnings do not block). */
  ok: boolean;
  errors: PreflightFinding[];
  warnings: PreflightFinding[];
  summary: PreflightSummary;
}

export interface PreflightOptions {
  /** Supplies the live schema for check #10; omit to skip schema-drift detection. */
  fetchSchema?: (collection: string) => Promise<LiveSchema>;
}

export async function runPreflight(
  workbook: ExcelJS.Workbook,
  descriptors: CollectionDescriptor[],
  options: PreflightOptions = {},
): Promise<PreflightReport> {
  const findings: PreflightFinding[] = [];

  // Cross-sheet checks.
  findings.push(...checkSheetsPresent(workbook, descriptors)); // #2
  findings.push(...checkRelations(workbook, descriptors)); // #7
  findings.push(...checkCutoff()); // #9 (no-op)

  // Per-sheet checks, only for sheets that are present.
  const rowsByCollection: Record<string, number> = {};
  let present = 0;
  for (const descriptor of descriptors) {
    const sheet = workbook.getWorksheet(descriptor.collection);
    if (!sheet) {
      continue;
    }
    present += 1;
    rowsByCollection[descriptor.collection] = Math.max(0, sheet.rowCount - 1);

    findings.push(...checkRequiredColumns(sheet, descriptor)); // #3
    findings.push(...checkCellTypes(sheet, descriptor)); // #4
    findings.push(...checkRequiredFields(sheet, descriptor)); // #5
    findings.push(...checkUnique(sheet, descriptor)); // #6
    findings.push(...checkLocaleCompleteness(sheet, descriptor)); // #8

    if (options.fetchSchema) {
      // #10 — best-effort: an unreachable schema endpoint warns rather than blocks.
      try {
        const schema = await options.fetchSchema(descriptor.collection);
        findings.push(...checkSchemaDrift(sheet, descriptor, schema));
      } catch (err) {
        findings.push({
          check: 10,
          level: 'warning',
          sheet: descriptor.collection,
          message: `schema drift not verified for \`${descriptor.collection}\`: ${(err as Error).message}`,
        });
      }
    }
  }

  const errors = findings.filter((f) => f.level === 'error');
  const warnings = findings.filter((f) => f.level === 'warning');
  const totalRows = Object.values(rowsByCollection).reduce((sum, n) => sum + n, 0);

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    summary: { collections: present, rowsByCollection, totalRows },
  };
}
