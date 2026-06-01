import { describe, it, expect, vi, afterEach } from 'vitest';
import { HttpStrapiClient, parseRetryAfter } from '../src/adapters/http-strapi-client.js';
import { isRetryable } from '../src/core/errors.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseRetryAfter', () => {
  const now = Date.parse('2026-06-01T00:00:00.000Z');

  it('reads a numeric value as seconds', () => {
    expect(parseRetryAfter('120', now)).toBe(120_000);
  });

  it('reads an HTTP-date as the delta from now in ms', () => {
    const future = new Date(now + 60_000).toUTCString();
    expect(parseRetryAfter(future, now)).toBe(60_000);
  });

  it('returns undefined for a missing or unparseable value', () => {
    expect(parseRetryAfter(null, now)).toBeUndefined();
    expect(parseRetryAfter('soon', now)).toBeUndefined();
  });
});

describe('HttpStrapiClient — error translation', () => {
  it('maps a retryable status with Retry-After to a retryable RequestError', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('busy', {
        status: 503,
        statusText: 'Service Unavailable',
        headers: { 'retry-after': '2' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new HttpStrapiClient('http://localhost:3000', 'tok');

    const err = await client.truncate('matrix').catch((e: unknown) => e);

    expect(err).toMatchObject({ name: 'RequestError', status: 503, retryAfterMs: 2000 });
    expect(isRetryable(err)).toBe(true);
  });

  it('maps a non-retryable 4xx to a non-retryable RequestError', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('nope', { status: 400, statusText: 'Bad Request' }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new HttpStrapiClient('http://localhost:3000', 'tok');

    const err = await client.truncate('matrix').catch((e: unknown) => e);

    expect(err).toMatchObject({ name: 'RequestError', status: 400 });
    expect(isRetryable(err)).toBe(false);
  });

  it('maps a request timeout to a retryable ETIMEDOUT RequestError', async () => {
    const fetchMock = vi.fn().mockRejectedValue(
      Object.assign(new Error('The operation was aborted due to timeout'), {
        name: 'TimeoutError',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new HttpStrapiClient('http://localhost:3000', 'tok', 50);

    const err = await client.truncate('matrix').catch((e: unknown) => e);

    expect(err).toMatchObject({ name: 'RequestError', code: 'ETIMEDOUT' });
    expect(isRetryable(err)).toBe(true);
  });
});
