import type { Locale } from './relation-map.js';
import type { ReferenceCollectionSpec } from './reference-collections.js';
import type { FactCollectionSpec, ScalarType } from './fact-collections.js';
import { REFERENCE_COLLECTIONS } from './reference-collections.js';
import { FACT_COLLECTIONS } from './fact-collections.js';

/**
 * A flat, column-level description of one xlsx-managed collection, derived from
 * the reference and fact registries. Pre-flight's structural and content checks
 * are driven entirely by these descriptors so each check is one small loop over
 * columns rather than a tangle of per-collection special cases.
 *
 * `matrix-detail` is the non-i18n outlier: `localized: false` and its `name`/
 * `iri` are single (non-localized) columns rather than `_en`/`_de` pairs.
 */

export interface ColumnDescriptor {
  /** Actual header on the sheet (e.g. `name_en`, `iri`, `matrix_de`). */
  name: string;
  /** Logical attribute (e.g. `name`, `matrix`). */
  attr: string;
  /** Locale half for paired columns; absent for single (non-localized) columns. */
  locale?: Locale;
  type: ScalarType;
  /** Whether a value is required (base/EN locale only). */
  required: boolean;
  /** Whether values must be unique within the sheet. */
  unique: boolean;
  isRelation: boolean;
  /** For relation columns, the reference collection the name resolves against. */
  relationCollection?: string;
}

export interface CollectionDescriptor {
  collection: string;
  /** Whether the collection is i18n-localized (carries `_en`/`_de` columns). */
  localized: boolean;
  columns: ColumnDescriptor[];
}

/** Describes every reference and fact collection the CLI owns, in registry order. */
export function describeAllCollections(): CollectionDescriptor[] {
  return [...REFERENCE_COLLECTIONS.map(describeReference), ...FACT_COLLECTIONS.map(describeFact)];
}

/** Looks up one collection's descriptor by name, throwing if it is not registered. */
export function describeCollection(collection: string): CollectionDescriptor {
  const descriptor = describeAllCollections().find((d) => d.collection === collection);
  if (!descriptor) {
    throw new Error(`No descriptor for collection "${collection}"`);
  }
  return descriptor;
}

function describeReference(spec: ReferenceCollectionSpec): CollectionDescriptor {
  const columns: ColumnDescriptor[] = [];
  for (const field of spec.fields) {
    const unique = field.attr === 'name';
    if (field.paired) {
      columns.push(
        scalarColumn(
          `${field.attr}_en`,
          field.attr,
          'string',
          field.required ?? false,
          unique,
          'en',
        ),
      );
      columns.push(scalarColumn(`${field.attr}_de`, field.attr, 'string', false, false, 'de'));
    } else {
      // Single (non-localized) column rides the base payload. `name` is still
      // unique even when unpaired (matrix-detail).
      columns.push(scalarColumn(field.attr, field.attr, 'string', field.required ?? false, unique));
    }
  }
  return { collection: spec.collection, localized: spec.localized ?? true, columns };
}

function describeFact(spec: FactCollectionSpec): CollectionDescriptor {
  const columns: ColumnDescriptor[] = [];
  for (const field of spec.scalars) {
    const unique = field.attr === 'dbId';
    if (field.paired) {
      columns.push(
        scalarColumn(
          `${field.attr}_en`,
          field.attr,
          field.type,
          field.required ?? false,
          unique,
          'en',
        ),
      );
      columns.push(scalarColumn(`${field.attr}_de`, field.attr, field.type, false, false, 'de'));
    } else {
      columns.push(
        scalarColumn(field.attr, field.attr, field.type, field.required ?? false, unique),
      );
    }
  }
  for (const rel of spec.relations) {
    columns.push(relationColumn(`${rel.attr}_en`, rel.attr, rel.collection, 'en'));
    columns.push(relationColumn(`${rel.attr}_de`, rel.attr, rel.collection, 'de'));
  }
  return { collection: spec.collection, localized: true, columns };
}

function scalarColumn(
  name: string,
  attr: string,
  type: ScalarType,
  required: boolean,
  unique: boolean,
  locale?: Locale,
): ColumnDescriptor {
  const column: ColumnDescriptor = { name, attr, type, required, unique, isRelation: false };
  if (locale) {
    column.locale = locale;
  }
  return column;
}

function relationColumn(
  name: string,
  attr: string,
  relationCollection: string,
  locale: Locale,
): ColumnDescriptor {
  return {
    name,
    attr,
    locale,
    type: 'string',
    required: false,
    unique: false,
    isRelation: true,
    relationCollection,
  };
}
