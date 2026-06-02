import { describe, it, expect } from 'vitest';
import { buildResult } from '../src/core/result.js';
import type { PreflightReport } from '../src/core/preflight.js';
import type { CollectionResult, ImportFailure } from '../src/core/result.js';

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

const sourceFile = { path: '/data/ZooNotify_DB.xlsx', sha256: 'abc123' };

function base() {
  return {
    startedAt: '2026-06-01T00:00:00.000Z',
    completedAt: '2026-06-01T00:00:05.000Z',
    sourceFile,
    preflight: report,
  };
}

describe('buildResult — top-level envelope', () => {
  it('records outcome, exitCode, started/completed timestamps and the source-file fingerprint', () => {
    const result = buildResult({ outcome: 'preflight-failed', exitCode: 2, ...base() });

    expect(result.outcome).toBe('preflight-failed');
    expect(result.exitCode).toBe(2);
    expect(result.startedAt).toBe('2026-06-01T00:00:00.000Z');
    expect(result.completedAt).toBe('2026-06-01T00:00:05.000Z');
    expect(result.sourceFile).toEqual({ path: '/data/ZooNotify_DB.xlsx', sha256: 'abc123' });
  });

  it('always carries the full pre-flight section', () => {
    const result = buildResult({ outcome: 'preflight-failed', exitCode: 2, ...base() });
    expect(result.preflight.ok).toBe(false);
    expect(result.preflight.errors[0]).toMatchObject({
      check: 5,
      sheet: 'resistance',
      field: 'dbId',
    });
    expect(result.preflight.warnings[0]).toMatchObject({ check: 8, sheet: 'specie' });
    expect(result.preflight.summary.collections).toBe(11);
  });

  it('defaults collections and failures to empty arrays when none are supplied', () => {
    const result = buildResult({ outcome: 'dry-run', exitCode: 0, ...base() });
    expect(result.collections).toEqual([]);
    expect(result.failures).toEqual([]);
  });
});

describe('buildResult — collections with per-batch detail', () => {
  it('records truncate + insert counts and the per-batch breakdown', () => {
    const collections: CollectionResult[] = [
      {
        collection: 'specie',
        deleted: { en: 2, de: 2 },
        created: 3,
        batches: [
          { index: 0, rows: 2, outcome: 'created', attempts: 1, durationMs: 12 },
          { index: 1, rows: 1, outcome: 'created', attempts: 2, durationMs: 40 },
        ],
      },
    ];
    const result = buildResult({ outcome: 'success', exitCode: 0, ...base(), collections });

    expect(result.collections).toEqual(collections);
    expect(result.collections[0]!.batches).toHaveLength(2);
    expect(result.collections[0]!.batches[1]).toMatchObject({ attempts: 2, outcome: 'created' });
  });
});

describe('buildResult — failures', () => {
  it('carries diagnostic failure records when the import broke', () => {
    const failures: ImportFailure[] = [
      {
        collection: 'matrix',
        batchIndex: 0,
        status: 503,
        message: 'POST /import-admin/bulk-create failed: 503',
      },
    ];
    const result = buildResult({
      outcome: 'circuit-breaker',
      exitCode: 5,
      ...base(),
      failures,
    });
    expect(result.failures).toEqual(failures);
  });

  it('serializes to JSON without throwing', () => {
    const result = buildResult({ outcome: 'dry-run', exitCode: 0, ...base() });
    expect(() => JSON.stringify(result)).not.toThrow();
  });
});
