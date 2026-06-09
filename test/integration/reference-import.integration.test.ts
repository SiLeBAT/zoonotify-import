import { describe, it, expect, beforeAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXPECTED, EXPECTED_FACTS, writeFixtureWorkbook } from './fixture.js';
import {
  waitForStrapi,
  adminJwt,
  ensureLocale,
  createImportToken,
  listCollection,
} from './strapi-admin.js';

const execFileAsync = promisify(execFile);
// On Windows, `npx` resolves to `npx.cmd`, which execFile can't spawn without a
// shell (ENOENT). Mirror run.mjs and shell out on win32.
const run = (
  cmd: string,
  args: string[],
  opts: Parameters<typeof execFileAsync>[2] = {},
): ReturnType<typeof execFileAsync> =>
  execFileAsync(cmd, args, { shell: process.platform === 'win32', ...opts });

// Opt-in: this suite needs the docker-compose stack (PG + Strapi) up. It is
// excluded from the default `npm test` (see vitest.config.ts) and only runs via
// `npm run test:integration`, which sets RUN_INTEGRATION=1.
const ENABLED = process.env.RUN_INTEGRATION === '1';

// Admin base (no /api prefix); the CLI talks to the content API at `${ADMIN_BASE}/api`.
const ADMIN_BASE = (process.env.STRAPI_URL ?? 'http://localhost:1337').replace(/\/+$/, '');
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

describe.runIf(ENABLED)('full workbook import against a live CMS', () => {
  let token: string;
  let jwt: string;
  let workbookPath: string;

  beforeAll(async () => {
    await waitForStrapi(ADMIN_BASE);
    jwt = await adminJwt(ADMIN_BASE);
    // A fresh CMS has only the default `en`; the importer writes DE localizations,
    // so `de` must be registered first (production configures it in the admin panel).
    await ensureLocale(ADMIN_BASE, jwt, 'de', 'German (de)');
    token = await createImportToken(ADMIN_BASE, jwt);

    const dir = await mkdtemp(join(tmpdir(), 'zni-integration-'));
    workbookPath = join(dir, 'ZooNotify_DB.xlsx');
    await writeFixtureWorkbook(workbookPath);

    // Run the real CLI end-to-end against the live CMS.
    const { stdout } = await run('npx', ['tsx', 'src/cli/index.ts', '--insecure', workbookPath], {
      cwd: repoRoot,
      env: {
        ...process.env,
        STRAPI_URL: `${ADMIN_BASE}/api`,
        STRAPI_TOKEN: token,
      },
    });
    expect(stdout).toMatch(/Done: 10 reference collections, 2 fact collections/);
  }, 240_000);

  it('imports every reference collection with the expected per-locale row counts', async () => {
    for (const spec of EXPECTED) {
      const en = await listCollection(ADMIN_BASE, jwt, spec.collection, 'en');
      const de = await listCollection(ADMIN_BASE, jwt, spec.collection, 'de');
      expect(en.pagination.total, `${spec.collection} EN count`).toBe(spec.enCount);
      expect(de.pagination.total, `${spec.collection} DE count`).toBe(spec.deCount);
    }
  });

  it('persists a reference name on both locales, linked by document (matrix)', async () => {
    const en = await listCollection(ADMIN_BASE, jwt, 'matrix', 'en');
    const de = await listCollection(ADMIN_BASE, jwt, 'matrix', 'de');
    expect(en.results.find((r) => r.name === 'Chicken meat')).toBeDefined();
    expect(de.results.find((r) => r.name === 'Hähnchenfleisch')).toBeDefined();
  });

  it('harvests matrix-detail from the fact sheets (Breast meat + Skin)', async () => {
    const en = await listCollection(ADMIN_BASE, jwt, 'matrix-detail', 'en');
    const names = en.results.map((r) => r.name).sort();
    expect(names).toEqual(['Breast meat', 'Skin']);
  });

  it('imports both fact collections with the expected per-locale row counts', async () => {
    for (const fact of EXPECTED_FACTS) {
      const en = await listCollection(ADMIN_BASE, jwt, fact.collection, 'en');
      const de = await listCollection(ADMIN_BASE, jwt, fact.collection, 'de');
      expect(en.pagination.total, `${fact.collection} EN count`).toBe(fact.enCount);
      expect(de.pagination.total, `${fact.collection} DE count`).toBe(fact.deCount);
    }
  });

  it('carries the resistance dbId through to the DB (required + unique in schema)', async () => {
    const en = await listCollection(ADMIN_BASE, jwt, 'resistance', 'en');
    expect(en.results[0]?.dbId).toBe('R-2024-001');
  });

  it('persists prevalence scalars; the dropped matrixDetail/sampleType columns leave no trace', async () => {
    const en = await listCollection(ADMIN_BASE, jwt, 'prevalence', 'en');
    const row = en.results[0];
    expect(row?.numberOfSamples).toBe(50);
    // The prevalence schema never had these relations; they must not have been persisted.
    expect(row).not.toHaveProperty('matrixDetail');
    expect(row).not.toHaveProperty('sampleType');
  });

  // NOTE: that each relation name was correctly translated to its locale's Strapi
  // ID is asserted exhaustively by the unit suites (resolve-fact-row, sync-import);
  // here the GETs confirm the rows landed with the right counts and scalars.

  it('re-imports correctly with batching + concurrency forced on (--batch-size 1 --concurrency 2)', async () => {
    // Drive the throughput path hard: one row per request, two in flight. The
    // delete-then-recreate result must match the single-batch happy path.
    const { stdout } = await run(
      'npx',
      [
        'tsx',
        'src/cli/index.ts',
        '--insecure',
        '--batch-size',
        '1',
        '--concurrency',
        '2',
        '-y',
        workbookPath,
      ],
      {
        cwd: repoRoot,
        env: { ...process.env, STRAPI_URL: `${ADMIN_BASE}/api`, STRAPI_TOKEN: token },
      },
    );
    expect(stdout).toMatch(/Done: 10 reference collections, 2 fact collections/);

    for (const spec of EXPECTED) {
      const en = await listCollection(ADMIN_BASE, jwt, spec.collection, 'en');
      const de = await listCollection(ADMIN_BASE, jwt, spec.collection, 'de');
      expect(en.pagination.total, `${spec.collection} EN count (batched)`).toBe(spec.enCount);
      expect(de.pagination.total, `${spec.collection} DE count (batched)`).toBe(spec.deCount);
    }
  }, 240_000);

  it('--dry-run runs pre-flight, prints the summary, exits 0, and leaves the DB untouched', async () => {
    // Capture current counts so the assertion is independent of test ordering:
    // a dry run must not change them, whatever they are.
    const before = await Promise.all(
      [...EXPECTED, ...EXPECTED_FACTS].map(async (spec) => ({
        collection: spec.collection,
        total: (await listCollection(ADMIN_BASE, jwt, spec.collection, 'en')).pagination.total,
      })),
    );

    const { stdout } = await run(
      'npx',
      ['tsx', 'src/cli/index.ts', '--insecure', '--dry-run', workbookPath],
      {
        cwd: repoRoot,
        env: { ...process.env, STRAPI_URL: `${ADMIN_BASE}/api`, STRAPI_TOKEN: token },
      },
    );
    expect(stdout).toMatch(/Pre-flight: parsed/);
    expect(stdout).toMatch(/Dry run/i);

    for (const { collection, total } of before) {
      const after = (await listCollection(ADMIN_BASE, jwt, collection, 'en')).pagination.total;
      expect(after, `${collection} unchanged by dry run`).toBe(total);
    }
  }, 120_000);
});
