#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import { runImport } from './run.js';

const program = new Command();

program
  .name('zoonotify-import')
  .description('Bulk-loads the Zoonotify source workbook into the CMS via the Import admin API.')
  .argument('[workbook]', 'path to the source .xlsx workbook')
  .option('--dry-run', 'run pre-flight and print the summary, but make no changes')
  .option('-y, --yes', 'skip the interactive confirmation prompt')
  .action(async (workbook: string | undefined, options: { dryRun?: boolean; yes?: boolean }) => {
    const code = await runImport(
      workbook,
      {
        STRAPI_URL: process.env.STRAPI_URL,
        STRAPI_TOKEN: process.env.STRAPI_TOKEN,
      },
      undefined,
      { dryRun: options.dryRun, yes: options.yes },
    );
    process.exit(code);
  });

await program.parseAsync(process.argv);
