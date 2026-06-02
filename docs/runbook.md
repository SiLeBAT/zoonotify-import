# Zoonotify Import — Operations Runbook

Audience: the **data steward** who runs the import and the **on-call engineer** who is paged if it
breaks. This is the "what do I do now" companion to the [README](../README.md). It assumes you can
run the CLI and reach the database snapshot tooling; it does not assume you can read TypeScript.

> **Golden rule:** the import deletes and recreates whole collections and has **no automatic
> rollback**. Always take a database snapshot immediately before a production run. If anything goes
> wrong, restoring that snapshot is your safety net.

---

## 1. Running an import (normal path)

1. **Get the workbook.** Confirm it is the intended `ZooNotify_DB.xlsx` and note where it came from.
2. **Dry-run first:**
   ```bash
   npm start -- --dry-run /path/to/ZooNotify_DB.xlsx
   ```

   - Exit `0` → pre-flight passed. Continue.
   - Exit `2` → open the result file, fix **every** entry under `preflight.errors`, get a clean
     dry-run, then continue. (Warnings, e.g. missing German translations, do **not** block.)
3. **Take a database snapshot.** Record the snapshot ID/time. Do not skip this.
4. **Run the import:**
   ```bash
   npm start -- /path/to/ZooNotify_DB.xlsx        # add --yes in automation
   ```
5. **Check the exit code and result file** (see §2 and §3).

---

## 2. Verifying a successful import

A run succeeded when **all** of these hold:

- The CLI exited `0`.
- The result file has `"outcome": "success"` and `"exitCode": 0`.
- `"failures"` is an empty array `[]`.
- Each entry in `"collections"` has `created` > 0 where you expect data (an intentionally empty
  sheet will show `created: 0`), and every batch shows `"outcome": "created"`.
- The `sourceFile.sha256` matches the workbook you intended to import (proves no file mix-up).

Spot-check in the CMS admin: open one reference collection (e.g. `matrix`) and one fact collection
(e.g. `resistance`) and confirm row counts look sane and both English and German records exist
(except `matrix-detail`, which is intentionally single-locale).

---

## 3. When the import fails partway

Find the **exit code** (printed to the terminal and stored as `exitCode` in the result file) and
follow the matching row.

| Exit | What happened                                                       | Database state | Do this                                                                                                    |
| ---- | ------------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------- |
| `1`  | Bad invocation: missing `.env`, bad flag, or an `http://` URL.      | Untouched.     | Fix the command/`.env` and re-run. No snapshot restore needed.                                             |
| `2`  | Pre-flight found errors.                                            | Untouched.     | Fix every `preflight.errors` entry; re-run dry-run, then import. No restore needed.                        |
| `3`  | You answered "no" at the confirmation prompt.                       | Untouched.     | Re-run when ready. No restore needed.                                                                      |
| `4`  | An error hit mid-import (e.g. a malformed row the server rejected). | **Partial.**   | **Restore the snapshot.** Read `failures[]` to see which collection/batch broke, fix the workbook, re-run. |
| `5`  | The circuit breaker tripped: several batches failed in a row.       | **Partial.**   | **Restore the snapshot.** This usually means the CMS/DB is unhealthy, not the data — see §4.               |

For exit `4`/`5`:

1. **Restore the snapshot** you took in §1 step 3. The CMS is in a half-replaced state until you do.
2. Open the result file's `failures[]`. Each record names the `collection`, `batchIndex`, and the
   server's error `message`.
3. If the messages are about **data** (validation, a bad value, a missing relation), it's a
   workbook problem — fix and re-run.
4. If the messages are about **availability** (timeouts, `503`, connection resets) — that's exit
   `5` territory — go to §4.

---

## 4. When to call an engineer

Call / page the on-call engineer if **any** of these are true:

- Exit `5` (circuit breaker) — the CMS or its database is likely unhealthy. Don't keep retrying.
- Exit `4` whose `failures[]` messages you don't understand or that aren't obviously a workbook fix.
- The snapshot restore did **not** return the CMS to a healthy, complete state.
- Pre-flight reports a **schema-drift (check #10)** error you can't explain — the CMS data model
  may have changed and the workbook/exporter needs a coordinated update.
- Two consecutive runs of an _unchanged, dry-run-clean_ workbook both fail mid-import.

What to hand the engineer:

- The **result file** (it contains the outcome, exit code, source-file `sha256`, and `failures[]`).
- The **exact command** you ran and the **snapshot ID** you restored.
- Whether the CMS admin panel is reachable and whether other CMS features work.

---

## 5. Quick reference

```bash
# Validate only, never touches the DB:
npm start -- --dry-run ./ZooNotify_DB.xlsx

# Real run, no prompt, custom result path, per-batch timing:
npm start -- --yes --report ./results/run.json --verbose ./ZooNotify_DB.xlsx

# Gentler on a struggling CMS:
npm start -- --batch-size 50 --concurrency 1 --request-timeout 60 ./ZooNotify_DB.xlsx
```

Result-file outcomes: `success` · `dry-run` · `preflight-failed` · `declined` · `import-failed` ·
`circuit-breaker`. Exit codes and their meaning are in §3 and the [README](../README.md).
