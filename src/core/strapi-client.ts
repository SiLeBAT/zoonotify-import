import type { BulkRow } from './domain.js';

/** Per-locale row counts deleted by a truncate. */
export interface TruncateResult {
  en: number;
  de: number;
}

/** One bulk-create outcome, in input order. `id_de` is absent when no DE half was sent. */
export interface BulkCreateResult {
  rowIndex: number;
  documentId: string;
  id_en: number;
  id_de?: number;
}

/**
 * The port the import core talks to. Its only production implementation is the
 * HTTP adapter; orchestrator unit tests drive a fake. The full eventual surface
 * is declared here even though this issue only implements truncate + bulkCreate.
 * See docs/import-cli-spec/adr/0002-hexagonal-core-cli-as-adapter.md.
 */
export interface StrapiClient {
  truncate(collection: string): Promise<TruncateResult>;
  bulkCreate(collection: string, rows: BulkRow[]): Promise<BulkCreateResult[]>;
  fetchSchema(collection: string): Promise<unknown>;
}
