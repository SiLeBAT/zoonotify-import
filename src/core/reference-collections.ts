/**
 * Declarative description of the standard-pattern reference collections the
 * Import CLI parses. Each collection maps to one workbook sheet (sheet name =
 * Strapi API singular) and a list of localized fields. The generic parser in
 * parser.ts is driven entirely by these specs — adding a collection is a data
 * change here, not new parsing code. See docs/import-cli-spec/source-xlsx-format.md §4.1.
 */

/**
 * One localized attribute of a reference collection.
 * - `paired`: the sheet carries `<attr>_en` and `<attr>_de` columns; each value
 *   lands on its own locale's payload.
 * - single (`paired: false`): the sheet carries one bare `<attr>` column for an
 *   attribute that is *not* localized in Strapi (e.g. `matrix.iri`). The value
 *   lands on the `en` base payload only.
 */
export interface ReferenceField {
  attr: string;
  paired: boolean;
  /** Whether a value is required in the base (`en`) locale. `name` is always required + unique. */
  required?: boolean;
}

export interface ReferenceCollectionSpec {
  /** Strapi API singular name; also the workbook sheet name. */
  collection: string;
  fields: ReferenceField[];
  /**
   * Whether the collection is i18n-localized in Strapi. Defaults to `true`.
   * Only `matrix-detail` sets this `false`: its sheet has bare `name`/`iri`
   * columns (no `_en`/`_de`) and bulk-create sends a flat row with no DE-locale
   * follow-up. See docs/import-cli-spec/source-xlsx-format.md §6.
   */
  localized?: boolean;
}

const NAME_ONLY: ReferenceField[] = [{ attr: 'name', paired: true, required: true }];
const NAME_AND_PAIRED_IRI: ReferenceField[] = [
  { attr: 'name', paired: true, required: true },
  { attr: 'iri', paired: true },
];

export const REFERENCE_COLLECTIONS: ReferenceCollectionSpec[] = [
  // name-only (no iri in schema)
  { collection: 'microorganism', fields: NAME_ONLY },
  { collection: 'specie', fields: NAME_ONLY },
  { collection: 'antimicrobial-substance', fields: NAME_ONLY },
  // matrix.iri is a single non-localized column; it rides on the en payload only.
  {
    collection: 'matrix',
    fields: [
      { attr: 'name', paired: true, required: true },
      { attr: 'iri', paired: false },
    ],
  },
  // matrix-detail is the only non-i18n reference collection: bare name/iri, no
  // locale suffix, one row per entity, no DE-locale follow-up on bulk-create.
  {
    collection: 'matrix-detail',
    localized: false,
    fields: [
      { attr: 'name', paired: false, required: true },
      { attr: 'iri', paired: false },
    ],
  },
  // standard paired name + paired iri
  { collection: 'matrix-group', fields: NAME_AND_PAIRED_IRI },
  { collection: 'sample-type', fields: NAME_AND_PAIRED_IRI },
  { collection: 'sample-origin', fields: NAME_AND_PAIRED_IRI },
  { collection: 'super-category-sample-origin', fields: NAME_AND_PAIRED_IRI },
  { collection: 'sampling-stage', fields: NAME_AND_PAIRED_IRI },
];

/** Looks up a reference collection spec by name, throwing if it is not registered. */
export function referenceSpec(collection: string): ReferenceCollectionSpec {
  const spec = REFERENCE_COLLECTIONS.find((s) => s.collection === collection);
  if (!spec) {
    throw new Error(`No reference-collection spec registered for "${collection}"`);
  }
  return spec;
}
