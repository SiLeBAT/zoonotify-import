import type { BulkRow } from '../core/domain.js';
import type {
  StrapiClient,
  TruncateResult,
  BulkCreateResult,
  LiveSchema,
  LiveSchemaAttribute,
} from '../core/strapi-client.js';
import { ImportError } from '../core/errors.js';

/** The slice of Strapi's content-type-builder response the schema-drift check needs. */
interface CtbAttribute {
  type: string;
  required?: boolean;
  pluginOptions?: { i18n?: { localized?: boolean } };
}
interface CtbResponse {
  data: { schema: { attributes: Record<string, CtbAttribute> } };
}

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

  bulkCreate(collection: string, rows: BulkRow[]): Promise<BulkCreateResult[]> {
    return this.post<BulkCreateResult[]>('/import-admin/bulk-create', { collection, rows });
  }

  /**
   * Fetches a collection's live schema from the content-type-builder and
   * normalizes it for check #10. Best-effort: if the endpoint is unreachable or
   * forbidden this rejects, and the pre-flight orchestrator degrades to a
   * warning rather than blocking the import.
   */
  async fetchSchema(collection: string): Promise<LiveSchema> {
    const uid = `api::${collection}.${collection}`;
    const body = await this.get<CtbResponse>(`/content-type-builder/content-types/${uid}`);
    const attributes: Record<string, LiveSchemaAttribute> = {};
    for (const [name, def] of Object.entries(body.data.schema.attributes)) {
      attributes[name] = {
        type: def.type,
        required: def.required ?? false,
        localized: def.pluginOptions?.i18n?.localized ?? false,
      };
    }
    return { attributes };
  }

  private async get<T>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      headers: { authorization: `Bearer ${this.token}` },
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new ImportError(
        `GET ${path} failed: ${response.status} ${response.statusText} ${detail}`.trim(),
      );
    }
    return (await response.json()) as T;
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
