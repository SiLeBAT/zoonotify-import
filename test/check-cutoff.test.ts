import { describe, it, expect } from 'vitest';
import { checkCutoff } from '../src/core/preflight-checks.js';

describe('checkCutoff (check #9)', () => {
  it('is a documented no-op for v1 (cut-off is excluded — ADR 0006)', () => {
    expect(checkCutoff()).toEqual([]);
  });
});
