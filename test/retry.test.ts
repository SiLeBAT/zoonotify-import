import { describe, it, expect } from 'vitest';
import { RequestError, isRetryable } from '../src/core/errors.js';
import { withRetry } from '../src/core/throughput.js';

/** Collects the delays withRetry would sleep, without actually waiting. */
function recordingSleep(): { delays: number[]; sleep: (ms: number) => Promise<void> } {
  const delays: number[] = [];
  return {
    delays,
    sleep: (ms) => {
      delays.push(ms);
      return Promise.resolve();
    },
  };
}

describe('isRetryable', () => {
  it('is true for the documented retryable statuses and codes, false otherwise', () => {
    for (const status of [429, 502, 503, 504]) {
      expect(isRetryable(new RequestError('x', { status })), `status ${status}`).toBe(true);
    }
    for (const code of [
      'ECONNRESET',
      'ETIMEDOUT',
      'ENOTFOUND',
      'EAI_AGAIN',
      'ENETUNREACH',
      'EHOSTUNREACH',
    ]) {
      expect(isRetryable(new RequestError('x', { code })), code).toBe(true);
    }
    // Other 4xx are programming errors — never retried.
    expect(isRetryable(new RequestError('x', { status: 400 }))).toBe(false);
    expect(isRetryable(new RequestError('x', { status: 404 }))).toBe(false);
    // A plain error carries no retry signal.
    expect(isRetryable(new Error('boom'))).toBe(false);
  });
});

const cfg = { maxRetries: 4 };

describe('withRetry', () => {
  it('retries a retryable failure and returns the eventual success, backing off 1s then 2s', async () => {
    const { delays, sleep } = recordingSleep();
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts += 1;
        if (attempts < 3) throw new RequestError('flaky', { status: 503 });
        return 'ok';
      },
      cfg,
      { sleep },
    );

    expect(result).toBe('ok');
    expect(attempts).toBe(3);
    expect(delays).toEqual([1000, 2000]);
  });

  it('gives up after maxRetries, exhausting the full 1s/2s/4s/8s schedule, and rethrows', async () => {
    const { delays, sleep } = recordingSleep();
    let attempts = 0;
    const boom = new RequestError('always down', { status: 503 });

    await expect(
      withRetry(
        async () => {
          attempts += 1;
          throw boom;
        },
        cfg,
        { sleep },
      ),
    ).rejects.toBe(boom);

    expect(attempts).toBe(5); // 1 initial + 4 retries
    expect(delays).toEqual([1000, 2000, 4000, 8000]);
  });

  it('does not retry a non-retryable error (other 4xx are programming errors)', async () => {
    const { delays, sleep } = recordingSleep();
    let attempts = 0;
    const boom = new RequestError('bad request', { status: 400 });

    await expect(
      withRetry(
        async () => {
          attempts += 1;
          throw boom;
        },
        cfg,
        { sleep },
      ),
    ).rejects.toBe(boom);

    expect(attempts).toBe(1);
    expect(delays).toEqual([]);
  });

  it('backs off 15s/30s/60s/120s on a network outage (DNS failure, network unreachable)', async () => {
    const { delays, sleep } = recordingSleep();
    let attempts = 0;
    const outage = new RequestError('vpn dropped', { code: 'ENETUNREACH' });

    await expect(
      withRetry(
        async () => {
          attempts += 1;
          throw outage;
        },
        cfg,
        { sleep },
      ),
    ).rejects.toBe(outage);

    expect(attempts).toBe(5);
    expect(delays).toEqual([15_000, 30_000, 60_000, 120_000]);
  });

  it('caps the outage backoff at 120s when maxRetries exceeds the schedule', async () => {
    const { delays, sleep } = recordingSleep();
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts += 1;
        if (attempts <= 6) throw new RequestError('dns down', { code: 'ENOTFOUND' });
        return 'ok';
      },
      { maxRetries: 6 },
      { sleep },
    );

    expect(result).toBe('ok');
    expect(delays).toEqual([15_000, 30_000, 60_000, 120_000, 120_000, 120_000]);
  });

  it('honors Retry-After, overriding the backoff schedule for that retry', async () => {
    const { delays, sleep } = recordingSleep();
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts += 1;
        if (attempts === 1)
          throw new RequestError('slow down', { status: 429, retryAfterMs: 5000 });
        return 'ok';
      },
      cfg,
      { sleep },
    );

    expect(result).toBe('ok');
    expect(delays).toEqual([5000]); // 5s from Retry-After, not the 1s default
  });
});
