import type { LocalizedRow } from './domain.js';
import type { StrapiClient, TruncateResult } from './strapi-client.js';

/** Outcome of syncing one collection. */
export interface SyncReport {
  collection: string;
  deleted: TruncateResult;
  created: number;
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
