import type { TruncateResult } from './strapi-client.js';
import type { PreflightReport } from './preflight.js';

/**
 * The machine-readable result file written after every run (`./import-result-
 * <ISO>.json` by default). A wrapper script reacts to `outcome`/`exitCode`; the
 * pre-flight section lists every error and warning so the data steward can fix
 * them in one pass; `collections[]` records what was actually written (with a
 * per-batch breakdown) and `failures[]` carries diagnostics when a run breaks.
 * See ADR 0004 (outcomes) and CONTEXT.md § Pre-flight validation / Result JSON.
 */

export type ImportOutcome =
  | 'success'
  | 'preflight-failed'
  | 'declined'
  | 'dry-run'
  | 'import-failed'
  | 'circuit-breaker';

/** Fingerprint of the workbook that was imported, for traceability. */
export interface SourceFileInfo {
  path: string;
  /** SHA-256 hex digest of the workbook bytes. */
  sha256: string;
}

/** One bulk-create batch's outcome within a collection. */
export interface BatchDetail {
  /** 0-based batch index within the collection's row stream. */
  index: number;
  /** Rows in this batch. */
  rows: number;
  outcome: 'created' | 'failed';
  /** Total attempts made (1 + retries used). */
  attempts: number;
  /** Wall-clock duration of the batch, including retries, in milliseconds. */
  durationMs: number;
  /** Failure message, present only when `outcome === 'failed'`. */
  error?: string;
}

/** Per-collection truncate + insert outcome with a per-batch breakdown. */
export interface CollectionResult {
  collection: string;
  /** Rows deleted by the truncate, per locale. */
  deleted: TruncateResult;
  /** Rows successfully inserted. */
  created: number;
  batches: BatchDetail[];
}

/** A single diagnostic failure record (a tripped batch, a fatal error, …). */
export interface ImportFailure {
  /** Collection being written when the failure occurred, when known. */
  collection?: string;
  /** Batch index within that collection, when the failure was batch-scoped. */
  batchIndex?: number;
  /** HTTP status, when the failure came from a response. */
  status?: number;
  /** Transport error code (e.g. ECONNRESET), when applicable. */
  code?: string;
  message: string;
}

export interface ImportResult {
  outcome: ImportOutcome;
  /** Process exit code this run will return (0–5). */
  exitCode: number;
  startedAt: string;
  completedAt: string;
  sourceFile: SourceFileInfo;
  preflight: {
    ok: boolean;
    summary: PreflightReport['summary'];
    errors: PreflightReport['errors'];
    warnings: PreflightReport['warnings'];
  };
  /** Per-collection write outcome; empty when no import phase ran. */
  collections: CollectionResult[];
  /** Diagnostics for a broken run; empty on success/dry-run/declined. */
  failures: ImportFailure[];
}

export interface BuildResultParams {
  outcome: ImportOutcome;
  exitCode: number;
  startedAt: string;
  completedAt: string;
  sourceFile: SourceFileInfo;
  preflight: PreflightReport;
  collections?: CollectionResult[];
  failures?: ImportFailure[];
}

export function buildResult(params: BuildResultParams): ImportResult {
  const { outcome, exitCode, startedAt, completedAt, sourceFile, preflight } = params;
  return {
    outcome,
    exitCode,
    startedAt,
    completedAt,
    sourceFile,
    preflight: {
      ok: preflight.ok,
      summary: preflight.summary,
      errors: preflight.errors,
      warnings: preflight.warnings,
    },
    collections: params.collections ?? [],
    failures: params.failures ?? [],
  };
}
