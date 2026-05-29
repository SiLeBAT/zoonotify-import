import { describe, it, expect } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const coreDir = fileURLToPath(new URL('../src/core', import.meta.url));

// ImportCore is pure: no CLI framework, no logger, no env loading, no HTTP, and
// no reaching into an adapter or the CLI. See ADR 0002. The ESLint rule in
// eslint.config.js enforces the same contract at lint/pre-commit time; this
// test is the belt-and-suspenders that travels with the suite.
const FORBIDDEN: RegExp[] = [
  /from\s+['"]commander['"]/,
  /from\s+['"]pino(-pretty)?['"]/,
  /from\s+['"]dotenv['"]/,
  /from\s+['"]undici['"]/,
  /from\s+['"][^'"]*\/(adapters|cli)\//,
];

async function coreSourceFiles(): Promise<string[]> {
  const entries = await readdir(coreDir, { recursive: true });
  return entries.filter((e) => e.endsWith('.ts')).map((e) => join(coreDir, e));
}

describe('ImportCore dependency boundary', () => {
  it('imports no CLI- or HTTP-specific dependency', async () => {
    const files = await coreSourceFiles();
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const source = await readFile(file, 'utf8');
      for (const pattern of FORBIDDEN) {
        expect(source, `${file} violates the core boundary: ${pattern}`).not.toMatch(pattern);
      }
    }
  });
});
