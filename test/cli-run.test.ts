import { describe, it, expect } from 'vitest';
import { runImport } from '../src/cli/run.js';
import type { CliDeps } from '../src/cli/run.js';
import type { StrapiClient, TruncateResult, BulkCreateResult } from '../src/core/strapi-client.js';
import type { LocalizedRow } from '../src/core/domain.js';

class RecordingClient implements StrapiClient {
  calls: string[] = [];
  async truncate(): Promise<TruncateResult> {
    this.calls.push('truncate');
    return { en: 0, de: 0 };
  }
  async bulkCreate(_c: string, rows: LocalizedRow[]): Promise<BulkCreateResult[]> {
    this.calls.push('bulkCreate');
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
    parse: async () => [{ en: { name: 'Salmonella spp.' } }],
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

  it('exits 0 and runs truncate then bulk-create on the happy path', async () => {
    const client = new RecordingClient();
    const code = await runImport('wb.xlsx', goodEnv, deps({ makeClient: () => client }));

    expect(code).toBe(0);
    expect(client.calls).toEqual(['truncate', 'bulkCreate']);
  });
});
