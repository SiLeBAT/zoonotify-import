#!/usr/bin/env node
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { Command } from 'commander';
import { runImport, resolveCli, defaultDeps } from './run.js';
import type { RawCliFlags, ImportConfigFile, CliDeps } from './run.js';
import { createLogger } from './logger.js';

const program = new Command();

program
  .name('zoonotify-import')
  .description('Bulk-loads the Zoonotify source workbook into the CMS via the Import admin API.')
  .argument('[workbook]', 'path to the source .xlsx workbook')
  .option('--dry-run', 'run pre-flight and print the summary, but make no changes')
  .option('-y, --yes', 'skip the interactive confirmation prompt')
  .option('--batch-size <rows>', 'rows per bulk-create request (default 200)')
  .option('--concurrency <n>', 'max in-flight bulk-create requests (default 3)')
  .option('--request-timeout <seconds>', 'per-request timeout in seconds (default 30)')
  .option('--max-retries <n>', 'retries per batch on transient errors (default 4)')
  .option(
    '--circuit-breaker-threshold <n>',
    'consecutive failed batches that abort the import (default 3)',
  )
  .option('--report <path>', 'result JSON file path (default ./import-result-<ISO>.json)')
  .option('--config <path>', 'config file (JSON) with defaults; lower priority than flags')
  .option('--verbose', 'log per-batch timing to stdout')
  .option('--quiet', 'suppress stdout; only errors go to stderr')
  .option('--no-color', 'disable ANSI color in console output')
  .option('--insecure', 'allow a plain http:// STRAPI_URL (prints a loud warning)')
  .action(async (workbook: string | undefined, options: RawCliFlags & { config?: string }) => {
    let config: ImportConfigFile = {};
    if (options.config) {
      try {
        config = JSON.parse(await readFile(options.config, 'utf8')) as ImportConfigFile;
      } catch (err) {
        process.stderr.write(
          `Could not read --config file "${options.config}": ${(err as Error).message}\n`,
        );
        process.exit(1);
      }
    }

    let resolved;
    try {
      resolved = resolveCli(options, config);
    } catch (err) {
      process.stderr.write(`${(err as Error).message}\n`);
      process.exit(1);
    }

    // Per-run logger honoring --quiet / --no-color. Errors always go to stderr.
    const log = createLogger({ quiet: resolved.quiet, color: resolved.color });
    const deps: CliDeps = {
      ...defaultDeps,
      log: (message) => {
        if (!resolved.quiet) log.info(message);
      },
      error: (message) => process.stderr.write(`${message}\n`),
    };

    const code = await runImport(
      workbook,
      {
        STRAPI_URL: process.env.STRAPI_URL,
        STRAPI_TOKEN: process.env.STRAPI_TOKEN,
      },
      deps,
      {
        dryRun: resolved.dryRun,
        yes: resolved.yes,
        throughput: resolved.throughput,
        insecure: resolved.insecure,
        report: resolved.report,
        verbose: resolved.verbose,
      },
    );
    process.exit(code);
  });

await program.parseAsync(process.argv);
