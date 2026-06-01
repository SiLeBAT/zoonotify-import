import type { SyncReport } from './orchestrator.js';
import type { PreflightReport } from './preflight.js';

/**
 * The machine-readable result file written after every run (`./import-result-
 * <ISO>.json` by default). A wrapper script reacts to `outcome`; the pre-flight
 * section lists every error and warning so the data steward can fix them in one
 * pass. See ADR 0004 (outcomes) and CONTEXT.md § Pre-flight validation.
 */

export type ImportOutcome =
  | 'success'
  | 'preflight-failed'
  | 'declined'
  | 'dry-run'
  | 'import-failed'
  | 'circuit-breaker';

export interface ImportResult {
  outcome: ImportOutcome;
  timestamp: string;
  preflight: {
    ok: boolean;
    summary: PreflightReport['summary'];
    errors: PreflightReport['errors'];
    warnings: PreflightReport['warnings'];
  };
  /** Per-collection truncate/create outcome; present only when an import ran. */
  collections?: SyncReport[];
}

export interface BuildResultParams {
  outcome: ImportOutcome;
  timestamp: string;
  preflight: PreflightReport;
  collections?: SyncReport[];
}

export function buildResult(params: BuildResultParams): ImportResult {
  const { outcome, timestamp, preflight, collections } = params;
  const result: ImportResult = {
    outcome,
    timestamp,
    preflight: {
      ok: preflight.ok,
      summary: preflight.summary,
      errors: preflight.errors,
      warnings: preflight.warnings,
    },
  };
  if (collections) {
    result.collections = collections;
  }
  return result;
}
