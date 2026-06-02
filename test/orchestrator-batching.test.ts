import { describe, it, expect } from 'vitest';
import { syncReferences } from '../src/core/orchestrator.js';
import { DEFAULT_THROUGHPUT } from '../src/core/throughput.js';
import type { StrapiClient, TruncateResult, BulkCreateResult } from '../src/core/strapi-client.js';
import type { BulkRow, LocalizedRow } from '../src/core/domain.js';

/** Returns ids derived from each row's `row-N` name so alignment is verifiable. */
class IdByNameClient implements StrapiClient {
  bulkCreateCount = 0;
  async truncate(collection: string): Promise<TruncateResult> {
    void collection;
    return { en: 0, de: 0 };
  }
  async bulkCreate(collection: string, rows: BulkRow[]): Promise<BulkCreateResult[]> {
    void collection;
    this.bulkCreateCount += 1;
    return rows.map((row, i) => {
      const n = Number(String(row.en.name).split('-')[1]);
      return { rowIndex: i, documentId: `d-${n}`, id_en: 100 + n, id_de: 200 + n };
    });
  }
  async fetchSchema(): Promise<never> {
    throw new Error('not used');
  }
}

const noWait = { sleep: async () => {} };

describe('syncReferences — batching', () => {
  it('splits a collection over multiple bulk-creates yet keeps the relation map row-aligned', async () => {
    const client = new IdByNameClient();
    const rows: LocalizedRow[] = [
      { en: { name: 'row-0' } },
      { en: { name: 'row-1' } },
      { en: { name: 'row-2' } },
    ];

    const report = await syncReferences(
      client,
      [{ collection: 'matrix', rows }],
      { ...DEFAULT_THROUGHPUT, batchSize: 2, concurrency: 1 },
      noWait,
    );

    expect(client.bulkCreateCount).toBe(2); // 3 rows / batchSize 2
    expect(report.collections[0]!.created).toBe(3);
    // The row in the second batch (global index 2) must map to its own id, not a
    // per-batch-local one — proves the global rowIndex offset lines up.
    expect(report.relations.get('matrix', 'en', 'row-2')).toBe(102);
    expect(report.relations.get('matrix', 'en', 'row-0')).toBe(100);
    expect(report.relations.size).toBe(3);
  });
});
