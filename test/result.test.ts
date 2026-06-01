import { describe, it, expect } from 'vitest';
import { buildResult } from '../src/core/result.js';
import type { PreflightReport } from '../src/core/preflight.js';

const report: PreflightReport = {
  ok: false,
  errors: [
    {
      check: 5,
      level: 'error',
      sheet: 'resistance',
      row: 2,
      field: 'dbId',
      message: 'required field `dbId` is empty',
    },
  ],
  warnings: [
    {
      check: 8,
      level: 'warning',
      sheet: 'specie',
      row: 3,
      field: 'name_de',
      message: 'missing DE translation',
    },
  ],
  summary: { collections: 11, rowsByCollection: { resistance: 1 }, totalRows: 1 },
};

describe('buildResult', () => {
  it('records the outcome, timestamp and the full pre-flight section', () => {
    const result = buildResult({
      outcome: 'preflight-failed',
      timestamp: '2026-06-01T00:00:00.000Z',
      preflight: report,
    });

    expect(result.outcome).toBe('preflight-failed');
    expect(result.timestamp).toBe('2026-06-01T00:00:00.000Z');
    expect(result.preflight.ok).toBe(false);
    expect(result.preflight.errors).toHaveLength(1);
    expect(result.preflight.errors[0]).toMatchObject({
      check: 5,
      sheet: 'resistance',
      row: 2,
      field: 'dbId',
    });
    expect(result.preflight.warnings[0]).toMatchObject({ check: 8, sheet: 'specie' });
    expect(result.preflight.summary.collections).toBe(11);
  });

  it('includes the per-collection import outcome when an import ran', () => {
    const result = buildResult({
      outcome: 'success',
      timestamp: '2026-06-01T00:00:00.000Z',
      preflight: { ...report, ok: true, errors: [] },
      collections: [{ collection: 'specie', deleted: { en: 2, de: 2 }, created: 1 }],
    });

    expect(result.outcome).toBe('success');
    expect(result.collections).toEqual([
      { collection: 'specie', deleted: { en: 2, de: 2 }, created: 1 },
    ]);
  });

  it('serializes to JSON without throwing', () => {
    const result = buildResult({ outcome: 'dry-run', timestamp: 'now', preflight: report });
    expect(() => JSON.stringify(result)).not.toThrow();
  });
});
