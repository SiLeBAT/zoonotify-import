import { describe, it, expect, beforeAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXPECTED, writeFixtureWorkbook } from './fixture.js';
import { waitForStrapi, adminJwt, createImportToken, listCollection } from './strapi-admin.js';

const run = promisify(execFile);

// Opt-in: this suite needs the docker-compose stack (PG + Strapi) up. It is
// excluded from the default `npm test` (see vitest.config.ts) and only runs via
// `npm run test:integration`, which sets RUN_INTEGRATION=1.
const ENABLED = process.env.RUN_INTEGRATION === '1';

// Admin base (no /api prefix); the CLI talks to the content API at `${ADMIN_BASE}/api`.
const ADMIN_BASE = (process.env.STRAPI_URL ?? 'http://localhost:1337').replace(/\/+$/, '');
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

describe.runIf(ENABLED)('reference-layer import against a live CMS', () => {
  let token: string;
  let jwt: string;
  let workbookPath: string;

  beforeAll(async () => {
    await waitForStrapi(ADMIN_BASE);
    jwt = await adminJwt(ADMIN_BASE);
    token = await createImportToken(ADMIN_BASE, jwt);

    const dir = await mkdtemp(join(tmpdir(), 'zni-integration-'));
    workbookPath = join(dir, 'ZooNotify_DB.xlsx');
    await writeFixtureWorkbook(workbookPath);

    // Run the real CLI end-to-end against the live CMS.
    const { stdout } = await run('npx', ['tsx', 'src/cli/index.ts', workbookPath], {
      cwd: repoRoot,
      env: {
        ...process.env,
        STRAPI_URL: `${ADMIN_BASE}/api`,
        STRAPI_TOKEN: token,
      },
    });
    expect(stdout).toMatch(/Done: 9 reference collections/);
  }, 240_000);

  it('imports every reference collection with the expected per-locale row counts', async () => {
    for (const spec of EXPECTED) {
      const en = await listCollection(ADMIN_BASE, jwt, spec.collection, 'en');
      const de = await listCollection(ADMIN_BASE, jwt, spec.collection, 'de');
      expect(en.pagination.total, `${spec.collection} EN count`).toBe(spec.enCount);
      expect(de.pagination.total, `${spec.collection} DE count`).toBe(spec.deCount);
    }
  });

  it('persists matrix with its single non-localized iri on the en record', async () => {
    const en = await listCollection(ADMIN_BASE, jwt, 'matrix', 'en');
    const chicken = en.results.find((r) => r.name === 'Chicken meat');
    expect(chicken).toBeDefined();
    expect(chicken!.iri).toBe('http://iri/matrix/chicken');
  });

  it('persists paired iri on both locales for a standard collection', async () => {
    const en = await listCollection(ADMIN_BASE, jwt, 'matrix-group', 'en');
    const de = await listCollection(ADMIN_BASE, jwt, 'matrix-group', 'de');
    expect(en.results.find((r) => r.name === 'Poultry')?.iri).toBe('http://iri/mg/poultry');
    expect(de.results.find((r) => r.name === 'Geflügel')?.iri).toBe('http://iri/mg/gefluegel');
  });
});
