/**
 * The explicit per-field source map of the 3-sheet contract (ADR 0007): it binds
 * each canonical Strapi attribute to the BfR steward's human-named source columns.
 * The normalizer is driven entirely by this data — adapting to a column rename is
 * a change here, not new parsing code. See docs/import-cli-spec/source-xlsx-format.md.
 */

import type { ScalarType } from './fact-collections.js';

/** One reference collection sourced from a `masterdata` DE/EN column pair. */
export interface MasterdataPair {
  /** Strapi API singular name of the reference collection. */
  collection: string;
  /** Source column holding the German value. */
  de: string;
  /** Source column holding the English (base-locale) value. */
  en: string;
}

/**
 * The nine reference collections carried by the `masterdata` sheet, each as an
 * independent DE/EN column pair (§3 of the source format). `matrix-detail` is the
 * tenth reference collection but is harvested from the fact sheets, not here.
 */
export const MASTERDATA_REFERENCES: MasterdataPair[] = [
  {
    collection: 'super-category-sample-origin',
    de: 'Oberkategorie_Probenursprung',
    en: 'Superordinate_sample_origin',
  },
  { collection: 'sample-origin', de: 'Probenursprung', en: 'Sample_origin' },
  { collection: 'matrix-group', de: 'Matrixgruppe', en: 'Matrix_group' },
  { collection: 'matrix', de: 'Matrix_DE', en: 'Matrix_EN' },
  { collection: 'microorganism', de: 'Mikroorganismus', en: 'Microorganism' },
  { collection: 'sampling-stage', de: 'Probenahmestelle', en: 'Sampling_stage' },
  { collection: 'sample-type', de: 'Probentyp', en: 'Sample_type' },
  { collection: 'specie', de: 'Spezies', en: 'Species' },
  {
    collection: 'antimicrobial-substance',
    de: 'Antimiktobielle_Subtanz',
    en: 'Antimicrobial_substance',
  },
];

/**
 * `matrix-detail` is the tenth reference collection and the one exception to
 * "masterdata is authoritative": it has no masterdata column, so its rows are the
 * distinct values harvested from the `Matrixdetail` column across the fact
 * sheets. It is **not** i18n — a single `name` per row (§3 of the source format).
 */
export const MATRIX_DETAIL_SOURCE = {
  collection: 'matrix-detail',
  sheets: ['amr_resrate', 'prevalence', 'multires'],
  column: 'Matrixdetail',
} as const;

/** One fact scalar sourced from a single column; its value is shared across both locales. */
export interface FactScalarSource {
  /** Canonical Strapi attribute. */
  attr: string;
  /** Source column. */
  column: string;
  type: ScalarType;
  /** Source label → stored value, for a column that carries a label instead of the value. */
  codes?: Readonly<Record<string, number>>;
}

/**
 * The `multires` sheet names each Resistance group by label. The steward uses two
 * schemes — most microorganisms stop at `> 4 x`, MRSA continues `5 x` … `> 8 x` —
 * mapped onto one ordered code scale. Codes 0–5 are the 6-group scheme; no single
 * Combination mixes the two, so within a bar the codes always ascend.
 */
export const RESISTANCE_GROUP_CODES: Readonly<Record<string, number>> = {
  sensibel: 0,
  '1 x resistant': 1,
  '2 x resistant': 2,
  '3 x resistant': 3,
  '4 x resistant': 4,
  '> 4 x resistant': 5,
  '5 x resistant': 6,
  '6 x resistant': 7,
  '7 x resistant': 8,
  '8 x resistant': 9,
  '> 8 x resistant': 10,
};

/** One fact relation sourced from a DE/EN column pair; resolved to an id via the relation map. */
export interface FactRelationSource {
  /** Canonical Strapi attribute (and relation-map collection key below). */
  attr: string;
  /** Reference collection whose `(locale, name) → id` map resolves this relation. */
  collection: string;
  /** Source column holding the German reference name. */
  de: string;
  /** Source column holding the English reference name. */
  en: string;
  /**
   * The target collection is not i18n (`matrix-detail`): one name, read from `en`,
   * and the same id is linked from both locale payloads.
   */
  shared?: true;
}

/** A fact collection and the source sheet + per-attribute columns that build it. */
export interface FactSourceMap {
  /** Canonical Strapi API singular name. */
  collection: string;
  /** Source sheet name. */
  sheet: string;
  scalars: FactScalarSource[];
  relations: FactRelationSource[];
}

/** The three fact collections and their column bindings (§4–§5 of the source format, ADR 0008). */
export const FACT_SOURCES: FactSourceMap[] = [
  {
    collection: 'resistance',
    sheet: 'amr_resrate',
    scalars: [
      { attr: 'dbId', column: 'string_dbid', type: 'string' },
      { attr: 'zomoProgram', column: 'ZoMo-Programm', type: 'string' },
      // `Sampling year` duplicates `Jahr`; read `Jahr`, ignore the duplicate.
      { attr: 'samplingYear', column: 'Jahr', type: 'integer' },
      { attr: 'anzahlGetesteterIsolate', column: 'Anzahl getesteter Isolate', type: 'integer' },
      { attr: 'anzahlResistenterIsolate', column: 'Anzahl resistenter Isolate', type: 'integer' },
      { attr: 'resistenzrate', column: 'Resistenzrate (%)', type: 'float' },
      { attr: 'minKonfidenzintervall', column: 'Min. 95% Konfidenzintervall', type: 'float' },
      { attr: 'maxKonfidenzintervall', column: 'Max. 95% Konfidenzintervall', type: 'float' },
    ],
    relations: [
      { attr: 'matrix', collection: 'matrix', de: 'Matrix_neu', en: 'Matrix_new' },
      { attr: 'matrixGroup', collection: 'matrix-group', de: 'Matrixgruppe', en: 'Matrix group' },
      {
        attr: 'microorganism',
        collection: 'microorganism',
        de: 'Mikroorganismus',
        en: 'Microorganism',
      },
      { attr: 'specie', collection: 'specie', de: 'Spezies', en: 'Species' },
      { attr: 'sampleType', collection: 'sample-type', de: 'Probentyp', en: 'Sample type' },
      {
        attr: 'sampleOrigin',
        collection: 'sample-origin',
        de: 'Probenursprung (Tier/Lebensmittel/Futtermittel)',
        en: 'Sample origin',
      },
      {
        attr: 'superCategorySampleOrigin',
        collection: 'super-category-sample-origin',
        de: 'Oberkategorie Probenursprung (Tier/Lebensmittel/Futtermittel)',
        en: 'Superordinate sample origin',
      },
      {
        attr: 'samplingStage',
        collection: 'sampling-stage',
        de: 'Probenahmestelle',
        en: 'Sampling stage',
      },
      {
        attr: 'antimicrobialSubstance',
        collection: 'antimicrobial-substance',
        de: 'Antimikrobielle Substanz',
        en: 'Antimicrobial substance',
      },
    ],
  },
  {
    collection: 'prevalence',
    sheet: 'prevalence',
    scalars: [
      { attr: 'zomoProgram', column: 'ZoMo-Programm', type: 'string' },
      { attr: 'samplingYear', column: 'Jahr', type: 'integer' },
      { attr: 'numberOfSamples', column: 'Anzahl_Proben_N', type: 'integer' },
      { attr: 'numberOfPositive', column: 'Positive_Proben_N', type: 'integer' },
      { attr: 'percentageOfPositive', column: 'prevalence', type: 'float' },
      { attr: 'ciMin', column: 'min_95_KI', type: 'float' },
      { attr: 'ciMax', column: 'max_95_KI', type: 'float' },
    ],
    relations: [
      { attr: 'matrix', collection: 'matrix', de: 'Matrix_neu', en: 'Matrix_new' },
      { attr: 'matrixGroup', collection: 'matrix-group', de: 'Matrixgruppe', en: 'Matrix group' },
      {
        attr: 'microorganism',
        collection: 'microorganism',
        de: 'Mikroorganismus',
        en: 'Microorganism',
      },
      {
        attr: 'sampleOrigin',
        collection: 'sample-origin',
        de: 'Probenursprung (Tier/Lebensmittel/Futtermittel)',
        en: 'Sample origin',
      },
      {
        attr: 'superCategorySampleOrigin',
        collection: 'super-category-sample-origin',
        de: 'Oberkategorie Probenursprung (Tier/Lebensmittel/Futtermittel)',
        en: 'Superordinate sample origin',
      },
      {
        attr: 'samplingStage',
        collection: 'sampling-stage',
        de: 'Probenahmestelle',
        en: 'Sampling stage',
      },
    ],
  },
  {
    collection: 'multi-resistance',
    sheet: 'multires',
    scalars: [
      { attr: 'dbId', column: 'string_dbid', type: 'string' },
      { attr: 'zomoProgram', column: 'ZoMo-Programm', type: 'string' },
      { attr: 'samplingYear', column: 'Jahr', type: 'integer' },
      {
        attr: 'resistanceGroup',
        column: 'multires_group_en',
        type: 'integer',
        codes: RESISTANCE_GROUP_CODES,
      },
      { attr: 'anzahlIsolate', column: 'no_res_isolates', type: 'integer' },
      { attr: 'anzahlGetesteterIsolate', column: 'total_isol', type: 'integer' },
    ],
    relations: [
      { attr: 'matrix', collection: 'matrix', de: 'Matrix_neu', en: 'Matrix_new' },
      { attr: 'matrixGroup', collection: 'matrix-group', de: 'Matrixgruppe', en: 'Matrix group' },
      {
        attr: 'microorganism',
        collection: 'microorganism',
        de: 'Mikroorganismus',
        en: 'Microorganism',
      },
      { attr: 'specie', collection: 'specie', de: 'Spezies', en: 'Species' },
      {
        attr: 'sampleOrigin',
        collection: 'sample-origin',
        de: 'Probenursprung (Tier/Lebensmittel/Futtermittel)',
        en: 'Sample origin',
      },
      {
        attr: 'superCategorySampleOrigin',
        collection: 'super-category-sample-origin',
        de: 'Oberkategorie Probenursprung (Tier/Lebensmittel/Futtermittel)',
        en: 'Superordinate sample origin',
      },
      {
        attr: 'samplingStage',
        collection: 'sampling-stage',
        de: 'Probenahmestelle',
        en: 'Sampling stage',
      },
      {
        attr: 'matrixDetail',
        collection: 'matrix-detail',
        de: 'Matrixdetail',
        en: 'Matrixdetail',
        shared: true,
      },
    ],
  },
];
