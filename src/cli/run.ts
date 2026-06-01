import { access, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import ExcelJS from 'exceljs';
import type { CollectionImport } from '../core/orchestrator.js';
import type { FactImport } from '../core/fact-parser.js';
import type { StrapiClient } from '../core/strapi-client.js';
import type { PreflightReport } from '../core/preflight.js';
import type { ImportResult, ImportOutcome } from '../core/result.js';
import { parseAllReferences } from '../core/parser.js';
import { parseAllFacts } from '../core/fact-parser.js';
import { syncImport } from '../core/orchestrator.js';
import { DEFAULT_THROUGHPUT } from '../core/throughput.js';
import type { ThroughputConfig } from '../core/throughput.js';
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
}

/** Side-effecting collaborators, injected so the control flow is unit-testable. */
export interface CliDeps {
  fileExists: (path: string) => Promise<boolean>;
  /** Reads the workbook for pre-flight (check #1). Rejects if the file is not valid xlsx. */
  readWorkbook: (path: string) => Promise<ExcelJS.Workbook>;
  parseReferences: (path: string) => Promise<CollectionImport[]>;
  parseFacts: (path: string) => Promise<FactImport[]>;
  makeClient: (baseUrl: string, token: string, requestTimeoutMs: number) => StrapiClient;
  /** Asks the operator to proceed; returns their answer. Only called on a TTY without --yes. */
  confirm: (prompt: string) => Promise<boolean>;
  /** Persists the machine-readable result file. */
  writeResult: (result: ImportResult) => Promise<void>;
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
  writeResult: async (result) => {
    const safe = result.timestamp.replace(/[:.]/g, '-');
    await writeFile(`./import-result-${safe}.json`, JSON.stringify(result, null, 2), 'utf8');
  },
  now: () => new Date().toISOString(),
  isTty: () => Boolean(process.stdout.isTTY),
  log: (message) => logger.info(message),
  error: (message) => logger.error(message),
};

/**
 * Validates inputs, runs the full ten-check pre-flight, and — unless this is a
 * dry run or the operator declines — imports the workbook. Exit codes: 0 success
 * / dry-run, 1 invalid args/env/file, 2 pre-flight failed (DB untouched), 3 the
 * operator declined at the confirmation prompt. See CONTEXT.md § Pre-flight.
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
  if (!(await deps.fileExists(workbookPath))) {
    deps.error(`Workbook not found: ${workbookPath}`);
    return 1;
  }

  const throughput = options.throughput ?? DEFAULT_THROUGHPUT;
  const client = deps.makeClient(env.STRAPI_URL, env.STRAPI_TOKEN, throughput.requestTimeoutMs);

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
    await writeFailedReadResult(deps, workbookPath, err as Error);
    return 2;
  }

  reportFindings(deps, report);

  if (!report.ok) {
    deps.error(
      `Pre-flight failed: ${report.errors.length} error(s). Database untouched. See the result file.`,
    );
    await deps.writeResult(
      buildResult({ outcome: 'preflight-failed', timestamp: deps.now(), preflight: report }),
    );
    return 2;
  }

  deps.log(formatSummary(report));

  if (options.dryRun) {
    deps.log('Dry run: pre-flight passed; no changes were made.');
    await deps.writeResult(
      buildResult({ outcome: 'dry-run', timestamp: deps.now(), preflight: report }),
    );
    return 0;
  }

  // Confirmation: prompt only on an interactive TTY without --yes.
  if (deps.isTty() && !options.yes) {
    const proceed = await deps.confirm(`${confirmationText(report)} Proceed? [y/N] `);
    if (!proceed) {
      deps.log('Aborted by operator. No changes were made.');
      await deps.writeResult(
        buildResult({ outcome: 'declined', timestamp: deps.now(), preflight: report }),
      );
      return 3;
    }
  }

  const references = await deps.parseReferences(workbookPath);
  const facts = await deps.parseFacts(workbookPath);

  let importReport;
  try {
    importReport = await syncImport(client, references, facts, throughput);
  } catch (err) {
    if (err instanceof CircuitBreakerError) {
      deps.error(
        `Circuit breaker tripped: ${err.message}. The import was aborted mid-run; the database is in a partial state. See the result file and restore from your pre-run snapshot.`,
      );
      await deps.writeResult(
        buildResult({ outcome: 'circuit-breaker', timestamp: deps.now(), preflight: report }),
      );
      return 5;
    }
    throw err;
  }

  const collections = [...importReport.references, ...importReport.facts];
  for (const sync of collections) {
    deps.log(
      `Imported ${sync.collection}: deleted en=${sync.deleted.en} de=${sync.deleted.de}, created ${sync.created}.`,
    );
  }
  deps.log(
    `Done: ${importReport.references.length} reference collections, ${importReport.facts.length} fact collections, ${importReport.relations.size} relation keys.`,
  );
  await deps.writeResult(
    buildResult({ outcome: 'success', timestamp: deps.now(), preflight: report, collections }),
  );
  return 0;
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

function confirmationText(report: PreflightReport): string {
  return `${formatSummary(report)} About to DELETE and re-create ${report.summary.collections} collections (take a DB snapshot first).`;
}

async function writeFailedReadResult(deps: CliDeps, path: string, err: Error): Promise<void> {
  const outcome: ImportOutcome = 'preflight-failed';
  const preflight: PreflightReport = {
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
  await deps.writeResult(buildResult({ outcome, timestamp: deps.now(), preflight }));
}
