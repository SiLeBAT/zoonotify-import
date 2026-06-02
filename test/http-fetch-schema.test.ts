import { describe, it, expect, vi, afterEach } from 'vitest';
import { HttpStrapiClient } from '../src/adapters/http-strapi-client.js';

afterEach(() => {
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const ctbResponse = {
  data: {
    schema: {
      attributes: {
        dbId: { type: 'string', required: true, pluginOptions: { i18n: { localized: true } } },
        samplingYear: { type: 'integer', required: true },
        matrix: { type: 'relation', relation: 'oneToOne' },
        zomoProgram: { type: 'string', pluginOptions: { i18n: { localized: true } } },
      },
    },
  },
};

describe('HttpStrapiClient.fetchSchema', () => {
  it('GETs the content-type-builder schema and normalizes attributes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(ctbResponse));
    vi.stubGlobal('fetch', fetchMock);
    const client = new HttpStrapiClient('http://localhost:1337', 'tok');

    const schema = await client.fetchSchema('resistance');

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      'http://localhost:1337/content-type-builder/content-types/api::resistance.resistance',
    );
    expect(init.headers.authorization).toBe('Bearer tok');
    expect(schema.attributes.dbId).toEqual({ type: 'string', required: true, localized: true });
    expect(schema.attributes.samplingYear).toEqual({
      type: 'integer',
      required: true,
      localized: false,
    });
    expect(schema.attributes.matrix).toEqual({
      type: 'relation',
      required: false,
      localized: false,
    });
    expect(schema.attributes.zomoProgram).toEqual({
      type: 'string',
      required: false,
      localized: true,
    });
  });

  it('rejects on a non-2xx response so the orchestrator can degrade to a warning', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('nope', { status: 403, statusText: 'Forbidden' })),
    );
    const client = new HttpStrapiClient('http://localhost:1337', 'tok');
    await expect(client.fetchSchema('resistance')).rejects.toThrow(/403/);
  });
});
