import { describe, it, expect } from 'vitest';
import { describeAllCollections, describeCollection } from '../src/core/descriptors.js';

describe('describeAllCollections', () => {
  it('describes all 12 xlsx-managed collections the CLI owns', () => {
    const names = describeAllCollections()
      .map((d) => d.collection)
      .sort();
    expect(names).toEqual(
      [
        'antimicrobial-substance',
        'matrix',
        'matrix-detail',
        'matrix-group',
        'microorganism',
        'prevalence',
        'resistance',
        'sample-origin',
        'sample-type',
        'sampling-stage',
        'specie',
        'super-category-sample-origin',
      ].sort(),
    );
  });
});

describe('describeCollection — matrix-detail (non-i18n)', () => {
  it('marks the collection not localized', () => {
    expect(describeCollection('matrix-detail').localized).toBe(false);
  });

  it('models name as a single required+unique non-localized column (no _en/_de)', () => {
    const name = describeCollection('matrix-detail').columns.find((c) => c.attr === 'name');
    expect(name).toEqual({
      name: 'name',
      attr: 'name',
      type: 'string',
      required: true,
      unique: true,
      isRelation: false,
    });
  });

  it('models iri as a single optional non-localized column', () => {
    const iri = describeCollection('matrix-detail').columns.find((c) => c.attr === 'iri');
    expect(iri).toEqual({
      name: 'iri',
      attr: 'iri',
      type: 'string',
      required: false,
      unique: false,
      isRelation: false,
    });
  });
});

describe('describeCollection — references', () => {
  it('expands a paired name into name_en/name_de with EN required+unique and DE optional', () => {
    const cols = describeCollection('specie').columns;
    expect(cols).toEqual([
      {
        name: 'name_en',
        attr: 'name',
        locale: 'en',
        type: 'string',
        required: true,
        unique: true,
        isRelation: false,
      },
      {
        name: 'name_de',
        attr: 'name',
        locale: 'de',
        type: 'string',
        required: false,
        unique: false,
        isRelation: false,
      },
    ]);
  });

  it("treats matrix's single iri as one non-localized, optional column", () => {
    const iri = describeCollection('matrix').columns.find((c) => c.attr === 'iri');
    expect(iri).toEqual({
      name: 'iri',
      attr: 'iri',
      type: 'string',
      required: false,
      unique: false,
      isRelation: false,
    });
  });
});

describe('describeCollection — facts', () => {
  it('marks dbId a required+unique single string scalar', () => {
    const dbId = describeCollection('resistance').columns.find((c) => c.attr === 'dbId');
    expect(dbId).toEqual({
      name: 'dbId',
      attr: 'dbId',
      type: 'string',
      required: true,
      unique: true,
      isRelation: false,
    });
  });

  it('expands relations into paired _en/_de relation columns carrying the target collection', () => {
    const cols = describeCollection('resistance').columns.filter((c) => c.attr === 'matrix');
    expect(cols).toEqual([
      {
        name: 'matrix_en',
        attr: 'matrix',
        locale: 'en',
        type: 'string',
        required: false,
        unique: false,
        isRelation: true,
        relationCollection: 'matrix',
      },
      {
        name: 'matrix_de',
        attr: 'matrix',
        locale: 'de',
        type: 'string',
        required: false,
        unique: false,
        isRelation: true,
        relationCollection: 'matrix',
      },
    ]);
  });

  it('models samplingYear as a required integer scalar', () => {
    const year = describeCollection('resistance').columns.find((c) => c.attr === 'samplingYear');
    expect(year).toMatchObject({ name: 'samplingYear', type: 'integer', required: true });
  });
});
