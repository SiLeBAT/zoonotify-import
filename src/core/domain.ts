/**
 * The localized attributes of one reference row, per locale. `name` is always
 * present (required + unique); `iri` is optional and only present for the
 * collections whose schema carries it. For `matrix` — whose `iri` is a single
 * non-localized column — `iri` rides on the `en` payload only.
 */
export type LocaleFields = {
  name: string;
  iri?: string;
};

/**
 * One parsed row of an i18n-localized reference collection, ready to hand to
 * the StrapiClient port. `en` is the base locale (always present); `de` is the
 * optional translation. The Import admin API links them by documentId.
 */
export type LocalizedRow = {
  en: LocaleFields;
  de?: LocaleFields;
};

/** A scalar attribute value on a payload sent to bulk-create. */
export type AttrValue = string | number;

/**
 * The generic row shape the bulk-create port accepts: `en`/`de` are arbitrary
 * attribute maps. Reference rows (LocalizedRow) are a narrow special case; fact
 * rows carry scalars plus relation fields already resolved to integer IDs.
 * Values are `unknown` so any object payload (including LocaleFields) assigns
 * here without needing an explicit index signature.
 */
export interface BulkRow {
  en: Record<string, unknown>;
  de?: Record<string, unknown>;
}

/**
 * One relation reference on a parsed fact row, kept by name+locale until the
 * orchestrator translates it to a Strapi ID via the relation map (ADR 0005).
 * A locale's name is absent when that cell was empty/sentinel.
 */
export interface FactRelationRef {
  /** Attribute name on the fact (e.g. `matrix`). */
  attr: string;
  /** Reference collection the name resolves against (e.g. `matrix`). */
  collection: string;
  en?: string;
  de?: string;
}

/**
 * One parsed fact-table row, pre-resolution. Scalars are split into the values
 * destined for each locale's payload (single columns are shared into both,
 * paired columns split by suffix). `hasDe` records whether the row supplies any
 * DE-side data at all; when false the orchestrator sends the EN payload only.
 */
export interface ParsedFactRow {
  /** 1-based worksheet row number, for pre-flight failure messages. */
  rowNumber: number;
  hasDe: boolean;
  scalars: {
    en: Record<string, AttrValue>;
    de: Record<string, AttrValue>;
  };
  relations: FactRelationRef[];
}
