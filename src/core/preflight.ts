import type ExcelJS from 'exceljs';
import type { LiveSchema } from './strapi-client.js';
import type { PreflightFinding } from './preflight-checks.js';
import { normalizeReferences, normalizeFacts } from './normalizer.js';
import {
  checkCellTypes,
  checkCutoff,
  checkFactLocales,
  checkReferenceLocales,
  checkRelations,
  checkRequiredColumns,
  checkRequiredFields,
  checkSchemaDrift,
  checkSheetsPresent,
  checkUnique,
  knownAttrs,
} from './preflight-checks.js';

/**
 * Pre-flight orchestrator for the 3-sheet contract (ADR 0007). Normalizes the
 * workbook once, then composes the two check layers over a single pass:
 * structural checks read the raw sheets, semantic checks read the normalized
 * model. The caller owns check #1 (reading the file) and decides abort/continue
 * from `ok`. See CONTEXT.md § Pre-flight validation.
 */

export interface PreflightSummary {
  /** Number of (normalized) collections the import will replace. */
  collections: number;
  /** Data-row count per normalized collection. */
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
  options: PreflightOptions = {},
): Promise<PreflightReport> {
  const references = normalizeReferences(workbook);
  const facts = normalizeFacts(workbook);

  const findings: PreflightFinding[] = [];

  // Structural layer — raw sheets.
  findings.push(...checkSheetsPresent(workbook)); // #2
  findings.push(...checkRequiredColumns(workbook)); // #3
  findings.push(...checkCellTypes(workbook)); // #4

  // Semantic layer — normalized model.
  findings.push(...checkRequiredFields(facts)); // #5
  findings.push(...checkUnique(facts)); // #6
  findings.push(...checkRelations(references, facts)); // #7
  findings.push(...checkReferenceLocales(workbook)); // #8 (references)
  findings.push(...checkFactLocales(facts)); // #8 (facts)
  findings.push(...checkCutoff()); // #9 (no-op)

  // #10 — schema drift, best-effort: an unreachable endpoint warns, not blocks.
  if (options.fetchSchema) {
    for (const { collection } of [...references, ...facts]) {
      try {
        const schema = await options.fetchSchema(collection);
        findings.push(...checkSchemaDrift(collection, schema, knownAttrs(collection)));
      } catch (err) {
        findings.push({
          check: 10,
          level: 'warning',
          sheet: collection,
          message: `schema drift not verified for \`${collection}\`: ${(err as Error).message}`,
        });
      }
    }
  }

  const errors = findings.filter((f) => f.level === 'error');
  const warnings = findings.filter((f) => f.level === 'warning');

  const rowsByCollection: Record<string, number> = {};
  for (const { collection, rows } of [...references, ...facts]) {
    rowsByCollection[collection] = rows.length;
  }
  const totalRows = Object.values(rowsByCollection).reduce((sum, n) => sum + n, 0);

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    summary: { collections: references.length + facts.length, rowsByCollection, totalRows },
  };
}
