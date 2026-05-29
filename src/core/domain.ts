/**
 * The localized attributes of one reference row, per locale. `name` is always
 * present (required + unique); `iri` is optional and only present for the
 * collections whose schema carries it. For `matrix` — whose `iri` is a single
 * non-localized column — `iri` rides on the `en` payload only.
 */
export interface LocaleFields {
  name: string;
  iri?: string;
}

/**
 * One parsed row of an i18n-localized reference collection, ready to hand to
 * the StrapiClient port. `en` is the base locale (always present); `de` is the
 * optional translation. The Import admin API links them by documentId.
 */
export interface LocalizedRow {
  en: LocaleFields;
  de?: LocaleFields;
}
