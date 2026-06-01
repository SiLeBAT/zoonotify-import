import type { Locale } from './relation-map.js';
import type { CollectionImport } from './orchestrator.js';
import type { FactImport } from './fact-parser.js';

/**
 * Pre-flight validation for the import core. This module currently implements
 * check #7 (relation references resolve within the parsed payload); the full
 * ten-check harness and result file land in issue #005. See CONTEXT.md §
 * Pre-flight validation and docs/import-cli-spec/source-xlsx-format.md §5.
 */

/** One relation reference that does not resolve to a parsed reference row. */
export interface RelationFinding {
  /** Fact sheet the bad reference is on (e.g. `resistance`). */
  sheet: string;
  /** 1-based worksheet row number. */
  rowNumber: number;
  /** Offending column (e.g. `matrix_en`). */
  field: string;
  /** The value that did not resolve. */
  value: string;
  /** Reference sheet the value should have been found in (e.g. `matrix`). */
  referenceSheet: string;
  /** Human-readable, single-pass message for the result file. */
  message: string;
}

/**
 * The set of `(collection, locale, name)` triples present in the parsed
 * reference sheets. Check #7 verifies every fact relation name appears here,
 * matching locale. Built from the parsed payload — no server round-trip.
 */
export class ReferenceNameIndex {
  private readonly keys = new Set<string>();

  add(collection: string, locale: Locale, name: string): void {
    this.keys.add(key(collection, locale, name));
  }

  has(collection: string, locale: Locale, name: string): boolean {
    return this.keys.has(key(collection, locale, name));
  }
}

/** Indexes every reference row's name by collection + locale for check #7. */
export function buildReferenceNameIndex(references: CollectionImport[]): ReferenceNameIndex {
  const index = new ReferenceNameIndex();
  for (const { collection, rows } of references) {
    for (const row of rows) {
      index.add(collection, 'en', row.en.name);
      if (row.de) {
        index.add(collection, 'de', row.de.name);
      }
    }
  }
  return index;
}

/**
 * Check #7: every fact relation reference must resolve to a parsed reference row
 * in the same locale. Accumulates every failure (does not fail fast) so the
 * operator can fix them all in one pass.
 */
export function checkRelationReferences(
  facts: FactImport[],
  index: ReferenceNameIndex,
): RelationFinding[] {
  const findings: RelationFinding[] = [];
  for (const { collection: sheet, rows } of facts) {
    for (const row of rows) {
      for (const ref of row.relations) {
        for (const locale of ['en', 'de'] as const) {
          const value = ref[locale];
          if (value !== undefined && !index.has(ref.collection, locale, value)) {
            findings.push(
              makeFinding(sheet, row.rowNumber, ref.attr, locale, value, ref.collection),
            );
          }
        }
      }
    }
  }
  return findings;
}

function makeFinding(
  sheet: string,
  rowNumber: number,
  attr: string,
  locale: Locale,
  value: string,
  referenceSheet: string,
): RelationFinding {
  const field = `${attr}_${locale}`;
  return {
    sheet,
    rowNumber,
    field,
    value,
    referenceSheet,
    message: `Sheet \`${sheet}\` row ${rowNumber}: \`${field} = '${value}'\` not found in ${referenceSheet} sheet`,
  };
}

function key(collection: string, locale: Locale, name: string): string {
  return `${collection} ${locale} ${name}`;
}
