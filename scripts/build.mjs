// Bundles the CLI and every runtime dependency into a single self-contained
// ESM file at dist/zoonotify-import.mjs. Operators download that one file and
// run it with `node zoonotify-import.mjs …` — no `npm install`, no node_modules.
//
// Why ESM (.mjs): src/cli/index.ts uses top-level await, which CommonJS output
// cannot express. A standalone download has no package.json, so the `.mjs`
// extension is what tells Node to load it as an ES module.
//
// esbuild already preserves the entry file's `#!/usr/bin/env node` shebang on
// line 1, so the file stays directly executable. The banner only recreates
// `require`/`__dirname`/`__filename` — globals that some bundled CommonJS deps
// (exceljs, pino) touch at runtime but which do not exist in an ESM scope.

import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

const banner = `import { createRequire as __createRequire } from 'node:module';
import { fileURLToPath as __fileURLToPath } from 'node:url';
import { dirname as __dirname_fn } from 'node:path';
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirname_fn(__filename);`;

await build({
  entryPoints: [`${root}src/cli/index.ts`],
  outfile: `${root}dist/zoonotify-import.mjs`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  // Inline every dependency; the artifact must stand alone.
  packages: 'bundle',
  minify: false,
  sourcemap: false,
  legalComments: 'none',
  banner: { js: banner },
  logLevel: 'info',
});

console.log(`\n✓ Built dist/zoonotify-import.mjs (zoonotify-import v${pkg.version})`);
