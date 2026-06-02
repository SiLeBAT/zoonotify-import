/**
 * Throughput + resilience model for the bulk-create stream (CONTEXT.md § Throughput
 * policy). Batching, a concurrency cap, retry with backoff, and a circuit breaker
 * live here in the UI-agnostic core; the per-request timeout is the adapter's job.
 */
import pLimit from 'p-limit';
import { CircuitBreakerError, RequestError, isRetryable } from './errors.js';
import type { StrapiClient, BulkCreateResult } from './strapi-client.js';
import type { BulkRow } from './domain.js';

/** The five operator-tunable throughput knobs (CLI flags of the same name). */
export interface ThroughputConfig {
  /** Rows per bulk-create request. */
  batchSize: number;
  /** Maximum in-flight bulk-create requests. */
  concurrency: number;
  /** Per-request timeout in milliseconds (enforced by the HTTP adapter). */
  requestTimeoutMs: number;
  /** Maximum retries per batch after the first attempt. */
  maxRetries: number;
  /** Consecutive full-retry-cycle batch failures that trip the breaker. */
  circuitBreakerThreshold: number;
}

/** CONTEXT.md § Throughput policy defaults. */
export const DEFAULT_THROUGHPUT: ThroughputConfig = {
  batchSize: 200,
  concurrency: 3,
  requestTimeoutMs: 30_000,
  maxRetries: 4,
  circuitBreakerThreshold: 3,
};

/** Split `items` into consecutive batches of at most `size`; the last may be partial. */
export function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

/**
 * One bulk-create batch's outcome, emitted as it completes. Feeds `--verbose`
 * batch timing and the per-batch detail in the result file. `index` is the
 * batch's position within the collection's row stream (0-based).
 */
export interface BatchEvent {
  collection: string;
  index: number;
  rows: number;
  outcome: 'created' | 'failed';
  /** Attempts made (1 + retries used). */
  attempts: number;
  durationMs: number;
  /** Failure message, present only when `outcome === 'failed'`. */
  error?: string;
}

/** Injected so retry/backoff is testable without real timers. */
export interface RetryDeps {
  sleep: (ms: number) => Promise<void>;
  /** Wall clock for batch timing; injectable for deterministic tests. */
  now?: () => number;
  /** Notified as each batch settles (created or failed). */
  onBatch?: (event: BatchEvent) => void;
}

export const defaultRetryDeps: RetryDeps = {
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** Backoff for the nth retry (0-based): 1s, 2s, 4s, 8s, … */
function backoffMs(retry: number): number {
  return 1000 * 2 ** retry;
}

/**
 * Run `fn`, retrying on retryable `RequestError`s up to `maxRetries` times with
 * exponential backoff (1s/2s/4s/8s). A `Retry-After` on the error overrides the
 * backoff for that one wait. Non-retryable errors, and the final failure after
 * the retry budget is spent, propagate to the caller.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: { maxRetries: number },
  deps: RetryDeps = defaultRetryDeps,
): Promise<T> {
  let retry = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (!isRetryable(err) || retry >= config.maxRetries) throw err;
      const override = err instanceof RequestError ? err.retryAfterMs : undefined;
      await deps.sleep(override ?? backoffMs(retry));
      retry += 1;
    }
  }
}

/**
 * Bulk-create `rows` for one collection under the full throughput model: split
 * into `batchSize` batches, run at most `concurrency` at a time, retry each batch
 * per the policy, and trip the circuit breaker after `circuitBreakerThreshold`
 * consecutive batches exhaust their retry cycle. Results are returned in input
 * order with `rowIndex` remapped to the global row position so the caller's
 * relation map stays aligned.
 *
 * Aborts with `CircuitBreakerError` once the breaker trips; otherwise rethrows
 * the first batch failure (a lost batch must never read as success).
 */
export async function bulkCreateBatched(
  client: StrapiClient,
  collection: string,
  rows: BulkRow[],
  config: ThroughputConfig,
  deps: RetryDeps = defaultRetryDeps,
): Promise<BulkCreateResult[]> {
  const batches = chunk(rows, config.batchSize);
  const limit = pLimit(config.concurrency);

  const perBatch: (BulkCreateResult[] | undefined)[] = new Array(batches.length);
  let consecutiveFailures = 0;
  let tripped: CircuitBreakerError | undefined;
  let firstError: unknown;

  let offset = 0;
  const offsets = batches.map((batch) => {
    const start = offset;
    offset += batch.length;
    return start;
  });

  const clock = deps.now ?? Date.now;

  await Promise.all(
    batches.map((batch, bi) =>
      limit(async () => {
        // Stop launching once the breaker has already tripped.
        if (tripped) return;
        const start = clock();
        let attempts = 0;
        try {
          const results = await withRetry(
            () => {
              attempts += 1;
              return client.bulkCreate(collection, batch);
            },
            config,
            deps,
          );
          consecutiveFailures = 0;
          perBatch[bi] = results.map((r) => ({ ...r, rowIndex: r.rowIndex + offsets[bi]! }));
          deps.onBatch?.({
            collection,
            index: bi,
            rows: batch.length,
            outcome: 'created',
            attempts,
            durationMs: clock() - start,
          });
        } catch (err) {
          firstError ??= err;
          consecutiveFailures += 1;
          deps.onBatch?.({
            collection,
            index: bi,
            rows: batch.length,
            outcome: 'failed',
            attempts,
            durationMs: clock() - start,
            error: (err as Error).message,
          });
          if (!tripped && consecutiveFailures >= config.circuitBreakerThreshold) {
            tripped = new CircuitBreakerError(collection, consecutiveFailures, err);
          }
        }
      }),
    ),
  );

  if (tripped) throw tripped;
  if (firstError) throw firstError;
  return perBatch.flatMap((results) => results ?? []);
}
