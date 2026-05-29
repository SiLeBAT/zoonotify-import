/**
 * One parsed row of an i18n-localized reference collection, ready to hand to
 * the StrapiClient port. `en` is the base locale (always present); `de` is the
 * optional translation. The Import admin API links them by documentId.
 */
export interface LocalizedRow {
  en: { name: string };
  de?: { name: string };
}
