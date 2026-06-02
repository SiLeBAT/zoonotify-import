/**
 * Declarative description of the two fact collections the Import CLI parses
 * (`resistance` and `prevalence`). Like reference-collections.ts, the generic
 * fact parser is driven entirely by these specs. Each fact sheet carries:
 *
 * - **scalars** — non-relation attributes. `paired: true` means the sheet has
 *   `<attr>_en`/`<attr>_de` columns (localized, e.g. `zomoProgram`); `paired:
 *   false` is a single bare `<attr>` column whose value is shared across locales
 *   (e.g. `dbId`, `samplingYear`, the numeric measures).
 * - **relations** — references to a reference collection by name. Always carried
 *   as `<attr>_en`/`<attr>_de` columns; the parser keeps the names and the
 *   orchestrator translates them to Strapi IDs via the relation map (ADR 0005).
 * - **ignoredColumns** — bare attribute stems that, if present on the sheet, are
 *   silently dropped. `prevalence` lists `matrixDetail`/`sampleType` because the
 *   Strapi schema never had those relations; the historical importer parsed and
 *   discarded them and the CLI stays forward-compatible by doing the same.
 *
 * See docs/import-cli-spec/source-xlsx-format.md §4.2.
 */

export type ScalarType = 'string' | 'integer' | 'float';

export interface FactScalarField {
  attr: string;
  /** `true` → `<attr>_en`/`<attr>_de` columns; `false` → single bare `<attr>` column shared across locales. */
  paired: boolean;
  type: ScalarType;
  /** Whether a value is required in the base (`en`) locale. */
  required?: boolean;
}

export interface FactRelationField {
  /** Attribute name on the fact (e.g. `matrix`), and the `<attr>_en`/`<attr>_de` column stem. */
  attr: string;
  /** Reference collection whose `(locale, name) → id` map resolves this relation. */
  collection: string;
}

export interface FactCollectionSpec {
  /** Strapi API singular name; also the workbook sheet name. */
  collection: string;
  scalars: FactScalarField[];
  relations: FactRelationField[];
  /** Bare attribute stems silently dropped if present on the sheet. */
  ignoredColumns?: string[];
}

const ZOMO: FactScalarField = { attr: 'zomoProgram', paired: true, type: 'string' };

export const FACT_COLLECTIONS: FactCollectionSpec[] = [
  {
    collection: 'resistance',
    scalars: [
      { attr: 'dbId', paired: false, type: 'string', required: true },
      ZOMO,
      { attr: 'samplingYear', paired: false, type: 'integer', required: true },
      { attr: 'anzahlGetesteterIsolate', paired: false, type: 'integer', required: true },
      { attr: 'anzahlResistenterIsolate', paired: false, type: 'integer', required: true },
      { attr: 'resistenzrate', paired: false, type: 'float', required: true },
      { attr: 'minKonfidenzintervall', paired: false, type: 'float', required: true },
      { attr: 'maxKonfidenzintervall', paired: false, type: 'float', required: true },
    ],
    relations: [
      { attr: 'matrix', collection: 'matrix' },
      { attr: 'matrixGroup', collection: 'matrix-group' },
      { attr: 'microorganism', collection: 'microorganism' },
      { attr: 'specie', collection: 'specie' },
      { attr: 'sampleType', collection: 'sample-type' },
      { attr: 'sampleOrigin', collection: 'sample-origin' },
      { attr: 'superCategorySampleOrigin', collection: 'super-category-sample-origin' },
      { attr: 'samplingStage', collection: 'sampling-stage' },
      { attr: 'antimicrobialSubstance', collection: 'antimicrobial-substance' },
    ],
  },
  {
    collection: 'prevalence',
    scalars: [
      ZOMO,
      { attr: 'samplingYear', paired: false, type: 'integer' },
      { attr: 'numberOfSamples', paired: false, type: 'integer' },
      { attr: 'numberOfPositive', paired: false, type: 'integer' },
      { attr: 'percentageOfPositive', paired: false, type: 'float' },
      { attr: 'ciMin', paired: false, type: 'float' },
      { attr: 'ciMax', paired: false, type: 'float' },
    ],
    relations: [
      { attr: 'matrix', collection: 'matrix' },
      { attr: 'matrixGroup', collection: 'matrix-group' },
      { attr: 'microorganism', collection: 'microorganism' },
      { attr: 'sampleOrigin', collection: 'sample-origin' },
      { attr: 'superCategorySampleOrigin', collection: 'super-category-sample-origin' },
      { attr: 'samplingStage', collection: 'sampling-stage' },
    ],
    // Dead columns: the prevalence schema never had these relations. Dropped if present.
    ignoredColumns: ['matrixDetail', 'sampleType'],
  },
];

/** Looks up a fact collection spec by name, throwing if it is not registered. */
export function factSpec(collection: string): FactCollectionSpec {
  const spec = FACT_COLLECTIONS.find((s) => s.collection === collection);
  if (!spec) {
    throw new Error(`No fact-collection spec registered for "${collection}"`);
  }
  return spec;
}
