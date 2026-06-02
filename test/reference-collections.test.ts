import { describe, it, expect } from 'vitest';
import { REFERENCE_COLLECTIONS, referenceSpec } from '../src/core/reference-collections.js';

// The 10 reference collections the CLI owns: 9 standard-pattern (#003) plus the
// non-i18n outlier matrix-detail (#007).
const EXPECTED = [
  'matrix',
  'matrix-group',
  'matrix-detail',
  'sample-type',
  'sample-origin',
  'super-category-sample-origin',
  'sampling-stage',
  'specie',
  'antimicrobial-substance',
  'microorganism',
];

describe('REFERENCE_COLLECTIONS registry', () => {
  it('registers exactly the 10 reference collections', () => {
    const names = REFERENCE_COLLECTIONS.map((s) => s.collection).sort();
    expect(names).toEqual([...EXPECTED].sort());
  });

  it('name-only collections carry a single required paired name field', () => {
    for (const name of ['microorganism', 'specie', 'antimicrobial-substance']) {
      expect(referenceSpec(name).fields).toEqual([{ attr: 'name', paired: true, required: true }]);
    }
  });

  it('paired-iri collections carry a required paired name plus a paired iri', () => {
    for (const name of [
      'matrix-group',
      'sample-type',
      'sample-origin',
      'super-category-sample-origin',
      'sampling-stage',
    ]) {
      expect(referenceSpec(name).fields).toEqual([
        { attr: 'name', paired: true, required: true },
        { attr: 'iri', paired: true },
      ]);
    }
  });

  it('matrix carries a required paired name plus a single (non-localized) iri', () => {
    expect(referenceSpec('matrix').fields).toEqual([
      { attr: 'name', paired: true, required: true },
      { attr: 'iri', paired: false },
    ]);
  });

  it('matrix-detail is non-i18n: single (non-paired) required name + single iri', () => {
    const spec = referenceSpec('matrix-detail');
    expect(spec.localized).toBe(false);
    expect(spec.fields).toEqual([
      { attr: 'name', paired: false, required: true },
      { attr: 'iri', paired: false },
    ]);
  });

  it('the standard collections are localized by default (no explicit flag needed)', () => {
    // localized is optional and defaults to true; only matrix-detail opts out.
    expect(referenceSpec('matrix').localized).not.toBe(false);
    expect(referenceSpec('specie').localized).not.toBe(false);
  });
});
