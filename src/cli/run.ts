import { access, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import ExcelJS from 'exceljs';
import type { CollectionImport, SyncReport } from '../core/orchestrator.js';
import type { FactImport } from '../core/fact-parser.js';
import type { StrapiClient } from '../core/strapi-client.js';
import type { PreflightReport } from '../core/preflight.js';
import type {
  ImportResult,
  ImportOutcome,
  CollectionResult,
  ImportFailure,
  SourceFileInfo,
} from '../core/result.js';
import { parseAllReferences } from '../core/parser.js';
import { parseAllFacts } from '../core/fact-parser.js';
import { syncImport } from '../core/orchestrator.js';
import { DEFAULT_THROUGHPUT, defaultRetryDeps } from '../core/throughput.js';
import type { ThroughputConfig, BatchEvent, RetryDeps } from '../core/throughput.js';
import { CircuitBreakerError } from '../core/errors.js';
import { runPreflight } from '../core/preflight.js';
import { describeAllCollections } from '../core/descriptors.js';
import { buildResult } from '../core/result.js';
import { HttpStrapiClient } from '../adapters/http-strapi-client.js';
import { logger } from './logger.js';

export interface CliEnv {
  STRAPI_URL?: string;
  STRAPI_TOKEN?: string;
}

/** Raw `--`-flag strings from commander, before parsing/validation. */
export interface RawThroughputFlags {
  batchSize?: string;
  concurrency?: string;
  /** Per-request timeout in *seconds* (converted to ms in the config). */
  requestTimeout?: string;
  maxRetries?: string;
  circuitBreakerThreshold?: string;
}

/**
 * Resolve the five throughput flags into a `ThroughputConfig`, applying the
 * CONTEXT.md defaults for any that are absent. `--request-timeout` is read in
 * seconds and stored as milliseconds. Throws on a non-numeric or out-of-range
 * value so the CLI can fail with exit 1 before touching the database.
 */
export function parseThroughputOptions(raw: RawThroughputFlags): ThroughputConfig {
  return {
    batchSize: intFlag('batch-size', raw.batchSize, DEFAULT_THROUGHPUT.batchSize, 1),
    concurrency: intFlag('concurrency', raw.concurrency, DEFAULT_THROUGHPUT.concurrency, 1),
    requestTimeoutMs:
      intFlag(
        'request-timeout',
        raw.requestTimeout,
        DEFAULT_THROUGHPUT.requestTimeoutMs / 1000,
        1,
      ) * 1000,
    maxRetries: intFlag('max-retries', raw.maxRetries, DEFAULT_THROUGHPUT.maxRetries, 0),
    circuitBreakerThreshold: intFlag(
      'circuit-breaker-threshold',
      raw.circuitBreakerThreshold,
      DEFAULT_THROUGHPUT.circuitBreakerThreshold,
      1,
    ),
  };
}

function intFlag(name: string, value: string | undefined, fallback: number, min: number): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value.trim())) {
    throw new Error(`--${name} must be a whole number, got "${value}"`);
  }
  const n = Number(value);
  if (n < min) {
    throw new Error(`--${name} must be at least ${min}, got ${n}`);
  }
  return n;
}

export interface RunOptions {
  /** Run pre-flight only, print the summary, and exit without touching the DB. */
  dryRun?: boolean;
  /** Skip the interactive confirmation prompt. */
  yes?: boolean;
  /** Throughput knobs (batching, concurrency, timeout, retry, breaker). */
  throughput?: ThroughputConfig;
  /** Allow a plain `http://` STRAPI_URL (otherwise refused). Prints a loud warning. */
  insecure?: boolean;
  /** Result file path; defaults to `./import-result-<ISO>.json`. */
  report?: string;
  /** Log per-batch timing to stdout while importing. */
  verbose?: boolean;
}

/** Side-effecting collaborators, injected so the control flow is unit-testable. */
export interface CliDeps {
  fileExists: (path: string) => Promise<boolean>;
  /** Reads the workbook for pre-flight (check #1). Rejects if the file is not valid xlsx. */
  readWorkbook: (path: string) => Promise<ExcelJS.Workbook>;
  /** SHA-256 hex digest of the workbook bytes, for the result file's traceability fingerprint. */
  hashFile: (path: string) => Promise<string>;
  parseReferences: (path: string) => Promise<CollectionImport[]>;
  parseFacts: (path: string) => Promise<FactImport[]>;
  makeClient: (baseUrl: string, token: string, requestTimeoutMs: number) => StrapiClient;
  /** Asks the operator to proceed; returns their answer. Only called on a TTY without --yes. */
  confirm: (prompt: string) => Promise<boolean>;
  /** Persists the machine-readable result file at the resolved path. */
  writeResult: (result: ImportResult, path: string) => Promise<void>;
  now: () => string;
  isTty: () => boolean;
  log: (message: string) => void;
  error: (message: string) => void;
}

export const defaultDeps: CliDeps = {
  fileExists: async (path) => {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  },
  readWorkbook: async (path) => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(path);
    return workbook;
  },
  hashFile: async (path) =>
    createHash('sha256')
      .update(await readFile(path))
      .digest('hex'),
  parseReferences: parseAllReferences,
  parseFacts: parseAllFacts,
  makeClient: (baseUrl, token, requestTimeoutMs) =>
    new HttpStrapiClient(baseUrl, token, requestTimeoutMs),
  confirm: async (prompt) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const answer = await rl.question(prompt);
      return /^y(es)?$/i.test(answer.trim());
    } finally {
      rl.close();
    }
  },
  writeResult: async (result, path) => {
    await writeFile(path, JSON.stringify(result, null, 2), 'utf8');
  },
  now: () => new Date().toISOString(),
  isTty: () => Boolean(process.stdout.isTTY),
  log: (message) => logger.info(message),
  error: (message) => logger.error(message),
};

/**
 * Validates inputs, runs the full ten-check pre-flight, and — unless this is a
 * dry run or the operator declines — imports the workbook. Returns the process
 * exit code, all six of which are reachable:
 *   0 success / dry-run · 1 invalid args/env/file/flag/insecure-url ·
 *   2 pre-flight failed (DB untouched) · 3 operator declined ·
 *   4 import failed mid-run (DB partial) · 5 circuit breaker tripped (DB partial).
 * See CONTEXT.md § Pre-flight validation / Transport / Atomicity scope.
 */
export async function runImport(
  workbookPath: string | undefined,
  env: CliEnv,
  deps: CliDeps = defaultDeps,
  options: RunOptions = {},
): Promise<number> {
  if (!workbookPath) {
    deps.error('Missing required argument: <workbook.xlsx>');
    return 1;
  }
  if (!env.STRAPI_URL || !env.STRAPI_TOKEN) {
    deps.error('Missing STRAPI_URL or STRAPI_TOKEN — set them in .env (see .env.example).');
    return 1;
  }

  // Transport: normalize the trailing slash, then enforce HTTPS unless --insecure.
  const baseUrl = env.STRAPI_URL.replace(/\/+$/, '');
  if (baseUrl.startsWith('http://')) {
    if (!options.insecure) {
      deps.error(
        `STRAPI_URL uses insecure http:// (${baseUrl}). Refusing to send the import token over plaintext. Use an https:// URL, or pass --insecure to override (NOT recommended outside local development).`,
      );
      return 1;
    }
    deps.error(
      `⚠️  WARNING: --insecure is set — sending the import token over plaintext http:// to ${baseUrl}. Do NOT use this against staging or production.`,
    );
  }

  if (!(await deps.fileExists(workbookPath))) {
    deps.error(`Workbook not found: ${workbookPath}`);
    return 1;
  }

  const startedAt = deps.now();
  const sourceFile: SourceFileInfo = {
    path: workbookPath,
    sha256: await deps.hashFile(workbookPath),
  };
  const reportPath = options.report ?? defaultReportPath(startedAt);

  /** Build + persist the result file, capturing the completion timestamp. */
  const persist = (
    outcome: ImportOutcome,
    exitCode: number,
    preflight: PreflightReport,
    extra: { collections?: CollectionResult[]; failures?: ImportFailure[] } = {},
  ): Promise<void> =>
    deps.writeResult(
      buildResult({
        outcome,
        exitCode,
        startedAt,
        completedAt: deps.now(),
        sourceFile,
        preflight,
        ...extra,
      }),
      reportPath,
    );

  const throughput = options.throughput ?? DEFAULT_THROUGHPUT;
  const client = deps.makeClient(baseUrl, env.STRAPI_TOKEN, throughput.requestTimeoutMs);

  // Check #1 + the rest of pre-flight. A workbook that won't parse is itself a
  // pre-flight failure (DB untouched, exit 2).
  let report: PreflightReport;
  try {
    const workbook = await deps.readWorkbook(workbookPath);
    report = await runPreflight(workbook, describeAllCollections(), {
      fetchSchema: (collection) => client.fetchSchema(collection),
    });
  } catch (err) {
    deps.error(`Could not read workbook as .xlsx: ${(err as Error).message}`);
    await persist('preflight-failed', 2, unreadableWorkbookReport(workbookPath, err as Error));
    return 2;
  }

  reportFindings(deps, report);

  if (!report.ok) {
    deps.error(
      `Pre-flight failed: ${report.errors.length} error(s). Database untouched. See the result file.`,
    );
    await persist('preflight-failed', 2, report);
    return 2;
  }

  deps.log(formatSummary(report));

  if (options.dryRun) {
    deps.log('Dry run: pre-flight passed; no changes were made.');
    await persist('dry-run', 0, report);
    return 0;
  }

  // Confirmation: prompt only on an interactive TTY without --yes.
  if (deps.isTty() && !options.yes) {
    const proceed = await deps.confirm(`${confirmationText(report)} Proceed? [y/N] `);
    if (!proceed) {
      deps.log('Aborted by operator. No changes were made.');
      await persist('declined', 3, report);
      return 3;
    }
  }

  const references = await deps.parseReferences(workbookPath);
  const facts = await deps.parseFacts(workbookPath);

  // Collect per-batch detail for both the result file and (when --verbose) stdout.
  const batchEvents: BatchEvent[] = [];
  const retryDeps: RetryDeps = {
    ...defaultRetryDeps,
    onBatch: (event) => {
      batchEvents.push(event);
      if (options.verbose) {
        deps.log(formatBatch(event));
      }
    },
  };

  let importReport;
  try {
    importReport = await syncImport(client, references, facts, throughput, retryDeps);
  } catch (err) {
    const failures = collectFailures(batchEvents, err);
    if (err instanceof CircuitBreakerError) {
      deps.error(
        `Circuit breaker tripped: ${err.message}. The import was aborted mid-run; the database is in a partial state. See the result file and restore from your pre-run snapshot.`,
      );
      await persist('circuit-breaker', 5, report, { failures });
      return 5;
    }
    // Any other failure mid-import: the DB may be in a partial state. Report it
    // (exit 4) rather than crashing, so the operator gets a result file to act on.
    deps.error(
      `Import failed: ${(err as Error).message}. The database may be in a partial state. See the result file and restore from your pre-run snapshot.`,
    );
    await persist('import-failed', 4, report, { failures });
    return 4;
  }

  const syncs = [...importReport.references, ...importReport.facts];
  for (const sync of syncs) {
    deps.log(
      `Imported ${sync.collection}: deleted en=${sync.deleted.en} de=${sync.deleted.de}, created ${sync.created}.`,
    );
  }
  deps.log(
    `Done: ${importReport.references.length} reference collections, ${importReport.facts.length} fact collections, ${importReport.relations.size} relation keys.`,
  );
  await persist('success', 0, report, { collections: toCollectionResults(syncs, batchEvents) });
  return 0;
}

/** Default result-file name, derived from the run's start timestamp. */
function defaultReportPath(startedAt: string): string {
  return `./import-result-${startedAt.replace(/[:.]/g, '-')}.json`;
}

/** Joins each collection's truncate/insert counts with its per-batch detail. */
function toCollectionResults(syncs: SyncReport[], events: BatchEvent[]): CollectionResult[] {
  return syncs.map((sync) => ({
    collection: sync.collection,
    deleted: sync.deleted,
    created: sync.created,
    batches: events
      .filter((e) => e.collection === sync.collection)
      .sort((a, b) => a.index - b.index)
      .map((e) => ({
        index: e.index,
        rows: e.rows,
        outcome: e.outcome,
        attempts: e.attempts,
        durationMs: e.durationMs,
        ...(e.error !== undefined ? { error: e.error } : {}),
      })),
  }));
}

/** Builds the diagnostics list from the failed batches plus the fatal error. */
function collectFailures(events: BatchEvent[], err: unknown): ImportFailure[] {
  const failures: ImportFailure[] = events
    .filter((e) => e.outcome === 'failed')
    .map((e) => ({
      collection: e.collection,
      batchIndex: e.index,
      message: e.error ?? 'batch failed',
    }));
  if (failures.length === 0) {
    const collection = err instanceof CircuitBreakerError ? err.collection : undefined;
    failures.push(
      collection
        ? { collection, message: (err as Error).message }
        : { message: (err as Error).message },
    );
  }
  return failures;
}

/** Logs every pre-flight error and warning so the operator sees the whole list. */
function reportFindings(deps: CliDeps, report: PreflightReport): void {
  for (const finding of report.errors) {
    deps.error(finding.message);
  }
  for (const finding of report.warnings) {
    deps.log(`warning: ${finding.message}`);
  }
}

function formatSummary(report: PreflightReport): string {
  const { totalRows, collections } = report.summary;
  return `Pre-flight: parsed ${totalRows} rows across ${collections} collections — ${report.errors.length} error(s), ${report.warnings.length} warning(s).`;
}

function formatBatch(event: BatchEvent): string {
  const attempts = event.attempts === 1 ? '1 attempt' : `${event.attempts} attempts`;
  return `batch ${event.collection}#${event.index}: ${event.rows} row(s) ${event.outcome} in ${event.durationMs}ms (${attempts})`;
}

function confirmationText(report: PreflightReport): string {
  return `${formatSummary(report)} About to DELETE and re-create ${report.summary.collections} collections (take a DB snapshot first).`;
}

/** Synthesizes a check-1 pre-flight report for a workbook that would not parse. */
function unreadableWorkbookReport(path: string, err: Error): PreflightReport {
  return {
    ok: false,
    errors: [
      {
        check: 1,
        level: 'error',
        message: `Workbook \`${path}\` is not a valid .xlsx file: ${err.message}`,
      },
    ],
    warnings: [],
    summary: { collections: 0, rowsByCollection: {}, totalRows: 0 },
  };
}
