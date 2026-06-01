# zoonotify-import

Command-line importer that bulk-loads the Zoonotify source workbook (`ZooNotify_DB.xlsx`)
into the [Zoonotify CMS](../zoonotify-cms) via its **Import admin API**.

As of issue #003 it imports the full **standard reference layer** — all 9 paired-locale reference
collections (`matrix`, `matrix-group`, `sample-type`, `sample-origin`,
`super-category-sample-origin`, `sampling-stage`, `specie`, `antimicrobial-substance`,
`microorganism`). The non-i18n `matrix-detail`, the two fact tables, batching, retries, and full
pre-flight validation land in later issues.

## Architecture

Hexagonal — the import logic is UI-agnostic and talks to Strapi only through a port
(see [ADR 0002](../docs/import-cli-spec/adr/0002-hexagonal-core-cli-as-adapter.md)).

```
src/
  core/                    ImportCore — pure TypeScript, no CLI/HTTP/logger imports
    domain.ts              LocalizedRow / LocaleFields (name + optional iri)
    reference-collections.ts  declarative spec of the 9 reference collections
    parser.ts              config-driven sheet parser → LocalizedRow[] (+ parseAllReferences)
    relation-map.ts        (collection, locale, name) → id map, built from bulk-create responses
    strapi-client.ts       StrapiClient port (truncate / bulkCreate / fetchSchema)
    orchestrator.ts        syncReferences: truncate-all → bulk-create-all, builds the relation map
    errors.ts              typed errors
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

This parses every reference sheet, then **truncates all** reference collections and
**bulk-creates all** of them (EN rows first; the DE half is attached as a locale addition by the
admin endpoint). The IDs returned by each bulk-create are captured into an in-memory
`(collection, locale, name) → id` relation map — populated now, consumed by the fact-table import
in issue #004.

> Because the import-admin routes are content-API routes, `STRAPI_URL` must include the REST
> prefix, e.g. `http://localhost:1337/api`.

**Exit codes:** `0` on success or dry-run; `1` on a missing path argument, missing
`STRAPI_URL`/`STRAPI_TOKEN`, an invalid throughput flag, or a workbook file that does not exist;
`2` pre-flight failed (DB untouched); `3` operator declined the confirmation prompt; `5` the
circuit breaker tripped and the import was aborted mid-run (DB left in a partial state — restore
from your pre-run snapshot and consult the result file).

## Throughput & resilience

Bulk-creates are streamed in batches with a bounded concurrency, per-request timeouts, retry with
exponential backoff, and a circuit breaker (see CONTEXT.md § Throughput policy). All five knobs are
CLI flags with the defaults below:

| Flag                              | Default | Meaning                                                                                   |
| --------------------------------- | ------- | ----------------------------------------------------------------------------------------- |
| `--batch-size <rows>`             | `200`   | Rows per bulk-create request (last batch may be partial).                                 |
| `--concurrency <n>`               | `3`     | Maximum in-flight bulk-create requests (p-limit semaphore).                               |
| `--request-timeout <seconds>`     | `30`    | Per-request timeout; a timeout routes into the retry path.                                |
| `--max-retries <n>`               | `4`     | Retries per batch on `429/502/503/504`, `ECONNRESET`, `ETIMEDOUT`.                        |
| `--circuit-breaker-threshold <n>` | `3`     | Consecutive batches that may exhaust their retry cycle before the import aborts (exit 5). |

Retry backoff is `1s, 2s, 4s, 8s`; a server `Retry-After` header (seconds or HTTP-date) overrides
the backoff for that one retry. Other `4xx` responses are treated as programming errors and are
never retried. There is no adaptive backoff in v1 — only these static defaults and explicit
operator overrides.

## Integration test

`test/integration/` brings up real Postgres + the real Strapi CMS via docker-compose, provisions a
custom Import token through the admin API, runs the CLI against a generated fixture workbook, and
asserts the resulting DB state through the content-manager API.

```bash
npm run test:integration   # requires Docker; builds the CMS image, slow on first run
```

The suite is excluded from the default `npm test` and only runs when the runner sets
`RUN_INTEGRATION=1`. It expects the sibling `../zoonotify-cms` package to be present (it builds its
Docker image). CI runs it as a separate job (`.github/workflows/ci.yml`).

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

- `test/parser.test.ts` — microorganism happy path + malformed inputs (missing column, missing sheet).
- `test/reference-parser.test.ts` — the 3 column shapes (name-only, paired-iri, matrix single iri), sentinel/locale handling, structural errors.
- `test/reference-collections.test.ts` — the registry holds all 9 collections with the expected shapes.
- `test/relation-map.test.ts` — `(collection, locale, name) → id` construction and lookup.
- `test/orchestrator.test.ts` / `test/references-orchestrator.test.ts` — single-collection sequence + fail-fast, and reference-layer truncate-all → create-all with relation-map population, via a fake `StrapiClient`.
- `test/http-strapi-client.test.ts` — request shape, response mapping, fail-fast on non-2xx, `fetchSchema` not-implemented.
- `test/cli-run.test.ts` — exit codes and reference-layer wiring (truncate-all before create-all).
- `test/boundary.test.ts` — ImportCore imports no CLI/HTTP dependency.
- `test/integration/` — docker-compose end-to-end (opt-in via `npm run test:integration`).
