import type { LocalizedRow } from './domain.js';
import type { StrapiClient, TruncateResult } from './strapi-client.js';
import { RelationMap } from './relation-map.js';

/** Outcome of syncing one collection. */
export interface SyncReport {
  collection: string;
  deleted: TruncateResult;
  created: number;
}

/** One collection's parsed rows, ready to import. */
export interface CollectionImport {
  collection: string;
  rows: LocalizedRow[];
}

/** Outcome of importing the whole reference layer. */
export interface ReferencesReport {
  collections: SyncReport[];
  /** `(collection, locale, name) → id` map built from the bulk-create responses. */
  relations: RelationMap;
}

/**
 * Import the reference layer with the phase ordering from CONTEXT.md § Import
 * phase order: truncate *every* reference collection first, then bulk-create
 * *every* reference collection. Sequential between collections. IDs returned by
 * each bulk-create are captured into the relation map (populated now, consumed
 * by fact-table imports in #004).
 */
export async function syncReferences(
  client: StrapiClient,
  imports: CollectionImport[],
): Promise<ReferencesReport> {
  const deletedByCollection = new Map<string, TruncateResult>();
  for (const { collection } of imports) {
    deletedByCollection.set(collection, await client.truncate(collection));
  }

  const relations = new RelationMap();
  const collections: SyncReport[] = [];
  for (const { collection, rows } of imports) {
    const results = await client.bulkCreate(collection, rows);
    for (const result of results) {
      const row = rows[result.rowIndex]!;
      relations.add(collection, 'en', row.en.name, result.id_en);
      if (row.de && result.id_de !== undefined) {
        relations.add(collection, 'de', row.de.name, result.id_de);
      }
    }
    collections.push({
      collection,
      deleted: deletedByCollection.get(collection)!,
      created: results.length,
    });
  }

  return { collections, relations };
}

/**
 * Delete-then-recreate one collection: truncate it, then bulk-create the rows.
 * Sequential and fail-fast — if truncate rejects, no rows are created. No
 * batching, concurrency, or retry yet (those land in later issues).
 */
export async function syncCollection(
  client: StrapiClient,
  collection: string,
  rows: LocalizedRow[],
): Promise<SyncReport> {
  const deleted = await client.truncate(collection);
  const results = await client.bulkCreate(collection, rows);
  return { collection, deleted, created: results.length };
}
