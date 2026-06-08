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

describe('HttpStrapiClient', () => {
  it('truncate POSTs the collection to /import-admin/truncate with bearer auth', async () => {
    // The CMS wraps the payload as `{ collection, deleted }`.
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ collection: 'microorganism', deleted: { en: 3, de: 2 } }));
    vi.stubGlobal('fetch', fetchMock);
    // Trailing slash on the base URL must be normalized away.
    const client = new HttpStrapiClient('http://localhost:3000/', 'secret-token');

    const result = await client.truncate('microorganism');

    expect(result).toEqual({ en: 3, de: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://localhost:3000/import-admin/truncate');
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe('Bearer secret-token');
    expect(init.headers['content-type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ collection: 'microorganism' });
  });

  it('bulkCreate POSTs collection + rows and returns the id map in order', async () => {
    const apiResult = [{ rowIndex: 0, documentId: 'doc-0', id_en: 1, id_de: 101 }];
    // The CMS wraps the payload as `{ collection, created }`.
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ collection: 'microorganism', created: apiResult }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new HttpStrapiClient('http://localhost:3000', 'tok');
    const rows = [{ en: { name: 'Salmonella spp.' }, de: { name: 'Salmonella spp.' } }];

    const result = await client.bulkCreate('microorganism', rows);

    expect(result).toEqual(apiResult);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://localhost:3000/import-admin/bulk-create');
    expect(JSON.parse(init.body)).toEqual({ collection: 'microorganism', rows });
  });

  it('rejects on a non-2xx response (fail-fast on the first HTTP error)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('boom', { status: 500, statusText: 'Server Error' }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new HttpStrapiClient('http://localhost:3000', 'tok');

    await expect(client.truncate('microorganism')).rejects.toThrow(/500/);
  });
});
