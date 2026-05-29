import { describe, it, expect } from 'vitest';
import { syncReferences } from '../src/core/orchestrator.js';
import type { StrapiClient, TruncateResult, BulkCreateResult } from '../src/core/strapi-client.js';
import type { LocalizedRow } from '../src/core/domain.js';

class FakeStrapiClient implements StrapiClient {
  calls: string[] = [];

  async truncate(collection: string): Promise<TruncateResult> {
    this.calls.push(`truncate:${collection}`);
    return { en: 1, de: 1 };
  }

  async bulkCreate(collection: string, rows: LocalizedRow[]): Promise<BulkCreateResult[]> {
    this.calls.push(`bulkCreate:${collection}`);
    return rows.map((_, rowIndex) => ({
      rowIndex,
      documentId: `${collection}-doc-${rowIndex}`,
      id_en: rowIndex + 1,
      id_de: rowIndex + 101,
    }));
  }

  fetchSchema(): Promise<never> {
    throw new Error('not used in this test');
  }
}

describe('syncReferences', () => {
  it('truncates every collection first, then bulk-creates every collection', async () => {
    const client = new FakeStrapiClient();
    const imports = [
      { collection: 'specie', rows: [{ en: { name: 'Gallus gallus' } }] },
      { collection: 'matrix', rows: [{ en: { name: 'Chicken meat', iri: 'iri:1' } }] },
    ];

    await syncReferences(client, imports);

    expect(client.calls).toEqual([
      'truncate:specie',
      'truncate:matrix',
      'bulkCreate:specie',
      'bulkCreate:matrix',
    ]);
  });

  it('reports per-collection deleted and created counts', async () => {
    const client = new FakeStrapiClient();
    const imports = [
      {
        collection: 'specie',
        rows: [{ en: { name: 'Gallus gallus' } }, { en: { name: 'Sus scrofa' } }] as LocalizedRow[],
      },
    ];

    const report = await syncReferences(client, imports);

    expect(report.collections).toEqual([
      { collection: 'specie', deleted: { en: 1, de: 1 }, created: 2 },
    ]);
  });

  it('builds the relation map from bulk-create responses, keyed by (collection, locale, name)', async () => {
    const client = new FakeStrapiClient();
    const imports = [
      {
        collection: 'matrix',
        rows: [
          { en: { name: 'Chicken meat', iri: 'iri:1' }, de: { name: 'Hähnchenfleisch' } },
        ] as LocalizedRow[],
      },
    ];

    const report = await syncReferences(client, imports);

    // FakeStrapiClient returns id_en = rowIndex+1, id_de = rowIndex+101.
    expect(report.relations.get('matrix', 'en', 'Chicken meat')).toBe(1);
    expect(report.relations.get('matrix', 'de', 'Hähnchenfleisch')).toBe(101);
    expect(report.relations.size).toBe(2);
  });

  it('omits the DE relation entry when a row has no DE half', async () => {
    const client = new FakeStrapiClient();
    // Override bulkCreate so id_de is absent (mirrors a row sent without a DE locale).
    client.bulkCreate = async (_collection, rows) =>
      rows.map((_, rowIndex) => ({
        rowIndex,
        documentId: `doc-${rowIndex}`,
        id_en: rowIndex + 1,
      }));

    const report = await syncReferences(client, [
      { collection: 'specie', rows: [{ en: { name: 'Gallus gallus' } }] },
    ]);

    expect(report.relations.get('specie', 'en', 'Gallus gallus')).toBe(1);
    expect(report.relations.size).toBe(1);
  });
});
