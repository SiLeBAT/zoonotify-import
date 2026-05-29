import { describe, it, expect } from 'vitest';
import { REFERENCE_COLLECTIONS, referenceSpec } from '../src/core/reference-collections.js';

// The 9 standard-pattern reference collections this issue (#003) covers.
// matrix-detail is the non-i18n outlier and is deferred to #007.
const EXPECTED = [
  'matrix',
  'matrix-group',
  'sample-type',
  'sample-origin',
  'super-category-sample-origin',
  'sampling-stage',
  'specie',
  'antimicrobial-substance',
  'microorganism',
];

describe('REFERENCE_COLLECTIONS registry', () => {
  it('registers exactly the 9 standard reference collections', () => {
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
});
