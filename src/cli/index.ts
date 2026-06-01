#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import { runImport, parseThroughputOptions } from './run.js';
import type { RawThroughputFlags } from './run.js';

const program = new Command();

interface CliOptions extends RawThroughputFlags {
  dryRun?: boolean;
  yes?: boolean;
}

program
  .name('zoonotify-import')
  .description('Bulk-loads the Zoonotify source workbook into the CMS via the Import admin API.')
  .argument('[workbook]', 'path to the source .xlsx workbook')
  .option('--dry-run', 'run pre-flight and print the summary, but make no changes')
  .option('-y, --yes', 'skip the interactive confirmation prompt')
  .option('--batch-size <rows>', 'rows per bulk-create request', '200')
  .option('--concurrency <n>', 'max in-flight bulk-create requests', '3')
  .option('--request-timeout <seconds>', 'per-request timeout in seconds', '30')
  .option('--max-retries <n>', 'retries per batch on transient errors', '4')
  .option(
    '--circuit-breaker-threshold <n>',
    'consecutive failed batches that abort the import',
    '3',
  )
  .action(async (workbook: string | undefined, options: CliOptions) => {
    let throughput;
    try {
      throughput = parseThroughputOptions(options);
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
    const code = await runImport(
      workbook,
      {
        STRAPI_URL: process.env.STRAPI_URL,
        STRAPI_TOKEN: process.env.STRAPI_TOKEN,
      },
      undefined,
      { dryRun: options.dryRun, yes: options.yes, throughput },
    );
    process.exit(code);
  });

await program.parseAsync(process.argv);
