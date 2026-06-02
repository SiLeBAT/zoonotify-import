# zoonotify-import

Command-line importer that bulk-loads the Zoonotify source workbook (`ZooNotify_DB.xlsx`)
into the [Zoonotify CMS](../zoonotify-cms) via its **Import admin API**. As of **v1.0** it is
feature-complete against the [source workbook spec](../docs/import-cli-spec/source-xlsx-format.md):
it imports all **12 xlsx-managed collections** (10 reference + 2 fact), runs the full ten-check
pre-flight, streams inserts with batching/retry/circuit-breaker, and writes a machine-readable
result file.

Collections imported:

- **Reference (10):** `matrix`, `matrix-group`, `matrix-detail`, `sample-type`, `sample-origin`,
  `super-category-sample-origin`, `sampling-stage`, `specie`, `antimicrobial-substance`,
  `microorganism`. `matrix-detail` is the only non-i18n collection (flat `name`/`iri`, no
  `_en`/`_de`).
- **Fact (2):** `resistance`, `prevalence`.

Out of scope for v1 (loaded by the legacy bootstrap mechanism): `resistance-table` ("cut-off"),
`controlled-vocabulary`, `salmonella`. See [ADR 0006].

## Architecture

Hexagonal — the import logic is UI-agnostic and talks to Strapi only through a port (see [ADR 0002]).

```
src/
  core/                       ImportCore — pure TypeScript, no CLI/HTTP/logger imports
    domain.ts                 LocalizedRow / LocaleFields / fact-row types
    reference-collections.ts  declarative spec of the 10 reference collections
    fact-collections.ts       declarative spec of the 2 fact collections
    descriptors.ts            flat column descriptors driving every pre-flight check
    parser.ts / fact-parser.ts  config-driven sheet parsers
    relation-map.ts           (collection, locale, name) → id map from bulk-create responses
    preflight.ts / preflight-checks.ts  the ten checks
    throughput.ts             batching, concurrency, retry, circuit breaker, batch observer
    orchestrator.ts           truncate-all → create-all phase ordering + relation stamping
    result.ts                 the result-file schema (buildResult)
    strapi-client.ts          StrapiClient port (truncate / bulkCreate / fetchSchema)
    errors.ts                 typed errors
  adapters/
    http-strapi-client.ts     native-fetch implementation of the port
  cli/
    index.ts                  commander entry point + .env / --config loading
    run.ts                    validation, transport hardening, wiring, result assembly
    logger.ts                 pino logger factory (honors --quiet / --no-color)
```

The `core/` boundary is enforced two ways: a `no-restricted-imports` ESLint rule and a
dependency-graph unit test (`test/boundary.test.ts`).

## Setup (install)

Requires **Node 20 LTS** (or newer) and npm.

```bash
npm ci
cp .env.example .env     # then fill in the values
```

`.env`:

| Variable       | Meaning                                                                      |
| -------------- | ---------------------------------------------------------------------------- |
| `STRAPI_URL`   | Base URL of the CMS **including the `/api` REST prefix**, no trailing slash. |
| `STRAPI_TOKEN` | API token tied to the dedicated **Import** Strapi role (see CMS README).     |

`STRAPI_URL` **must be `https://`**. A plain `http://` URL is refused unless you pass `--insecure`
(intended only for local development against `http://localhost:1337/api`). Any trailing slash is
stripped automatically.

## Run

### Snapshot first (required)

The import is **delete-then-recreate** and is **not** transactional across collections. If it
fails partway, earlier collections are already replaced and there is **no automatic rollback**
(see [ADR 0004]). **Take a database snapshot before every production run.**

### Dry-run workflow

Validate the workbook without touching the database:

```bash
npm start -- --dry-run ./path/to/ZooNotify_DB.xlsx
```

This runs all ten pre-flight checks and writes a `dry-run` result file. Fix every error it
reports, re-run until it passes clean, then do the real import.

### Production-run workflow

```bash
# 1. Take a DB snapshot.
# 2. Import (prompts for confirmation on a TTY; --yes to skip):
npm start -- ./path/to/ZooNotify_DB.xlsx
# 3. Inspect the result file (see below). Exit code 0 = success.
```

### Flags

| Flag                              | Default                      | Meaning                                                            |
| --------------------------------- | ---------------------------- | ------------------------------------------------------------------ |
| `--dry-run`                       | off                          | Run pre-flight + summary only; make no changes.                    |
| `-y, --yes`                       | off                          | Skip the interactive confirmation prompt.                          |
| `--batch-size <rows>`             | `200`                        | Rows per bulk-create request.                                      |
| `--concurrency <n>`               | `3`                          | Max in-flight bulk-create requests.                                |
| `--request-timeout <seconds>`     | `30`                         | Per-request timeout.                                               |
| `--max-retries <n>`               | `4`                          | Retries per batch on `429/502/503/504`, `ECONNRESET`, `ETIMEDOUT`. |
| `--circuit-breaker-threshold <n>` | `3`                          | Consecutive failed batches that abort the import (exit 5).         |
| `--report <path>`                 | `./import-result-<ISO>.json` | Result JSON file path.                                             |
| `--config <path>`                 | —                            | JSON config file of defaults (lower priority than flags).          |
| `--verbose`                       | off                          | Log per-batch timing to stdout.                                    |
| `--quiet`                         | off                          | Suppress stdout; only errors to stderr.                            |
| `--no-color`                      | off                          | Disable ANSI color.                                                |
| `--insecure`                      | off                          | Allow a plain `http://` `STRAPI_URL` (prints a loud warning).      |

The `--config` file accepts the same knobs as JSON (camelCase, `requestTimeout` in seconds,
`noColor` for color-off), e.g.:

```json
{ "batchSize": 100, "concurrency": 2, "requestTimeout": 60, "report": "./out.json" }
```

## Exit codes → action

| Code | Meaning                                      | DB state       | Operator action                                                         |
| ---- | -------------------------------------------- | -------------- | ----------------------------------------------------------------------- |
| `0`  | Success (or `--dry-run` passed)              | fully replaced | Verify the result file; you're done.                                    |
| `1`  | Bad args / env / file / flag / `http://` URL | untouched      | Fix the invocation or `.env`; re-run.                                   |
| `2`  | Pre-flight failed                            | untouched      | Fix every error in the result file's `preflight.errors`; re-run.        |
| `3`  | Operator declined the confirmation           | untouched      | Re-run when ready (or `--yes`).                                         |
| `4`  | Import failed mid-run                        | **partial**    | Restore the snapshot; inspect `failures[]`; re-run.                     |
| `5`  | Circuit breaker tripped                      | **partial**    | The CMS is likely unhealthy. Restore the snapshot; investigate; re-run. |

## Result file

Written after every run (default `./import-result-<ISO>.json`). Shape:

```jsonc
{
  "outcome": "success", // success | preflight-failed | declined | dry-run | import-failed | circuit-breaker
  "exitCode": 0,
  "startedAt": "2026-06-01T09:00:00.000Z",
  "completedAt": "2026-06-01T09:02:11.000Z",
  "sourceFile": { "path": "./ZooNotify_DB.xlsx", "sha256": "…" }, // fingerprint for traceability
  "preflight": {
    "ok": true,
    "summary": { "collections": 12, "rowsByCollection": { "resistance": 1234 }, "totalRows": 5000 },
    "errors": [],
    "warnings": [
      /* e.g. missing-DE locale skips (check #8) */
    ],
  },
  "collections": [
    {
      "collection": "specie",
      "deleted": { "en": 12, "de": 12 }, // rows truncated per locale
      "created": 12, // rows inserted
      "batches": [
        { "index": 0, "rows": 12, "outcome": "created", "attempts": 1, "durationMs": 34 },
      ],
    },
  ],
  "failures": [], // populated on import-failed / circuit-breaker
}
```

A wrapper script can branch on `outcome`/`exitCode`; the `sha256` lets you prove which workbook
produced a given run.

## Troubleshooting

- **Exit 1, "Missing STRAPI_URL or STRAPI_TOKEN"** — copy `.env.example` to `.env` and fill it in.
- **Exit 1, "insecure http://"** — use an `https://` URL, or `--insecure` for local dev only.
- **Exit 2 with check-10 (schema drift) errors** — the CMS schema gained a required field the
  exporter doesn't emit; update the workbook (or the CMS). A schema endpoint that's unreachable
  downgrades to a _warning_, not a block.
- **Exit 2 with check-7 (relation) errors** — a fact row references a reference name absent from
  its sheet (same locale). Fix the name or add the reference row.
- **Exit 4 / 5 (partial DB)** — restore from the snapshot before re-running. Read `failures[]`
  for the failing collection/batch; exit 5 specifically means the CMS kept failing batches.
- **Slow / timing out** — lower `--batch-size`, raise `--request-timeout`, and watch `--verbose`.

See the [ops runbook](./docs/runbook.md) for step-by-step incident handling.

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

## Integration test

`test/integration/` brings up real Postgres + the real Strapi CMS via docker-compose, provisions a
custom Import token, runs the CLI against a generated fixture workbook, and asserts the resulting
DB state through the content-manager API.

```bash
npm run test:integration   # requires Docker; builds the CMS image, slow on first run
```

It is excluded from the default `npm test` and only runs when the runner sets `RUN_INTEGRATION=1`.
CI runs it as a separate job (`.github/workflows/ci.yml`).

[ADR 0002]: ../docs/import-cli-spec/adr/0002-hexagonal-core-cli-as-adapter.md
[ADR 0004]: ../docs/import-cli-spec/adr/0004-per-collection-atomicity-no-rollback.md
[ADR 0006]: ../docs/import-cli-spec/adr/0006-cut-off-excluded-from-v1.md
