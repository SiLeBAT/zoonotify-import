import { describe, it, expect } from 'vitest';
import { FACT_COLLECTIONS, factSpec } from '../src/core/fact-collections.js';

describe('FACT_COLLECTIONS registry', () => {
  it('registers exactly the two fact collections', () => {
    const names = FACT_COLLECTIONS.map((s) => s.collection).sort();
    expect(names).toEqual(['prevalence', 'resistance']);
  });

  it('resistance declares its 9 relations against the right reference collections', () => {
    const byAttr = Object.fromEntries(
      factSpec('resistance').relations.map((r) => [r.attr, r.collection]),
    );
    expect(byAttr).toEqual({
      matrix: 'matrix',
      matrixGroup: 'matrix-group',
      microorganism: 'microorganism',
      specie: 'specie',
      sampleType: 'sample-type',
      sampleOrigin: 'sample-origin',
      superCategorySampleOrigin: 'super-category-sample-origin',
      samplingStage: 'sampling-stage',
      antimicrobialSubstance: 'antimicrobial-substance',
    });
  });

  it('resistance keeps dbId as a required single scalar and zomoProgram as a paired scalar', () => {
    const scalars = Object.fromEntries(factSpec('resistance').scalars.map((s) => [s.attr, s]));
    expect(scalars.dbId).toEqual({ attr: 'dbId', paired: false, type: 'string', required: true });
    expect(scalars.zomoProgram).toEqual({ attr: 'zomoProgram', paired: true, type: 'string' });
  });

  it('prevalence declares its 6 relations and ignores matrixDetail_*/sampleType_* columns', () => {
    const spec = factSpec('prevalence');
    expect(spec.relations.map((r) => r.attr).sort()).toEqual([
      'matrix',
      'matrixGroup',
      'microorganism',
      'sampleOrigin',
      'samplingStage',
      'superCategorySampleOrigin',
    ]);
    expect(spec.ignoredColumns).toEqual(['matrixDetail', 'sampleType']);
  });

  it('prevalence has no dbId scalar', () => {
    expect(factSpec('prevalence').scalars.find((s) => s.attr === 'dbId')).toBeUndefined();
  });

  it('factSpec throws for an unregistered collection', () => {
    expect(() => factSpec('nope')).toThrow(/nope/);
  });
});
