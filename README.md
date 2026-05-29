# zoonotify-import

Command-line importer that bulk-loads the Zoonotify source workbook (`ZooNotify_DB.xlsx`)
into the [Zoonotify CMS](../zoonotify-cms) via its **Import admin API**.

This is the **walking skeleton** (issue #002): it proves the architecture end-to-end against a
single collection — `microorganism`. Parsing, relation resolution, batching, retries, pre-flight
validation, and the remaining 11 collections land in later issues.

## Architecture

Hexagonal — the import logic is UI-agnostic and talks to Strapi only through a port
(see [ADR 0002](../docs/import-cli-spec/adr/0002-hexagonal-core-cli-as-adapter.md)).

```
src/
  core/                 ImportCore — pure TypeScript, no CLI/HTTP/logger imports
    domain.ts           LocalizedRow
    parser.ts           reads the `microorganism` sheet → LocalizedRow[]
    strapi-client.ts    StrapiClient port (truncate / bulkCreate / fetchSchema)
    orchestrator.ts     syncCollection: truncate → bulkCreate, fail-fast
    errors.ts           typed errors
  adapters/
    http-strapi-client.ts   native-fetch implementation of the port
  cli/
    index.ts            commander entry point + .env loading
    run.ts              validation + wiring (testable seam)
    logger.ts           pino logger
```

The `core/` boundary is enforced two ways: a `no-restricted-imports` ESLint rule
(`eslint.config.js`) and a dependency-graph unit test (`test/boundary.test.ts`).

## Setup

Requires **Node 20 LTS** (or newer) and npm.

```bash
npm ci
cp .env.example .env     # then fill in the values
```

`.env`:

| Variable       | Meaning                                                                  |
| -------------- | ------------------------------------------------------------------------ |
| `STRAPI_URL`   | Base URL of the CMS, no trailing slash (e.g. `http://localhost:3000`).   |
| `STRAPI_TOKEN` | API token tied to the dedicated **Import** Strapi role (see CMS README). |

## Run

```bash
npm start -- ./path/to/ZooNotify_DB.xlsx
```

This parses the `microorganism` sheet, then **truncates** the collection and **bulk-creates**
the rows (EN rows first; the DE half is attached as a locale addition by the admin endpoint).

**Exit codes:** `0` on success; `1` on a missing path argument, missing `STRAPI_URL`/`STRAPI_TOKEN`,
or a workbook file that does not exist.

> **End-to-end run is blocked by issue #001.** The live `npm start -- <path>` against a
> docker-compose CMS requires the `/import-admin/truncate` + `/import-admin/bulk-create`
> endpoints and the `Import` role from issue #001, which is not yet implemented in
> `zoonotify-cms`. The HTTP adapter targets that exact contract and is unit-tested against a
> mocked `fetch`; all other behavior is covered by the unit suite below.

## Develop

```bash
npm test          # vitest --run
npm run test:watch
npm run lint      # eslint
npm run typecheck # tsc --noEmit
npm run format    # prettier --write
```

A **husky** pre-commit hook runs `lint-staged` (ESLint + Prettier on staged files) and the full
`vitest --run` suite before a commit is allowed.

## Tests

- `test/parser.test.ts` — happy path + malformed inputs (missing column, missing sheet).
- `test/orchestrator.test.ts` — call sequence (truncate → bulkCreate) and fail-fast, via a fake `StrapiClient`.
- `test/http-strapi-client.test.ts` — request shape, response mapping, fail-fast on non-2xx, `fetchSchema` not-implemented.
- `test/cli-run.test.ts` — exit codes and happy-path wiring.
- `test/boundary.test.ts` — ImportCore imports no CLI/HTTP dependency.
