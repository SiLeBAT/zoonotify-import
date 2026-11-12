/**
 * Declarative description of the two fact collections the Import CLI imports
 * (`resistance` and `prevalence`): their canonical Strapi attributes, types, and
 * relations. The normalizer (driven by source-map.ts) maps the raw fact sheets
 * onto these, and the pre-flight checks read this metadata. Each fact carries:
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

export type ScalarType = 'string' | 'integer' | 'float' | 'date';

export interface FactScalarField {
  attr: string;
  /** `true` → `<attr>_en`/`<attr>_de` columns; `false` → single bare `<attr>` column shared across locales. */
  paired: boolean;
  type: ScalarType;
  /** Whether a value is required in the base (`en`) locale. */
  required?: boolean;
  /** Whether the value must be unique within the collection (pre-flight check #6). */
  unique?: boolean;
}

export interface FactRelationField {
  /** Attribute name on the fact (e.g. `matrix`), and the `<attr>_en`/`<attr>_de` column stem. */
  attr: string;
  /** Reference collection whose `(locale, name) → id` map resolves this relation. */
  collection: string;
  /** Whether every row must name a target (pre-flight check #5). */
  required?: boolean;
}

export interface FactCollectionSpec {
  /** Strapi API singular name; also the workbook sheet name. */
  collection: string;
  scalars: FactScalarField[];
  relations: FactRelationField[];
  /** Bare attribute stems silently dropped if present on the sheet. */
  ignoredColumns?: string[];
  /**
   * Attributes (scalars or relations, by EN value) that together identify at most
   * one row — for a collection with no single unique field (pre-flight check #6).
   */
  uniqueKey?: string[];
  /** Attributes that must hold one value across all rows sharing `across` (check #6). */
  consistent?: { attr: string; across: string[] }[];
}

const ZOMO: FactScalarField = { attr: 'zomoProgram', paired: true, type: 'string' };

/** `Datum der Datenextraktion`, carried by every fact sheet since zn1934. */
const EXTRACTION_DATE: FactScalarField = {
  attr: 'dataExtractionDate',
  paired: false,
  type: 'date',
  required: true,
};

/** A multi-resistance Combination in one sampling year: one bar of the graph (ADR 0008). */
/** The Combination relations of the zn1934 fact collections (no `specie`). */
const COMBINATION: FactRelationField[] = [
  { attr: 'matrix', collection: 'matrix' },
  { attr: 'matrixGroup', collection: 'matrix-group' },
  { attr: 'microorganism', collection: 'microorganism' },
  { attr: 'sampleType', collection: 'sample-type' },
  { attr: 'sampleOrigin', collection: 'sample-origin' },
  { attr: 'superCategorySampleOrigin', collection: 'super-category-sample-origin' },
  { attr: 'samplingStage', collection: 'sampling-stage' },
  { attr: 'matrixDetail', collection: 'matrix-detail' },
];

/** A zn1934 Combination in one sampling year (no `specie`: those sheets have none). */
const COMBINATION_SAMPLE_YEAR = [
  'microorganism',
  'matrix',
  'matrixDetail',
  'sampleOrigin',
  'samplingStage',
  'samplingYear',
];

const COMBINATION_YEAR = [
  'microorganism',
  'specie',
  'matrix',
  'matrixDetail',
  'sampleOrigin',
  'samplingStage',
  'samplingYear',
];

export const FACT_COLLECTIONS: FactCollectionSpec[] = [
  {
    collection: 'resistance',
    scalars: [
      { attr: 'dbId', paired: false, type: 'string', required: true, unique: true },
      ZOMO,
      { attr: 'samplingYear', paired: false, type: 'integer', required: true },
      { attr: 'anzahlGetesteterIsolate', paired: false, type: 'integer', required: true },
      { attr: 'anzahlResistenterIsolate', paired: false, type: 'integer', required: true },
      { attr: 'resistenzrate', paired: false, type: 'float', required: true },
      { attr: 'minKonfidenzintervall', paired: false, type: 'float', required: true },
      { attr: 'maxKonfidenzintervall', paired: false, type: 'float', required: true },
      EXTRACTION_DATE,
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
      EXTRACTION_DATE,
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
  {
    collection: 'multi-resistance',
    scalars: [
      { attr: 'dbId', paired: false, type: 'string', required: true },
      ZOMO,
      { attr: 'samplingYear', paired: false, type: 'integer', required: true },
      { attr: 'resistanceGroup', paired: false, type: 'integer', required: true },
      { attr: 'anzahlIsolate', paired: false, type: 'integer', required: true },
      { attr: 'anzahlGetesteterIsolate', paired: false, type: 'integer', required: true },
      EXTRACTION_DATE,
    ],
    relations: [
      { attr: 'matrix', collection: 'matrix' },
      { attr: 'matrixGroup', collection: 'matrix-group' },
      { attr: 'microorganism', collection: 'microorganism' },
      { attr: 'specie', collection: 'specie' },
      { attr: 'sampleOrigin', collection: 'sample-origin' },
      { attr: 'superCategorySampleOrigin', collection: 'super-category-sample-origin' },
      { attr: 'samplingStage', collection: 'sampling-stage' },
      { attr: 'matrixDetail', collection: 'matrix-detail' },
    ],
    // One row per Combination × sampling year × Resistance group (ADR 0008).
    uniqueKey: [...COMBINATION_YEAR, 'resistanceGroup'],
    // A Combination has exactly one N; each group row counts out of it.
    consistent: [{ attr: 'anzahlGetesteterIsolate', across: COMBINATION_YEAR }],
  },
  {
    collection: 'esbl-ampc-gene-result',
    scalars: [
      { attr: 'dbId', paired: false, type: 'string', required: true },
      ZOMO,
      { attr: 'samplingYear', paired: false, type: 'integer', required: true },
      { attr: 'numberOfIsolates', paired: false, type: 'integer', required: true },
      { attr: 'numberOfGenes', paired: false, type: 'integer', required: true },
      { attr: 'numberOfIsolatesWithGene', paired: false, type: 'integer', required: true },
      { attr: 'relativeGeneAbundance', paired: false, type: 'float', required: true },
      { attr: 'relativeGeneAbundanceCiMin', paired: false, type: 'float', required: true },
      { attr: 'relativeGeneAbundanceCiMax', paired: false, type: 'float', required: true },
      { attr: 'genePrevalence', paired: false, type: 'float', required: true },
      { attr: 'genePrevalenceCiMin', paired: false, type: 'float', required: true },
      { attr: 'genePrevalenceCiMax', paired: false, type: 'float', required: true },
      EXTRACTION_DATE,
    ],
    relations: [
      ...COMBINATION,
      { attr: 'monitoring', collection: 'monitoring' },
      { attr: 'esblAmpcGene', collection: 'esbl-ampc-gene' },
    ],
    // One row per Combination × year × monitoring × gene; `string_dbid` is not relied on.
    uniqueKey: [...COMBINATION_SAMPLE_YEAR, 'monitoring', 'esblAmpcGene'],
    // Each gene row counts out of the same isolates tested.
    consistent: [{ attr: 'numberOfIsolates', across: [...COMBINATION_SAMPLE_YEAR, 'monitoring'] }],
  },
  {
    collection: 'typing-result',
    scalars: [
      { attr: 'dbId', paired: false, type: 'string', required: true },
      ZOMO,
      { attr: 'samplingYear', paired: false, type: 'integer', required: true },
      { attr: 'numberOfIsolates', paired: false, type: 'integer', required: true },
      { attr: 'numberOfIsolatesInSubgroup', paired: false, type: 'integer', required: true },
      { attr: 'subgroupPrevalence', paired: false, type: 'float', required: true },
      { attr: 'subgroupPrevalenceCiMin', paired: false, type: 'float', required: true },
      { attr: 'subgroupPrevalenceCiMax', paired: false, type: 'float', required: true },
      EXTRACTION_DATE,
    ],
    relations: [
      ...COMBINATION,
      { attr: 'typing', collection: 'typing' },
      // A typing result without its subgroup says nothing; such rows are a steward fix.
      { attr: 'typingSubgroup', collection: 'typing-subgroup', required: true },
    ],
    // One row per Combination × year × typing method × subgroup.
    uniqueKey: [...COMBINATION_SAMPLE_YEAR, 'typing', 'typingSubgroup'],
    // Each subgroup row counts out of the same isolates typed.
    consistent: [{ attr: 'numberOfIsolates', across: [...COMBINATION_SAMPLE_YEAR, 'typing'] }],
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
