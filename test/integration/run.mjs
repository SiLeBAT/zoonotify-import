#!/usr/bin/env node
/**
 * Orchestrates the docker-compose integration run:
 *   1. bring up Postgres + the Strapi CMS (building the CMS image),
 *   2. run the integration vitest suite against it,
 *   3. always tear the stack down (and remove volumes).
 *
 * Usage: `npm run test:integration`. Requires Docker + docker compose.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const composeFile = join(here, 'docker-compose.yml');

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...opts });
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

const compose = (args) => run('docker', ['compose', '-f', composeFile, ...args]);

async function main() {
  let exitCode = 1;
  try {
    console.log('[integration] bringing up stack (building CMS image — first run is slow)…');
    const up = await compose(['up', '-d', '--build', '--wait']);
    if (up !== 0) {
      console.error('[integration] stack failed to come up healthy.');
      return up;
    }

    console.log('[integration] running vitest integration suite…');
    exitCode = await run('npx', ['vitest', 'run', '--config', 'vitest.integration.config.ts'], {
      cwd: repoRoot,
      env: { ...process.env, RUN_INTEGRATION: '1', STRAPI_URL: 'http://localhost:1337' },
    });
  } finally {
    console.log('[integration] tearing down stack…');
    await compose(['down', '-v']);
  }
  return exitCode;
}

main().then((code) => process.exit(code));
