import type { BulkRow } from '../core/domain.js';
import type {
  StrapiClient,
  TruncateResult,
  BulkCreateResult,
  LiveSchema,
  LiveSchemaAttribute,
} from '../core/strapi-client.js';
import { ImportError, RequestError } from '../core/errors.js';

/** The slice of Strapi's content-type-builder response the schema-drift check needs. */
interface CtbAttribute {
  type: string;
  required?: boolean;
  pluginOptions?: { i18n?: { localized?: boolean } };
}
interface CtbResponse {
  data: { schema: { attributes: Record<string, CtbAttribute> } };
}

/** CONTEXT.md § Throughput policy default; overridable via `--request-timeout`. */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/**
 * Resolve a `Retry-After` header to milliseconds. The header is either a number
 * of seconds or an HTTP-date; anything else (absent, malformed) yields
 * `undefined`. `nowMs` is injected so the HTTP-date branch is deterministic.
 */
export function parseRetryAfter(
  value: string | null,
  nowMs: number = Date.now(),
): number | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - nowMs);
}

/**
 * Native-fetch implementation of the StrapiClient port. Talks to the CMS Import
 * admin API (issue #001). Each request is bounded by a per-request timeout
 * (`requestTimeoutMs`); transient failures (retryable statuses, network resets,
 * timeouts) surface as `RequestError`s so the core retry path can classify them.
 * Batching, concurrency, and retry themselves live in the core, not here.
 */
export class HttpStrapiClient implements StrapiClient {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly token: string,
    private readonly requestTimeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS,
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

  private get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  private post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          authorization: `Bearer ${this.token}`,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch (err) {
      throw toTransportError(method, path, err);
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new RequestError(
        `${method} ${path} failed: ${response.status} ${response.statusText} ${detail}`.trim(),
        {
          status: response.status,
          retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
        },
      );
    }
    return (await response.json()) as T;
  }
}

/** Translate a thrown fetch rejection (timeout, connection reset, …) into a RequestError. */
function toTransportError(method: string, path: string, err: unknown): ImportError {
  const name = err instanceof Error ? err.name : '';
  if (name === 'TimeoutError' || name === 'AbortError') {
    return new RequestError(`${method} ${path} timed out`, { code: 'ETIMEDOUT' });
  }
  const cause = (err as { cause?: { code?: string } }).cause;
  if (cause?.code) {
    return new RequestError(`${method} ${path} failed: ${cause.code}`, { code: cause.code });
  }
  return new RequestError(`${method} ${path} failed: ${(err as Error).message}`);
}
