import { describe, it, expect } from 'vitest';
import { resolveFactRow } from '../src/core/orchestrator.js';
import { RelationMap } from '../src/core/relation-map.js';
import { ImportError } from '../src/core/errors.js';
import type { ParsedFactRow } from '../src/core/domain.js';

function mapWith(...entries: [string, 'en' | 'de', string, number][]): RelationMap {
  const map = new RelationMap();
  for (const [c, l, n, id] of entries) map.add(c, l, n, id);
  return map;
}

describe('resolveFactRow', () => {
  it('stamps EN and DE payloads with the IDs from the relation map', () => {
    const map = mapWith(
      ['matrix', 'en', 'Chicken meat', 7],
      ['matrix', 'de', 'Hähnchenfleisch', 107],
    );
    const row: ParsedFactRow = {
      rowNumber: 2,
      hasDe: true,
      scalars: { en: { dbId: 'R-1', samplingYear: 2024 }, de: { dbId: 'R-1', samplingYear: 2024 } },
      relations: [
        { attr: 'matrix', collection: 'matrix', en: 'Chicken meat', de: 'Hähnchenfleisch' },
      ],
    };

    const bulk = resolveFactRow(row, map);

    expect(bulk.en).toEqual({ dbId: 'R-1', samplingYear: 2024, matrix: 7 });
    expect(bulk.de).toEqual({ dbId: 'R-1', samplingYear: 2024, matrix: 107 });
  });

  it('omits the DE payload entirely when the row has no DE half', () => {
    const map = mapWith(['matrix', 'en', 'Chicken meat', 7]);
    const row: ParsedFactRow = {
      rowNumber: 2,
      hasDe: false,
      scalars: { en: { dbId: 'R-1' }, de: { dbId: 'R-1' } },
      relations: [{ attr: 'matrix', collection: 'matrix', en: 'Chicken meat' }],
    };

    const bulk = resolveFactRow(row, map);

    expect(bulk.en).toEqual({ dbId: 'R-1', matrix: 7 });
    expect(bulk.de).toBeUndefined();
  });

  it('omits a relation whose locale name is absent rather than stamping a null', () => {
    const map = mapWith(['matrix', 'en', 'Chicken meat', 7]);
    const row: ParsedFactRow = {
      rowNumber: 2,
      hasDe: false,
      scalars: { en: {}, de: {} },
      relations: [
        { attr: 'matrix', collection: 'matrix', en: 'Chicken meat' },
        { attr: 'specie', collection: 'specie' }, // no name on either locale
      ],
    };

    const bulk = resolveFactRow(row, map);
    expect(bulk.en).toEqual({ matrix: 7 });
    expect('specie' in bulk.en).toBe(false);
  });

  it('throws ImportError when a present relation name is missing from the map', () => {
    const map = mapWith(); // empty
    const row: ParsedFactRow = {
      rowNumber: 9,
      hasDe: false,
      scalars: { en: {}, de: {} },
      relations: [{ attr: 'matrix', collection: 'matrix', en: 'Chicken meat' }],
    };

    expect(() => resolveFactRow(row, map)).toThrow(ImportError);
  });
});
