import { describe, it, expect } from 'vitest';
import { bulkCreateBatched, DEFAULT_THROUGHPUT } from '../src/core/throughput.js';
import type { ThroughputConfig } from '../src/core/throughput.js';
import type { BulkRow } from '../src/core/domain.js';
import { FlakyStrapiClient } from './fixtures/flaky-strapi-client.js';

const noWait = { sleep: async () => {} };

function config(overrides: Partial<ThroughputConfig> = {}): ThroughputConfig {
  return { ...DEFAULT_THROUGHPUT, ...overrides };
}

/** `n` rows whose en.name is unique so each batch has a stable identity. */
function rows(n: number): BulkRow[] {
  return Array.from({ length: n }, (_, i) => ({ en: { name: `row-${i}` } }));
}

describe('bulkCreateBatched — batching', () => {
  it('splits rows into batches of batchSize and returns results with a global rowIndex', async () => {
    const client = new FlakyStrapiClient();

    const results = await bulkCreateBatched(
      client,
      'matrix',
      rows(5),
      config({ batchSize: 2, concurrency: 1 }),
      noWait,
    );

    // 5 rows / batchSize 2 → batches of [2, 2, 1].
    expect(client.bulkCreateCalls.map((c) => c.rows.length)).toEqual([2, 2, 1]);
    // Results come back in input order with rowIndex remapped 0..4 (not per-batch).
    expect(results.map((r) => r.rowIndex)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('bulkCreateBatched — concurrency', () => {
  it('never exceeds the concurrency cap of in-flight bulk-create requests', async () => {
    // 6 batches that each linger 10ms so they overlap; cap is 2.
    const client = new FlakyStrapiClient(() => ({ kind: 'ok' }), 10);

    await bulkCreateBatched(
      client,
      'matrix',
      rows(6),
      config({ batchSize: 1, concurrency: 2 }),
      noWait,
    );

    expect(client.bulkCreateCalls.length).toBe(6);
    expect(client.peakInFlight).toBe(2);
  });
});

describe('bulkCreateBatched — resilience', () => {
  it('retries a batch that 503s on its first attempt and still returns every row', async () => {
    // The second batch (row-2) fails once with 503, then succeeds on retry.
    const client = new FlakyStrapiClient(({ rows: batch, attempt }) =>
      batch[0]?.en.name === 'row-2' && attempt === 1
        ? { kind: 'status', status: 503 }
        : { kind: 'ok' },
    );

    const results = await bulkCreateBatched(
      client,
      'matrix',
      rows(4),
      config({ batchSize: 1, concurrency: 1, maxRetries: 4 }),
      noWait,
    );

    expect(results.map((r) => r.rowIndex)).toEqual([0, 1, 2, 3]);
    // 4 batches + 1 retry of the flaky one = 5 calls.
    expect(client.bulkCreateCalls.length).toBe(5);
  });

  it('aborts with a CircuitBreakerError once threshold consecutive batches fail their retry cycle', async () => {
    // Every batch always 503s → first `threshold` consecutive failures trip the breaker.
    const client = new FlakyStrapiClient(() => ({ kind: 'status', status: 503 }));

    await expect(
      bulkCreateBatched(
        client,
        'matrix',
        rows(10),
        config({ batchSize: 1, concurrency: 1, maxRetries: 1, circuitBreakerThreshold: 3 }),
        noWait,
      ),
    ).rejects.toMatchObject({ name: 'CircuitBreakerError', collection: 'matrix' });
  });
});
