import { access } from 'node:fs/promises';
import type { CollectionImport } from '../core/orchestrator.js';
import type { FactImport } from '../core/fact-parser.js';
import type { StrapiClient } from '../core/strapi-client.js';
import { parseAllReferences } from '../core/parser.js';
import { parseAllFacts } from '../core/fact-parser.js';
import { syncImport } from '../core/orchestrator.js';
import { buildReferenceNameIndex, checkRelationReferences } from '../core/preflight.js';
import { HttpStrapiClient } from '../adapters/http-strapi-client.js';
import { logger } from './logger.js';

export interface CliEnv {
  STRAPI_URL?: string;
  STRAPI_TOKEN?: string;
}

/** Side-effecting collaborators, injected so the control flow is unit-testable. */
export interface CliDeps {
  fileExists: (path: string) => Promise<boolean>;
  parseReferences: (path: string) => Promise<CollectionImport[]>;
  parseFacts: (path: string) => Promise<FactImport[]>;
  makeClient: (baseUrl: string, token: string) => StrapiClient;
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
  parseReferences: parseAllReferences,
  parseFacts: parseAllFacts,
  makeClient: (baseUrl, token) => new HttpStrapiClient(baseUrl, token),
  log: (message) => logger.info(message),
  error: (message) => logger.error(message),
};

/**
 * Validates inputs, then imports the whole workbook (reference + fact layers)
 * via syncImport. Pre-flight check #7 (relation references resolve) runs before
 * any destructive work; if it finds unresolved references the database is left
 * untouched. Returns the process exit code: 0 on success, 1 on invalid args /
 * missing env / missing workbook file, 2 on pre-flight failure.
 */
export async function runImport(
  workbookPath: string | undefined,
  env: CliEnv,
  deps: CliDeps = defaultDeps,
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

  const references = await deps.parseReferences(workbookPath);
  const facts = await deps.parseFacts(workbookPath);

  // Note any spec-ignored columns that were present and dropped (e.g.
  // prevalence's matrixDetail_*/sampleType_* — no such relations in the schema).
  for (const fact of facts) {
    if (fact.droppedColumns && fact.droppedColumns.length > 0) {
      deps.log(
        `Sheet ${fact.collection}: ignored non-schema columns ${fact.droppedColumns.join(', ')}.`,
      );
    }
  }

  // Pre-flight check #7: every fact relation must resolve in the parsed
  // reference sheets. Runs before any truncate, so a failure leaves the DB alone.
  const findings = checkRelationReferences(facts, buildReferenceNameIndex(references));
  if (findings.length > 0) {
    for (const finding of findings) {
      deps.error(finding.message);
    }
    deps.error(
      `Pre-flight failed: ${findings.length} unresolved relation reference(s). Database untouched.`,
    );
    return 2;
  }

  const client = deps.makeClient(env.STRAPI_URL, env.STRAPI_TOKEN);
  const report = await syncImport(client, references, facts);

  for (const sync of [...report.references, ...report.facts]) {
    deps.log(
      `Imported ${sync.collection}: deleted en=${sync.deleted.en} de=${sync.deleted.de}, created ${sync.created}.`,
    );
  }
  deps.log(
    `Done: ${report.references.length} reference collections, ${report.facts.length} fact collections, ${report.relations.size} relation keys.`,
  );
  return 0;
}
