import type { BulkRow } from '../../src/core/domain.js';
import type {
  StrapiClient,
  TruncateResult,
  BulkCreateResult,
  LiveSchema,
} from '../../src/core/strapi-client.js';
import { RequestError } from '../../src/core/errors.js';

/** What a single bulk-create attempt should do. */
export type Fault =
  | { kind: 'ok' }
  | { kind: 'status'; status: number; retryAfterMs?: number }
  | { kind: 'code'; code: string };

/**
 * Decides the outcome of one bulk-create attempt. `attempt` is 1-based and
 * counts attempts against the *same batch* (identified by its first row), so a
 * plan can say "fail the first attempt, succeed the second".
 */
export type FaultPlan = (ctx: {
  collection: string;
  rows: BulkRow[];
  /** 1-based attempt number for this particular batch. */
  attempt: number;
}) => Fault;

/**
 * The "flaky Strapi" test double from issue #006: a configurable StrapiClient
 * that can return 503-then-200, 429 with Retry-After, or always-fail for chosen
 * batches. Records every bulk-create call and tracks peak concurrency so tests
 * can assert the in-flight cap. `delayMs` lets batches overlap for the
 * concurrency assertion.
 */
export class FlakyStrapiClient implements StrapiClient {
  readonly bulkCreateCalls: { collection: string; rows: BulkRow[] }[] = [];
  inFlight = 0;
  peakInFlight = 0;

  private readonly attemptsByBatch = new Map<string, number>();

  constructor(
    private readonly plan: FaultPlan = () => ({ kind: 'ok' }),
    private readonly delayMs = 0,
  ) {}

  async truncate(collection: string): Promise<TruncateResult> {
    void collection;
    return { en: 0, de: 0 };
  }

  async fetchSchema(): Promise<LiveSchema> {
    return { attributes: {} };
  }

  async bulkCreate(collection: string, rows: BulkRow[]): Promise<BulkCreateResult[]> {
    this.bulkCreateCalls.push({ collection, rows });
    this.inFlight += 1;
    this.peakInFlight = Math.max(this.peakInFlight, this.inFlight);
    try {
      if (this.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.delayMs));
      }
      const key = `${collection}:${batchKey(rows)}`;
      const attempt = (this.attemptsByBatch.get(key) ?? 0) + 1;
      this.attemptsByBatch.set(key, attempt);

      const fault = this.plan({ collection, rows, attempt });
      if (fault.kind === 'status') {
        throw new RequestError(`HTTP ${fault.status}`, {
          status: fault.status,
          retryAfterMs: fault.retryAfterMs,
        });
      }
      if (fault.kind === 'code') {
        throw new RequestError(fault.code, { code: fault.code });
      }
      // Local (per-batch) rowIndex; bulkCreateBatched offsets it to a global index.
      return rows.map((_, i) => ({
        rowIndex: i,
        documentId: `doc-${key}-${i}`,
        id_en: i + 1,
        id_de: i + 101,
      }));
    } finally {
      this.inFlight -= 1;
    }
  }
}

/** A stable identity for a batch, derived from its first row's en payload. */
function batchKey(rows: BulkRow[]): string {
  const first = rows[0]?.en ?? {};
  return JSON.stringify(first);
}
