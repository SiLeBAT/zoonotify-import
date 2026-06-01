import { describe, it, expect } from 'vitest';
import { syncCollection } from '../src/core/orchestrator.js';
import type { StrapiClient, TruncateResult, BulkCreateResult } from '../src/core/strapi-client.js';
import type { BulkRow, LocalizedRow } from '../src/core/domain.js';

class FakeStrapiClient implements StrapiClient {
  calls: string[] = [];
  truncatedCollections: string[] = [];
  bulkCreateCalls: { collection: string; rows: BulkRow[] }[] = [];

  async truncate(collection: string): Promise<TruncateResult> {
    this.calls.push('truncate');
    this.truncatedCollections.push(collection);
    return { en: 5, de: 5 };
  }

  async bulkCreate(collection: string, rows: BulkRow[]): Promise<BulkCreateResult[]> {
    this.calls.push('bulkCreate');
    this.bulkCreateCalls.push({ collection, rows });
    return rows.map((_, rowIndex) => ({
      rowIndex,
      documentId: `doc-${rowIndex}`,
      id_en: rowIndex + 1,
      id_de: rowIndex + 101,
    }));
  }

  fetchSchema(): Promise<never> {
    throw new Error('not used in this test');
  }
}

describe('syncCollection', () => {
  it('truncates then bulk-creates with the supplied rows, and reports counts', async () => {
    const client = new FakeStrapiClient();
    const rows: LocalizedRow[] = [
      { en: { name: 'Salmonella spp.' }, de: { name: 'Salmonella spp.' } },
      { en: { name: 'Campylobacter jejuni' }, de: { name: 'Campylobacter jejuni' } },
    ];

    const report = await syncCollection(client, 'microorganism', rows);

    expect(client.calls).toEqual(['truncate', 'bulkCreate']);
    expect(client.truncatedCollections).toEqual(['microorganism']);
    expect(client.bulkCreateCalls).toEqual([{ collection: 'microorganism', rows }]);
    expect(report).toEqual({
      collection: 'microorganism',
      deleted: { en: 5, de: 5 },
      created: 2,
    });
  });

  it('fails fast: if truncate rejects, bulk-create is never called', async () => {
    const client = new FakeStrapiClient();
    client.truncate = async () => {
      throw new Error('truncate boom');
    };

    await expect(syncCollection(client, 'microorganism', [{ en: { name: 'x' } }])).rejects.toThrow(
      'truncate boom',
    );
    expect(client.bulkCreateCalls).toEqual([]);
  });
});
