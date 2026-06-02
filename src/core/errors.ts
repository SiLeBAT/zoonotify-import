/** Base class for every error the import core raises. */
export class ImportError extends Error {}

/** A required sheet is absent from the workbook. */
export class SheetNotFoundError extends ImportError {
  constructor(public readonly sheet: string) {
    super(`sheet "${sheet}" not found in workbook`);
    this.name = 'SheetNotFoundError';
  }
}

/** A required column is absent from a sheet's header row. */
export class MissingColumnError extends ImportError {
  constructor(
    public readonly sheet: string,
    public readonly column: string,
  ) {
    super(`sheet "${sheet}" is missing required column "${column}"`);
    this.name = 'MissingColumnError';
  }
}

/** A port surface that is declared but not yet implemented (lands in #005). */
export class NotImplementedError extends ImportError {
  constructor(feature: string) {
    super(`${feature} is not implemented yet`);
    this.name = 'NotImplementedError';
  }
}

/** HTTP statuses worth a retry: rate-limit + transient gateway/server errors. */
export const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);
/** Transient network errors worth a retry. */
export const RETRYABLE_CODES = new Set(['ECONNRESET', 'ETIMEDOUT']);

/**
 * A failed request against the Import admin API, carrying just enough for the
 * core retry policy to classify it without knowing anything about HTTP. The
 * adapter produces these; the orchestrator's retry path consumes them.
 */
export class RequestError extends ImportError {
  readonly status?: number;
  readonly code?: string;
  /** `Retry-After` resolved to milliseconds, when the server sent one. */
  readonly retryAfterMs?: number;

  constructor(
    message: string,
    details: { status?: number; code?: string; retryAfterMs?: number } = {},
  ) {
    super(message);
    this.name = 'RequestError';
    this.status = details.status;
    this.code = details.code;
    this.retryAfterMs = details.retryAfterMs;
  }
}

/** True when `err` is a `RequestError` in the documented retryable set. */
export function isRetryable(err: unknown): boolean {
  if (!(err instanceof RequestError)) return false;
  if (err.status !== undefined && RETRYABLE_STATUSES.has(err.status)) return true;
  if (err.code !== undefined && RETRYABLE_CODES.has(err.code)) return true;
  return false;
}

/** Thrown when too many consecutive batches exhaust their full retry cycle. */
export class CircuitBreakerError extends ImportError {
  constructor(
    public readonly collection: string,
    public readonly consecutiveFailures: number,
    public override readonly cause: unknown,
  ) {
    super(
      `circuit breaker tripped for "${collection}" after ${consecutiveFailures} consecutive batch failures`,
    );
    this.name = 'CircuitBreakerError';
  }
}
