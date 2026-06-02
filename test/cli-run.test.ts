import { describe, it, expect, vi } from 'vitest';
import ExcelJS from 'exceljs';
import { runImport } from '../src/cli/run.js';
import type { CliDeps } from '../src/cli/run.js';
import { buildWorkbook } from './fixtures/in-memory-workbook.js';
import { EXPECTED, EXPECTED_FACTS } from './integration/fixture.js';
import type {
  StrapiClient,
  TruncateResult,
  BulkCreateResult,
  LiveSchema,
} from '../src/core/strapi-client.js';
import type { BulkRow } from '../src/core/domain.js';
import type { ImportResult } from '../src/core/result.js';
import { RequestError } from '../src/core/errors.js';

/** A workbook that passes all ten pre-flight checks (built from the integration fixture). */
function validWorkbook(): ExcelJS.Workbook {
  return buildWorkbook([
    ...EXPECTED.map((e) => ({ name: e.collection, columns: e.columns, rows: e.rows })),
    ...EXPECTED_FACTS.map((f) => ({ name: f.collection, columns: f.columns, rows: f.rows })),
  ]);
}

class RecordingClient implements StrapiClient {
  calls: string[] = [];
  async truncate(collection: string): Promise<TruncateResult> {
    this.calls.push(`truncate:${collection}`);
    return { en: 0, de: 0 };
  }
  async bulkCreate(collection: string, rows: BulkRow[]): Promise<BulkCreateResult[]> {
    this.calls.push(`bulkCreate:${collection}`);
    return rows.map((_, i) => ({ rowIndex: i, documentId: `d${i}`, id_en: i + 1 }));
  }
  async fetchSchema(): Promise<LiveSchema> {
    return { attributes: {} }; // no required attrs → no schema drift
  }
}

const goodEnv = { STRAPI_URL: 'https://cms.example/api', STRAPI_TOKEN: 'tok' };

function deps(overrides: Partial<CliDeps> = {}): CliDeps {
  return {
    fileExists: async () => true,
    readWorkbook: async () => validWorkbook(),
    hashFile: async () => 'sha256-test-digest',
    parseReferences: async () => [
      { collection: 'specie', rows: [{ en: { name: 'Gallus gallus' } }] },
      { collection: 'matrix', rows: [{ en: { name: 'Chicken meat', iri: 'iri:1' } }] },
    ],
    parseFacts: async () => [],
    makeClient: () => new RecordingClient(),
    confirm: async () => true,
    writeResult: async () => {},
    now: () => '2026-06-01T00:00:00.000Z',
    isTty: () => false,
    log: () => {},
    error: () => {},
    ...overrides,
  };
}

describe('runImport — argument and environment guards', () => {
  it('exits 1 when the workbook path argument is missing', async () => {
    expect(await runImport(undefined, goodEnv, deps())).toBe(1);
  });

  it('exits 1 when STRAPI_URL or STRAPI_TOKEN is missing', async () => {
    expect(await runImport('wb.xlsx', { STRAPI_URL: 'http://x' }, deps())).toBe(1);
    expect(await runImport('wb.xlsx', { STRAPI_TOKEN: 'tok' }, deps())).toBe(1);
  });

  it('exits 1 when the workbook file does not exist', async () => {
    expect(await runImport('missing.xlsx', goodEnv, deps({ fileExists: async () => false }))).toBe(
      1,
    );
  });
});

describe('runImport — transport hardening', () => {
  it('refuses an http:// STRAPI_URL with a clear error and exits 1 before touching the DB', async () => {
    const client = new RecordingClient();
    const errors: string[] = [];
    const code = await runImport(
      'wb.xlsx',
      { STRAPI_URL: 'http://insecure.example/api', STRAPI_TOKEN: 'tok' },
      deps({ makeClient: () => client, error: (m) => errors.push(m) }),
    );

    expect(code).toBe(1);
    expect(client.calls).toEqual([]);
    expect(errors.some((m) => /http:\/\//.test(m) && /--insecure/.test(m))).toBe(true);
  });

  it('allows http:// when --insecure is passed and prints a loud stderr warning', async () => {
    const client = new RecordingClient();
    const errors: string[] = [];
    const code = await runImport(
      'wb.xlsx',
      { STRAPI_URL: 'http://insecure.example/api', STRAPI_TOKEN: 'tok' },
      deps({ makeClient: () => client, error: (m) => errors.push(m) }),
      { insecure: true },
    );

    expect(code).toBe(0);
    expect(errors.some((m) => /INSECURE|WARNING/i.test(m) && /http/i.test(m))).toBe(true);
    expect(client.calls).toContain('bulkCreate:specie');
  });

  it('normalizes a trailing slash off STRAPI_URL before constructing the client', async () => {
    let seenUrl = '';
    await runImport(
      'wb.xlsx',
      { STRAPI_URL: 'https://cms.example/api/', STRAPI_TOKEN: 'tok' },
      deps({
        makeClient: (baseUrl) => {
          seenUrl = baseUrl;
          return new RecordingClient();
        },
      }),
    );

    expect(seenUrl).toBe('https://cms.example/api');
  });
});

describe('runImport — pre-flight gate', () => {
  it('exits 2, writes a preflight-failed result, and never touches the DB when pre-flight has errors', async () => {
    const client = new RecordingClient();
    const results: ImportResult[] = [];
    // Workbook missing the resistance sheet → check #2 error.
    const broken = buildWorkbook(
      EXPECTED.map((e) => ({ name: e.collection, columns: e.columns, rows: e.rows })),
    );

    const code = await runImport(
      'wb.xlsx',
      goodEnv,
      deps({
        makeClient: () => client,
        readWorkbook: async () => broken,
        writeResult: async (r) => {
          results.push(r);
        },
      }),
    );

    expect(code).toBe(2);
    expect(client.calls).toEqual([]);
    expect(results.at(-1)?.outcome).toBe('preflight-failed');
    expect(results.at(-1)?.preflight.errors.some((f) => f.check === 2)).toBe(true);
  });
});

describe('runImport — unreadable workbook (check #1)', () => {
  it('exits 2 with a check-1 preflight-failed result when the file is not valid xlsx', async () => {
    const client = new RecordingClient();
    const results: ImportResult[] = [];
    const code = await runImport(
      'wb.xlsx',
      goodEnv,
      deps({
        makeClient: () => client,
        readWorkbook: async () => {
          throw new Error('not a zip file');
        },
        writeResult: async (r) => {
          results.push(r);
        },
      }),
    );

    expect(code).toBe(2);
    expect(client.calls).toEqual([]);
    expect(results.at(-1)?.outcome).toBe('preflight-failed');
    expect(results.at(-1)?.preflight.errors.some((f) => f.check === 1)).toBe(true);
  });
});

describe('runImport — dry run', () => {
  it('runs pre-flight, prints a summary, writes a dry-run result, and exits 0 without importing', async () => {
    const client = new RecordingClient();
    const results: ImportResult[] = [];
    const logs: string[] = [];

    const code = await runImport(
      'wb.xlsx',
      goodEnv,
      deps({
        makeClient: () => client,
        writeResult: async (r) => {
          results.push(r);
        },
        log: (m) => logs.push(m),
      }),
      { dryRun: true },
    );

    expect(code).toBe(0);
    expect(client.calls).toEqual([]);
    expect(results.at(-1)?.outcome).toBe('dry-run');
    expect(logs.some((l) => /Pre-flight/i.test(l))).toBe(true);
  });
});

describe('runImport — confirmation', () => {
  it('imports without prompting on a non-TTY run', async () => {
    const client = new RecordingClient();
    const confirm = vi.fn(async () => true);
    const code = await runImport(
      'wb.xlsx',
      goodEnv,
      deps({ makeClient: () => client, confirm, isTty: () => false }),
    );

    expect(code).toBe(0);
    expect(confirm).not.toHaveBeenCalled();
    expect(client.calls).toContain('bulkCreate:specie');
  });

  it('prompts on a TTY and exits 3 with a declined result when the operator says no', async () => {
    const client = new RecordingClient();
    const results: ImportResult[] = [];
    const code = await runImport(
      'wb.xlsx',
      goodEnv,
      deps({
        makeClient: () => client,
        isTty: () => true,
        confirm: async () => false,
        writeResult: async (r) => {
          results.push(r);
        },
      }),
    );

    expect(code).toBe(3);
    expect(client.calls).toEqual([]);
    expect(results.at(-1)?.outcome).toBe('declined');
  });

  it('proceeds when the operator confirms on a TTY', async () => {
    const client = new RecordingClient();
    const code = await runImport(
      'wb.xlsx',
      goodEnv,
      deps({ makeClient: () => client, isTty: () => true, confirm: async () => true }),
    );
    expect(code).toBe(0);
    expect(client.calls).toContain('truncate:matrix');
  });

  it('skips the prompt when --yes is passed even on a TTY', async () => {
    const client = new RecordingClient();
    const confirm = vi.fn(async () => false);
    const code = await runImport(
      'wb.xlsx',
      goodEnv,
      deps({ makeClient: () => client, isTty: () => true, confirm }),
      { yes: true },
    );

    expect(code).toBe(0);
    expect(confirm).not.toHaveBeenCalled();
    expect(client.calls).toContain('bulkCreate:specie');
  });
});

describe('runImport — circuit breaker', () => {
  it('exits 5, writes a circuit-breaker result, and points the operator at the result file', async () => {
    // A client whose bulk-creates always 503 → the breaker trips.
    class DownClient extends RecordingClient {
      override async bulkCreate(collection: string, rows: BulkRow[]): Promise<never> {
        void rows;
        this.calls.push(`bulkCreate:${collection}`);
        throw new RequestError('down', { status: 503 });
      }
    }
    const client = new DownClient();
    const results: ImportResult[] = [];
    const errors: string[] = [];

    const code = await runImport(
      'wb.xlsx',
      goodEnv,
      deps({
        makeClient: () => client,
        writeResult: async (r) => {
          results.push(r);
        },
        error: (m) => errors.push(m),
      }),
      // No retry waits, trip on the first failed batch.
      {
        throughput: {
          batchSize: 1,
          concurrency: 1,
          requestTimeoutMs: 30000,
          maxRetries: 0,
          circuitBreakerThreshold: 1,
        },
      },
    );

    expect(code).toBe(5);
    expect(results.at(-1)?.outcome).toBe('circuit-breaker');
    expect(errors.some((m) => /circuit breaker/i.test(m) && /result file/i.test(m))).toBe(true);
  });
});

describe('runImport — import failure (non-circuit-breaker)', () => {
  it('exits 4, writes an import-failed result, and warns the DB is partial when an import error is not the breaker', async () => {
    // A client whose truncate rejects with a plain (non-RequestError) failure —
    // never retried, never the breaker, but the import is wrecked mid-run.
    class BrokenTruncateClient extends RecordingClient {
      override async truncate(collection: string): Promise<TruncateResult> {
        this.calls.push(`truncate:${collection}`);
        throw new Error('relation does not exist');
      }
    }
    const client = new BrokenTruncateClient();
    const results: ImportResult[] = [];
    const errors: string[] = [];

    const code = await runImport(
      'wb.xlsx',
      goodEnv,
      deps({
        makeClient: () => client,
        writeResult: async (r) => {
          results.push(r);
        },
        error: (m) => errors.push(m),
      }),
    );

    expect(code).toBe(4);
    expect(results.at(-1)?.outcome).toBe('import-failed');
    expect(errors.some((m) => /partial/i.test(m) && /result file/i.test(m))).toBe(true);
  });
});

describe('runImport — result file contents', () => {
  it('stamps a successful result with exitCode, source-file sha256 and per-batch collection detail', async () => {
    const client = new RecordingClient();
    const results: ImportResult[] = [];
    const code = await runImport(
      'wb.xlsx',
      goodEnv,
      deps({
        makeClient: () => client,
        hashFile: async () => 'deadbeef',
        writeResult: async (r) => {
          results.push(r);
        },
      }),
    );

    expect(code).toBe(0);
    const result = results.at(-1)!;
    expect(result.exitCode).toBe(0);
    expect(result.sourceFile).toEqual({ path: 'wb.xlsx', sha256: 'deadbeef' });
    expect(typeof result.startedAt).toBe('string');
    expect(typeof result.completedAt).toBe('string');
    const specie = result.collections.find((c) => c.collection === 'specie');
    expect(specie).toBeDefined();
    expect(specie!.batches.length).toBeGreaterThan(0);
    expect(specie!.batches[0]).toMatchObject({ index: 0, outcome: 'created' });
    expect(result.failures).toEqual([]);
  });

  it('writes the result to the path given by --report', async () => {
    let seenPath = '';
    await runImport(
      'wb.xlsx',
      goodEnv,
      deps({
        writeResult: async (_r, path) => {
          seenPath = path;
        },
      }),
      { report: '/tmp/my-result.json' },
    );

    expect(seenPath).toBe('/tmp/my-result.json');
  });

  it('logs per-batch timing when --verbose is set', async () => {
    const logs: string[] = [];
    await runImport('wb.xlsx', goodEnv, deps({ log: (m) => logs.push(m) }), { verbose: true });
    expect(logs.some((l) => /^batch /.test(l) && /created/.test(l))).toBe(true);
  });

  it('records the breaker failure in the result failures[] (exit 5)', async () => {
    class DownClient extends RecordingClient {
      override async bulkCreate(collection: string): Promise<never> {
        this.calls.push(`bulkCreate:${collection}`);
        throw new RequestError('down', { status: 503 });
      }
    }
    const results: ImportResult[] = [];
    const code = await runImport(
      'wb.xlsx',
      goodEnv,
      deps({
        makeClient: () => new DownClient(),
        writeResult: async (r) => {
          results.push(r);
        },
      }),
      {
        throughput: {
          batchSize: 1,
          concurrency: 1,
          requestTimeoutMs: 30000,
          maxRetries: 0,
          circuitBreakerThreshold: 1,
        },
      },
    );

    expect(code).toBe(5);
    const result = results.at(-1)!;
    expect(result.exitCode).toBe(5);
    expect(result.failures.length).toBeGreaterThan(0);
    expect(result.failures.some((f) => /down/.test(f.message))).toBe(true);
  });
});

describe('runImport — success', () => {
  it('imports facts after references and writes a success result', async () => {
    const client = new RecordingClient();
    const results: ImportResult[] = [];
    const code = await runImport(
      'wb.xlsx',
      goodEnv,
      deps({
        makeClient: () => client,
        writeResult: async (r) => {
          results.push(r);
        },
        parseFacts: async () => [
          {
            collection: 'resistance',
            rows: [
              {
                rowNumber: 2,
                hasDe: false,
                scalars: { en: { dbId: 'R-1' }, de: { dbId: 'R-1' } },
                relations: [{ attr: 'matrix', collection: 'matrix', en: 'Chicken meat' }],
              },
            ],
          },
        ],
      }),
    );

    expect(code).toBe(0);
    expect(client.calls).toEqual([
      'truncate:resistance',
      'truncate:specie',
      'truncate:matrix',
      'bulkCreate:specie',
      'bulkCreate:matrix',
      'bulkCreate:resistance',
    ]);
    expect(results.at(-1)?.outcome).toBe('success');
  });
});
