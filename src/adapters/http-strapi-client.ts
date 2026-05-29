import type { LocalizedRow } from '../core/domain.js';
import type { StrapiClient, TruncateResult, BulkCreateResult } from '../core/strapi-client.js';
import { ImportError, NotImplementedError } from '../core/errors.js';

/**
 * Native-fetch implementation of the StrapiClient port. Talks to the CMS Import
 * admin API (see issue #001). One in-flight request, fail-fast on the first
 * non-2xx response — no batching, concurrency, or retry yet.
 */
export class HttpStrapiClient implements StrapiClient {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly token: string,
  ) {
    // Normalize: strip any trailing slash so path joins are predictable.
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  truncate(collection: string): Promise<TruncateResult> {
    return this.post<TruncateResult>('/import-admin/truncate', { collection });
  }

  bulkCreate(collection: string, rows: LocalizedRow[]): Promise<BulkCreateResult[]> {
    return this.post<BulkCreateResult[]>('/import-admin/bulk-create', { collection, rows });
  }

  fetchSchema(collection: string): Promise<unknown> {
    return Promise.reject(new NotImplementedError(`fetchSchema(${collection})`));
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new ImportError(
        `POST ${path} failed: ${response.status} ${response.statusText} ${detail}`.trim(),
      );
    }
    return (await response.json()) as T;
  }
}
