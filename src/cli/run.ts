import { access } from 'node:fs/promises';
import type { CollectionImport } from '../core/orchestrator.js';
import type { StrapiClient } from '../core/strapi-client.js';
import { parseAllReferences } from '../core/parser.js';
import { syncReferences } from '../core/orchestrator.js';
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
  makeClient: (baseUrl, token) => new HttpStrapiClient(baseUrl, token),
  log: (message) => logger.info(message),
  error: (message) => logger.error(message),
};

/**
 * Validates inputs, then imports the full reference layer: truncate every
 * reference collection, then bulk-create every reference collection. Returns the
 * process exit code: 0 on success, 1 on invalid args / missing env / missing
 * workbook file.
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

  const imports = await deps.parseReferences(workbookPath);
  const client = deps.makeClient(env.STRAPI_URL, env.STRAPI_TOKEN);
  const { collections, relations } = await syncReferences(client, imports);

  for (const report of collections) {
    deps.log(
      `Imported ${report.collection}: deleted en=${report.deleted.en} de=${report.deleted.de}, created ${report.created}.`,
    );
  }
  deps.log(`Done: ${collections.length} reference collections, ${relations.size} relation keys.`);
  return 0;
}
