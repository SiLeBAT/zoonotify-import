import { describe, it, expect } from 'vitest';
import { runImport } from '../src/cli/run.js';
import type { CliDeps } from '../src/cli/run.js';
import type { StrapiClient, TruncateResult, BulkCreateResult } from '../src/core/strapi-client.js';
import type { LocalizedRow } from '../src/core/domain.js';

class RecordingClient implements StrapiClient {
  calls: string[] = [];
  async truncate(collection: string): Promise<TruncateResult> {
    this.calls.push(`truncate:${collection}`);
    return { en: 0, de: 0 };
  }
  async bulkCreate(collection: string, rows: LocalizedRow[]): Promise<BulkCreateResult[]> {
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
});
