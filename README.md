# zoonotify-import

Command-line tool that bulk-loads the Zoonotify surveillance workbook into the
[Zoonotify CMS](../zoonotify-cms) (Strapi v5) through its dedicated **Import admin API**.

It reads the BfR data steward's **native 3-sheet workbook** (`masterdata` + `amr_resrate` +
`prevalence`), normalizes it into the 12 CMS collections, validates everything in a ten-check
pre-flight, then **deletes and recreates** those collections with batching, retry, and a circuit
breaker — writing a machine-readable result file you can inspect or branch on.

> **The import is destructive.** It is delete-then-recreate, not an upsert, and is **not**
> transactional across collections. Always take a database snapshot before a production run.

The input contract is the **3-sheet format** (ADR 0007). The full column-by-column spec lives in
[`source-xlsx-format.md`](../docs/import-cli-spec/source-xlsx-format.md) — give that to whoever
produces the workbook.

---

## What it imports

From **3 source sheets**, the importer derives **12 collections**:

| Source sheet     | Produces                                                                                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `masterdata`     | 9 reference collections (`matrix`, `matrix-group`, `microorganism`, `specie`, `antimicrobial-substance`, `sample-type`, `sample-origin`, `super-category-sample-origin`, `sampling-stage`) |
| `amr_resrate`    | the `resistance` fact collection                                                                                                                                                           |
| `prevalence`     | the `prevalence` fact collection                                                                                                                                                           |
| both fact sheets | the `matrix-detail` reference collection (harvested from their inline `Matrixdetail` column)                                                                                               |

Out of scope (loaded by the legacy CMS bootstrap mechanism): `resistance-table` ("cut-off"),
`controlled-vocabulary`, `salmonella`. See [ADR 0006].

---

## Prerequisites

You need all of these before the importer can do anything useful:

1. **Node 20 LTS** (or newer) and **npm**. Check with `node -v`.
2. **A reachable Zoonotify CMS** that exposes the **Import admin API** (`/import-admin/truncate`
   and `/import-admin/bulk-create`) — this ships in `zoonotify-cms`.
3. **An Import-role API token** from that CMS. It must be tied to the dedicated **Import** Strapi
   role (API-token only, access limited to the two `/import-admin/*` endpoints). See the
   [CMS README](../zoonotify-cms). Treat the token as a secret — anyone holding it can wipe and
   refill the 12 collections.
4. **The source workbook** in the 3-sheet format (see
   [`source-xlsx-format.md`](../docs/import-cli-spec/source-xlsx-format.md)). Run `--dry-run` first
   to confirm it conforms.

Runtime dependencies (installed by `npm ci`, you don't add these by hand): `commander` (CLI),
`dotenv` (`.env` loading), `exceljs` (xlsx parsing), `p-limit` (concurrency), `pino` (logging).

---

## Install & configure

```bash
npm ci                 # install exact dependency versions
cp .env.example .env   # then edit .env with your values
```

`.env`:

| Variable       | Meaning                                                                      |
| -------------- | ---------------------------------------------------------------------------- |
| `STRAPI_URL`   | Base URL of the CMS **including the `/api` REST prefix**, no trailing slash. |
| `STRAPI_TOKEN` | API token tied to the dedicated **Import** Strapi role.                      |

`STRAPI_URL` **must be `https://`**. A plain `http://` URL is refused unless you pass `--insecure`
(intended only for local development against `http://localhost:1337/api`). Any trailing slash is
stripped automatically.

---

## Use it

### 1. Validate the workbook (dry run — no database changes)

```bash
npm start -- --dry-run ./path/to/ZooNotify_DB.xlsx
```

This runs all ten pre-flight checks against the workbook and writes a `dry-run` result file. It
makes **no** changes. Fix every error it reports (they name the steward's own sheets and columns,
e.g. `amr_resrate` → `Anzahl getesteter Isolate`), then re-run until it passes clean.

### 2. Take a database snapshot

There is **no automatic rollback** ([ADR 0004]). If the import fails partway, earlier collections
are already replaced. Snapshot first, every time.

### 3. Run the import

```bash
# Prompts for confirmation on a TTY; pass --yes to skip the prompt.
npm start -- ./path/to/ZooNotify_DB.xlsx
```

### 4. Inspect the result file

Exit code `0` means success. Read the result JSON (below) to confirm what was replaced.

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

---

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

Written after every run (default `./import-result-<ISO>.json`):

```jsonc
{
  "outcome": "success", // success | preflight-failed | declined | dry-run | import-failed | circuit-breaker
  "exitCode": 0,
  "startedAt": "2026-06-05T09:00:00.000Z",
  "completedAt": "2026-06-05T09:02:11.000Z",
  "sourceFile": { "path": "./ZooNotify_DB.xlsx", "sha256": "…" }, // fingerprint for traceability
  "preflight": {
    "ok": true,
    "summary": {
      "collections": 12,
      "rowsByCollection": { "resistance": 9046 },
      "totalRows": 10110,
    },
    "errors": [],
    "warnings": [], // e.g. schema-drift endpoint unreachable (check #10)
  },
  "collections": [
    {
      "collection": "matrix",
      "deleted": { "en": 70, "de": 70 }, // rows truncated per locale
      "created": 70, // rows inserted
      "batches": [
        { "index": 0, "rows": 70, "outcome": "created", "attempts": 1, "durationMs": 34 },
      ],
    },
  ],
  "failures": [], // populated on import-failed / circuit-breaker
}
```

A wrapper script can branch on `outcome` / `exitCode`; the `sha256` proves which workbook produced
a given run.

---

## Troubleshooting

- **Exit 1, "Missing STRAPI_URL or STRAPI_TOKEN"** — copy `.env.example` to `.env` and fill it in.
- **Exit 1, "insecure http://"** — use an `https://` URL, or `--insecure` for local dev only.
- **Exit 2, check #2/#3 (missing sheet/column)** — the workbook isn't in the 3-sheet format. It
  must have exactly `masterdata`, `amr_resrate`, `prevalence` with the columns in
  [`source-xlsx-format.md`](../docs/import-cli-spec/source-xlsx-format.md).
- **Exit 2, check #7 (relation)** — a fact row references a name that isn't in `masterdata` (same
  locale). Add the name to `masterdata` or fix the typo.
- **Exit 2, check #8 (locale)** — a row is missing one of its `_en` / `_de` halves. Both locales
  are mandatory; duplicate the value if a term is genuinely untranslated.
- **Exit 2, check #10 (schema drift)** — the CMS gained a required field the importer doesn't
  provide. An unreachable schema endpoint downgrades to a _warning_, not a block.
- **Exit 4 / 5 (partial DB)** — restore the snapshot before re-running. Read `failures[]`; exit 5
  means the CMS kept failing batches (likely unhealthy).
- **Slow / timing out** — lower `--batch-size`, raise `--request-timeout`, watch `--verbose`.

See the [ops runbook](./docs/runbook.md) for step-by-step incident handling.

---

## For contributors

Hexagonal architecture ([ADR 0002]): the import logic is UI-agnostic and talks to Strapi only
through a port.

```
src/
  core/                     ImportCore — pure TypeScript, no CLI/HTTP/logger imports
    source-map.ts           the explicit per-field map: canonical attribute → source column(s)
    normalizer.ts           reads the 3 sheets → canonical in-memory model (refs + facts)
    fact-collections.ts     declarative attrs/types/relations of the 2 fact collections
    domain.ts               LocalizedRow / fact-row / FactImport types
    relation-map.ts         (collection, locale, name) → id map from bulk-create responses
    preflight.ts            two-layer pre-flight orchestrator
    preflight-checks.ts     the ten checks (structural on raw sheets, semantic on the model)
    throughput.ts           batching, concurrency, retry, circuit breaker
    orchestrator.ts         truncate-all → create-all phase ordering + relation stamping
    result.ts               the result-file schema
    strapi-client.ts        StrapiClient port (truncate / bulkCreate / fetchSchema)
  adapters/
    http-strapi-client.ts   native-fetch implementation of the port
  cli/                      commander entry point, wiring, pino logger
```

```bash
npm test          # vitest --run (unit suite)
npm run typecheck # tsc --noEmit
npm run lint      # eslint
npm run format    # prettier --write
```

A husky pre-commit hook runs `lint-staged` (ESLint + Prettier on staged files) and the full unit
suite before a commit is allowed.

### Integration test

`test/integration/` brings up real Postgres + the real Strapi CMS via docker-compose, provisions a
custom Import token, runs the CLI against a generated 3-sheet fixture, and asserts the resulting DB
state through the content-manager API.

```bash
npm run test:integration   # requires Docker; builds the CMS image, slow on first run
```

It is excluded from the default `npm test` and only runs when the runner sets `RUN_INTEGRATION=1`.

[ADR 0002]: ../docs/import-cli-spec/adr/0002-hexagonal-core-cli-as-adapter.md
[ADR 0004]: ../docs/import-cli-spec/adr/0004-per-collection-atomicity-no-rollback.md
[ADR 0006]: ../docs/import-cli-spec/adr/0006-cut-off-excluded-from-v1.md
