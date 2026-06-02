import { describe, it, expect } from 'vitest';
import { syncImport } from '../src/core/orchestrator.js';
import type { CollectionImport } from '../src/core/orchestrator.js';
import type { FactImport } from '../src/core/fact-parser.js';
import { DEFAULT_THROUGHPUT } from '../src/core/throughput.js';
import type { ThroughputConfig } from '../src/core/throughput.js';
import type { ParsedFactRow } from '../src/core/domain.js';
import { FlakyStrapiClient } from './fixtures/flaky-strapi-client.js';
import type { FaultPlan } from './fixtures/flaky-strapi-client.js';

/**
 * Resilience integration test (issue #006): drives the real sync engine through
 * the flaky Strapi double across the three failure modes — retry-then-succeed,
 * Retry-After honoring, and circuit-breaker abort — with batching + retry on.
 */

function references(matrixRowCount = 1): CollectionImport[] {
  return [
    {
      collection: 'matrix',
      rows: Array.from({ length: matrixRowCount }, (_, i) => ({ en: { name: `m-${i}` } })),
    },
  ];
}

const resistanceRow: ParsedFactRow = {
  rowNumber: 2,
  hasDe: false,
  scalars: { en: { dbId: 'R-1' }, de: { dbId: 'R-1' } },
  relations: [{ attr: 'matrix', collection: 'matrix', en: 'm-0' }],
};
const facts: FactImport[] = [{ collection: 'resistance', rows: [resistanceRow] }];

function config(overrides: Partial<ThroughputConfig> = {}): ThroughputConfig {
  return { ...DEFAULT_THROUGHPUT, ...overrides };
}

function run(
  plan: FaultPlan,
  cfg: ThroughputConfig,
  sleep: (ms: number) => Promise<void> = async () => {},
) {
  const client = new FlakyStrapiClient(plan);
  return { client, result: syncImport(client, references(), facts, cfg, { sleep }) };
}

describe('resilience — retry then succeed', () => {
  it('a batch that 503s once recovers, and the whole import completes', async () => {
    const plan: FaultPlan = ({ collection, attempt }) =>
      collection === 'matrix' && attempt === 1 ? { kind: 'status', status: 503 } : { kind: 'ok' };

    const { client, result } = run(plan, config());
    const report = await result;

    expect(report.facts[0]?.created).toBe(1);
    // matrix attempted twice (1 fail + 1 success) + resistance once.
    expect(client.bulkCreateCalls.length).toBe(3);
  });
});

describe('resilience — Retry-After honoring', () => {
  it('waits the server-specified Retry-After instead of the default backoff', async () => {
    const delays: number[] = [];
    const plan: FaultPlan = ({ collection, attempt }) =>
      collection === 'matrix' && attempt === 1
        ? { kind: 'status', status: 429, retryAfterMs: 7000 }
        : { kind: 'ok' };

    await run(plan, config(), async (ms) => {
      delays.push(ms);
    }).result;

    expect(delays).toEqual([7000]); // 7s from Retry-After, not the 1s first backoff
  });
});

describe('resilience — circuit breaker abort', () => {
  it('aborts the whole import with a CircuitBreakerError when batches keep failing', async () => {
    const plan: FaultPlan = () => ({ kind: 'status', status: 503 });
    const client = new FlakyStrapiClient(plan);

    await expect(
      syncImport(
        client,
        references(5), // 5 single-row batches, all 503
        facts,
        config({ batchSize: 1, concurrency: 1, maxRetries: 0, circuitBreakerThreshold: 3 }),
        { sleep: async () => {} },
      ),
    ).rejects.toMatchObject({ name: 'CircuitBreakerError', collection: 'matrix' });
  });
});
