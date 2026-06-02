import { describe, it, expect } from 'vitest';
import { syncImport } from '../src/core/orchestrator.js';
import type { CollectionImport } from '../src/core/orchestrator.js';
import type { FactImport } from '../src/core/fact-parser.js';
import type { StrapiClient, TruncateResult, BulkCreateResult } from '../src/core/strapi-client.js';
import type { BulkRow, ParsedFactRow } from '../src/core/domain.js';

/**
 * Reference bulk-creates return synthetic IDs (id_en = rowIndex+1,
 * id_de = rowIndex+101); fact bulk-creates record the rows they were handed so
 * the test can assert the resolved relation IDs were stamped before send.
 */
class FakeStrapiClient implements StrapiClient {
  calls: string[] = [];
  factRowsSent = new Map<string, BulkRow[]>();

  async truncate(collection: string): Promise<TruncateResult> {
    this.calls.push(`truncate:${collection}`);
    return { en: 0, de: 0 };
  }

  async bulkCreate(collection: string, rows: BulkRow[]): Promise<BulkCreateResult[]> {
    this.calls.push(`bulkCreate:${collection}`);
    if (collection === 'resistance' || collection === 'prevalence') {
      this.factRowsSent.set(collection, rows);
    }
    return rows.map((_, rowIndex) => ({
      rowIndex,
      documentId: `${collection}-${rowIndex}`,
      id_en: rowIndex + 1,
      id_de: rowIndex + 101,
    }));
  }

  fetchSchema(): Promise<never> {
    throw new Error('not used in this test');
  }
}

const references: CollectionImport[] = [
  {
    collection: 'matrix',
    rows: [{ en: { name: 'Chicken meat' }, de: { name: 'Hähnchenfleisch' } }],
  },
  {
    collection: 'microorganism',
    rows: [{ en: { name: 'Salmonella spp.' }, de: { name: 'Salmonella spp.' } }],
  },
];

const resistanceRow: ParsedFactRow = {
  rowNumber: 2,
  hasDe: true,
  scalars: { en: { dbId: 'R-1' }, de: { dbId: 'R-1' } },
  relations: [
    { attr: 'matrix', collection: 'matrix', en: 'Chicken meat', de: 'Hähnchenfleisch' },
    {
      attr: 'microorganism',
      collection: 'microorganism',
      en: 'Salmonella spp.',
      de: 'Salmonella spp.',
    },
  ],
};

const facts: FactImport[] = [{ collection: 'resistance', rows: [resistanceRow] }];

describe('syncImport', () => {
  it('follows the CONTEXT phase order: truncate facts, then references, then create facts', async () => {
    const client = new FakeStrapiClient();

    await syncImport(client, references, facts);

    expect(client.calls).toEqual([
      'truncate:resistance', // facts truncated first (FK safety)
      'truncate:matrix',
      'truncate:microorganism',
      'bulkCreate:matrix',
      'bulkCreate:microorganism',
      'bulkCreate:resistance', // facts created strictly after references
    ]);
  });

  it('stamps fact rows with the IDs captured from the reference bulk-create responses', async () => {
    const client = new FakeStrapiClient();

    await syncImport(client, references, facts);

    const sent = client.factRowsSent.get('resistance')!;
    expect(sent).toHaveLength(1);
    // matrix and microorganism are each the first row of their collection → id_en=1, id_de=101.
    expect(sent[0]!.en).toEqual({ dbId: 'R-1', matrix: 1, microorganism: 1 });
    expect(sent[0]!.de).toEqual({ dbId: 'R-1', matrix: 101, microorganism: 101 });
  });

  it('reports per-collection created counts for both layers', async () => {
    const client = new FakeStrapiClient();

    const report = await syncImport(client, references, facts);

    expect(report.references.map((r) => r.collection)).toEqual(['matrix', 'microorganism']);
    expect(report.facts).toEqual([
      { collection: 'resistance', deleted: { en: 0, de: 0 }, created: 1 },
    ]);
  });
});
