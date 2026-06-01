import type { AttrValue, BulkRow, LocalizedRow, ParsedFactRow } from './domain.js';
import type { StrapiClient, TruncateResult } from './strapi-client.js';
import type { FactImport } from './fact-parser.js';
import { RelationMap } from './relation-map.js';
import { ImportError } from './errors.js';
import { bulkCreateBatched, DEFAULT_THROUGHPUT } from './throughput.js';
import type { ThroughputConfig, RetryDeps } from './throughput.js';

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
  config: ThroughputConfig = DEFAULT_THROUGHPUT,
  deps?: RetryDeps,
): Promise<ReferencesReport> {
  const deletedByCollection = new Map<string, TruncateResult>();
  for (const { collection } of imports) {
    deletedByCollection.set(collection, await client.truncate(collection));
  }

  const relations = new RelationMap();
  const collections: SyncReport[] = [];
  for (const { collection, rows } of imports) {
    const results = await bulkCreateBatched(client, collection, rows, config, deps);
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
  config: ThroughputConfig = DEFAULT_THROUGHPUT,
  deps?: RetryDeps,
): Promise<SyncReport> {
  const deleted = await client.truncate(collection);
  const results = await bulkCreateBatched(client, collection, rows, config, deps);
  return { collection, deleted, created: results.length };
}

/** Outcome of importing the whole workbook (reference + fact layers). */
export interface ImportReport {
  references: SyncReport[];
  facts: SyncReport[];
  relations: RelationMap;
}

/**
 * Import the whole workbook in the CONTEXT.md § Import phase order:
 *   1. truncate every fact table first (so reference rows they point at can be
 *      removed without violating relations),
 *   2. truncate + bulk-create every reference table, capturing IDs into the
 *      relation map,
 *   3. bulk-create every fact table with relation fields stamped from that map.
 *
 * Fact creation therefore runs strictly after all reference imports complete.
 * Callers are expected to have passed pre-flight (relation references resolve)
 * before invoking this; resolveFactRow still throws defensively on a miss.
 */
export async function syncImport(
  client: StrapiClient,
  references: CollectionImport[],
  facts: FactImport[],
  config: ThroughputConfig = DEFAULT_THROUGHPUT,
  deps?: RetryDeps,
): Promise<ImportReport> {
  // Phase 1: truncate fact tables before touching references.
  const factDeleted = new Map<string, TruncateResult>();
  for (const { collection } of facts) {
    factDeleted.set(collection, await client.truncate(collection));
  }

  // Phases 2 & 3: reference truncate + create, building the relation map.
  const { collections: referenceReports, relations } = await syncReferences(
    client,
    references,
    config,
    deps,
  );

  // Phase 4: create facts with resolved relation IDs.
  const factReports: SyncReport[] = [];
  for (const { collection, rows } of facts) {
    const resolved = rows.map((row) => resolveFactRow(row, relations));
    const results = await bulkCreateBatched(client, collection, resolved, config, deps);
    factReports.push({
      collection,
      deleted: factDeleted.get(collection)!,
      created: results.length,
    });
  }

  return { references: referenceReports, facts: factReports, relations };
}

/**
 * Translate one parsed fact row into the `{ en, de? }` payload the bulk-create
 * port expects, stamping each relation with its integer ID from the relation
 * map. Relations whose locale name is absent are omitted (not nulled). The DE
 * payload is built only when the row supplied DE-side data.
 */
export function resolveFactRow(row: ParsedFactRow, relations: RelationMap): BulkRow {
  const en: Record<string, AttrValue> = { ...row.scalars.en };
  const de: Record<string, AttrValue> = { ...row.scalars.de };

  for (const ref of row.relations) {
    if (ref.en !== undefined) {
      en[ref.attr] = lookup(relations, ref.collection, 'en', ref.en);
    }
    if (row.hasDe && ref.de !== undefined) {
      de[ref.attr] = lookup(relations, ref.collection, 'de', ref.de);
    }
  }

  return row.hasDe ? { en, de } : { en };
}

function lookup(
  relations: RelationMap,
  collection: string,
  locale: 'en' | 'de',
  name: string,
): number {
  const id = relations.get(collection, locale, name);
  if (id === undefined) {
    throw new ImportError(
      `relation ${collection} (${locale}) "${name}" was not resolved — did pre-flight pass?`,
    );
  }
  return id;
}
