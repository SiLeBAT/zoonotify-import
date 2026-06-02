import { describe, it, expect } from 'vitest';
import { bulkCreateBatched } from '../src/core/throughput.js';
import type { ThroughputConfig, BatchEvent, RetryDeps } from '../src/core/throughput.js';
import type {
  StrapiClient,
  TruncateResult,
  BulkCreateResult,
  LiveSchema,
} from '../src/core/strapi-client.js';
import type { BulkRow } from '../src/core/domain.js';
import { RequestError } from '../src/core/errors.js';

const config: ThroughputConfig = {
  batchSize: 1,
  concurrency: 1,
  requestTimeoutMs: 30_000,
  maxRetries: 4,
  circuitBreakerThreshold: 10,
};

/** A monotonically advancing clock so durationMs is deterministic. */
function fakeClock(stepMs = 5): () => number {
  let t = 0;
  return () => (t += stepMs);
}

function deps(overrides: Partial<RetryDeps> = {}): RetryDeps {
  return { sleep: async () => {}, now: fakeClock(), ...overrides };
}

class OkClient implements StrapiClient {
  async truncate(): Promise<TruncateResult> {
    return { en: 0, de: 0 };
  }
  async bulkCreate(_c: string, rows: BulkRow[]): Promise<BulkCreateResult[]> {
    return rows.map((_, i) => ({ rowIndex: i, documentId: `d${i}`, id_en: i + 1 }));
  }
  async fetchSchema(): Promise<LiveSchema> {
    return { attributes: {} };
  }
}

const rows: BulkRow[] = [{ en: { name: 'a' } }, { en: { name: 'b' } }];

describe('bulkCreateBatched — batch observer', () => {
  it('emits one created event per batch with index, row count, attempts and a duration', async () => {
    const events: BatchEvent[] = [];
    await bulkCreateBatched(
      new OkClient(),
      'specie',
      rows,
      config,
      deps({ onBatch: (e) => events.push(e) }),
    );

    expect(events).toHaveLength(2);
    expect(events.map((e) => e.index).sort()).toEqual([0, 1]);
    for (const e of events) {
      expect(e).toMatchObject({ collection: 'specie', rows: 1, outcome: 'created', attempts: 1 });
      expect(e.durationMs).toBeGreaterThan(0);
    }
  });

  it('reports the attempt count when a batch is retried before succeeding', async () => {
    let calls = 0;
    class FlakyOnce extends OkClient {
      override async bulkCreate(c: string, r: BulkRow[]): Promise<BulkCreateResult[]> {
        calls += 1;
        if (calls === 1) throw new RequestError('503', { status: 503 });
        return super.bulkCreate(c, r);
      }
    }
    const events: BatchEvent[] = [];
    await bulkCreateBatched(
      new FlakyOnce(),
      'specie',
      [rows[0]!],
      config,
      deps({ onBatch: (e) => events.push(e) }),
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ outcome: 'created', attempts: 2 });
  });

  it('emits a failed event carrying the error when a batch exhausts its retries', async () => {
    class DownClient extends OkClient {
      override async bulkCreate(): Promise<never> {
        throw new RequestError('boom', { status: 503 });
      }
    }
    const events: BatchEvent[] = [];
    const failOnce: ThroughputConfig = { ...config, maxRetries: 0 };
    await expect(
      bulkCreateBatched(
        new DownClient(),
        'specie',
        [rows[0]!],
        failOnce,
        deps({ onBatch: (e) => events.push(e) }),
      ),
    ).rejects.toThrow();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ outcome: 'failed', attempts: 1, collection: 'specie' });
    expect(events[0]!.error).toMatch(/boom/);
  });
});
