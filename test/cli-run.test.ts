import { describe, it, expect } from 'vitest';
import { runImport } from '../src/cli/run.js';
import type { CliDeps } from '../src/cli/run.js';
import type { StrapiClient, TruncateResult, BulkCreateResult } from '../src/core/strapi-client.js';
import type { BulkRow } from '../src/core/domain.js';

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
  fetchSchema(): Promise<never> {
    throw new Error('unused');
  }
}

const goodEnv = { STRAPI_URL: 'http://localhost:3000', STRAPI_TOKEN: 'tok' };

function deps(overrides: Partial<CliDeps> = {}): CliDeps {
  return {
    fileExists: async () => true,
    parseReferences: async () => [
      { collection: 'specie', rows: [{ en: { name: 'Gallus gallus' } }] },
      { collection: 'matrix', rows: [{ en: { name: 'Chicken meat', iri: 'iri:1' } }] },
    ],
    parseFacts: async () => [],
    makeClient: () => new RecordingClient(),
    log: () => {},
    error: () => {},
    ...overrides,
  };
}

describe('runImport', () => {
  it('exits 1 when the workbook path argument is missing', async () => {
    const code = await runImport(undefined, goodEnv, deps());
    expect(code).toBe(1);
  });

  it('exits 1 when STRAPI_URL or STRAPI_TOKEN is missing', async () => {
    expect(await runImport('wb.xlsx', { STRAPI_URL: 'http://x' }, deps())).toBe(1);
    expect(await runImport('wb.xlsx', { STRAPI_TOKEN: 'tok' }, deps())).toBe(1);
  });

  it('exits 1 when the workbook file does not exist', async () => {
    const code = await runImport('missing.xlsx', goodEnv, deps({ fileExists: async () => false }));
    expect(code).toBe(1);
  });

  it('exits 0 and truncates all reference collections before bulk-creating any', async () => {
    const client = new RecordingClient();
    const code = await runImport('wb.xlsx', goodEnv, deps({ makeClient: () => client }));

    expect(code).toBe(0);
    expect(client.calls).toEqual([
      'truncate:specie',
      'truncate:matrix',
      'bulkCreate:specie',
      'bulkCreate:matrix',
    ]);
  });

  it('exits 2 and leaves the DB untouched when a fact references an unknown name (pre-flight #7)', async () => {
    const client = new RecordingClient();
    const errors: string[] = [];
    const code = await runImport(
      'wb.xlsx',
      goodEnv,
      deps({
        makeClient: () => client,
        error: (m) => errors.push(m),
        parseFacts: async () => [
          {
            collection: 'resistance',
            rows: [
              {
                rowNumber: 2,
                hasDe: false,
                scalars: { en: {}, de: {} },
                relations: [{ attr: 'matrix', collection: 'matrix', en: 'Mystery meat' }],
              },
            ],
          },
        ],
      }),
    );

    expect(code).toBe(2);
    expect(client.calls).toEqual([]); // no truncate, no bulk-create
    expect(errors.some((e) => e.includes("`matrix_en = 'Mystery meat'`"))).toBe(true);
  });

  it('imports facts after references, stamping resolved relation IDs', async () => {
    const client = new RecordingClient();
    const code = await runImport(
      'wb.xlsx',
      goodEnv,
      deps({
        makeClient: () => client,
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
      'truncate:resistance', // fact tables truncated first
      'truncate:specie',
      'truncate:matrix',
      'bulkCreate:specie',
      'bulkCreate:matrix',
      'bulkCreate:resistance', // facts created last
    ]);
  });

  it('logs a note naming the spec-ignored columns that were dropped', async () => {
    const logs: string[] = [];
    const code = await runImport(
      'wb.xlsx',
      goodEnv,
      deps({
        log: (m) => logs.push(m),
        parseFacts: async () => [
          {
            collection: 'prevalence',
            rows: [],
            droppedColumns: ['matrixDetail_en', 'sampleType_en'],
          },
        ],
      }),
    );

    expect(code).toBe(0);
    expect(
      logs.some((l) => l.includes('ignored non-schema columns') && l.includes('matrixDetail_en')),
    ).toBe(true);
  });
});
