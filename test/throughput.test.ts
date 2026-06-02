import { describe, it, expect } from 'vitest';
import { chunk } from '../src/core/throughput.js';

describe('chunk', () => {
  it('splits items into batches of the given size, last batch partial', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});
