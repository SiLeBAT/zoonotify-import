import { describe, it, expect } from 'vitest';
import { parseThroughputOptions } from '../src/cli/run.js';
import { DEFAULT_THROUGHPUT } from '../src/core/throughput.js';

describe('parseThroughputOptions', () => {
  it('falls back to the documented defaults when no flags are given', () => {
    expect(parseThroughputOptions({})).toEqual(DEFAULT_THROUGHPUT);
  });

  it('parses every flag, reading --request-timeout in seconds and storing it as ms', () => {
    const config = parseThroughputOptions({
      batchSize: '50',
      concurrency: '5',
      requestTimeout: '10',
      maxRetries: '2',
      circuitBreakerThreshold: '6',
    });

    expect(config).toEqual({
      batchSize: 50,
      concurrency: 5,
      requestTimeoutMs: 10_000,
      maxRetries: 2,
      circuitBreakerThreshold: 6,
    });
  });

  it('allows --max-retries 0 (retries disabled)', () => {
    expect(parseThroughputOptions({ maxRetries: '0' }).maxRetries).toBe(0);
  });

  it('rejects a non-numeric or out-of-range flag value', () => {
    expect(() => parseThroughputOptions({ batchSize: 'lots' })).toThrow(/batch-size/);
    expect(() => parseThroughputOptions({ concurrency: '0' })).toThrow(/concurrency/);
  });
});
