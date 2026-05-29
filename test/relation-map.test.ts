import { describe, it, expect } from 'vitest';
import { RelationMap } from '../src/core/relation-map.js';

describe('RelationMap', () => {
  it('returns the id added for a (collection, locale, name) key', () => {
    const map = new RelationMap();
    map.add('matrix', 'en', 'Chicken meat', 42);
    map.add('matrix', 'de', 'Hähnchenfleisch', 43);

    expect(map.get('matrix', 'en', 'Chicken meat')).toBe(42);
    expect(map.get('matrix', 'de', 'Hähnchenfleisch')).toBe(43);
  });

  it('keys are scoped by collection and locale (no cross-talk)', () => {
    const map = new RelationMap();
    map.add('matrix', 'en', 'Chicken meat', 42);

    expect(map.get('sample-type', 'en', 'Chicken meat')).toBeUndefined();
    expect(map.get('matrix', 'de', 'Chicken meat')).toBeUndefined();
    expect(map.get('matrix', 'en', 'Unknown')).toBeUndefined();
  });

  it('size reflects the number of entries added', () => {
    const map = new RelationMap();
    expect(map.size).toBe(0);
    map.add('specie', 'en', 'Gallus gallus', 1);
    map.add('specie', 'de', 'Haushuhn', 2);
    expect(map.size).toBe(2);
  });
});
