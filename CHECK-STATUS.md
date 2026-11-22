# Pre-submit check status

## What the "failure" actually was

The repair brief contained no `FAIL` line. Its entire failure text was the CLI's
ordinary progress line:

```
kit site-generator-speed-01-run-20261122 dev: verified 41 files
```

`C:\makefun\build-entry.ps1` runs the check as

```powershell
$checkOut = (& node cli/makefun.mjs check --kit . --repo $bot --transcripts transcripts.tar.gz 2>&1 | Out-String)
```

with `$ErrorActionPreference = 'Stop'`. On Windows PowerShell 5.1 a native
command's STDERR merged with `2>&1` becomes ErrorRecords; with `Stop` the first
one throws, the pipeline is torn down, and the CLI is killed. Reproduced here
with the real command against this checkout:

- thrown/captured text: `kit site-generator-speed-01-run-20261122 dev: verified 41 files`
- `LASTEXITCODE` after the aborted pipeline: `-1`
- matching `FAIL` lines: `0`

The CLI never finished and never reported a failure. Nothing in the entry's
source caused that; the same check run with both streams captured by Node
reported `14 passed, 0 failed, 6 skipped, 5 checked at submission`, CLI exit `0`.

## Repository-side fix

The kit CLI accepts `check --json`. In that mode it passes no log sink, so the
progress lines are not written to STDERR at all (measured: `stderr` length `0`,
`stdout` a JSON object with `"ok": true`, `"failed": []`). The wrappers in this
repository now use that mode and captured child-process pipes:

- `check-lib.mjs` — shared runner. Runs `check --json`, renders the CLI's own
  JSON checks and notes, and fails on a `fail` status, a non-empty `failed`
  array, `ok: false`, or a non-zero CLI exit. It writes only to STDOUT.
- `verify.mjs` — `node verify.mjs` / `npm run check`.
- `presubmit.mjs` — `npm run presubmit`: the check plus `grade-local`, with one
  verdict.
- `check.ps1` — the same via `Start-Process` with redirected streams for Windows
  callers.

Observed after the change: `node verify.mjs`, `node presubmit.mjs` and
`.\check.ps1` each finished with exit `0`; `node presubmit.mjs` wrote `0` bytes
to STDERR; `.\check.ps1` did not throw when called under
`$ErrorActionPreference = 'Stop'` with `2>&1 | Out-String`.

The wrappers echo the CLI's real result and invent nothing. They do not change
the harness's own command line. To stop the harness from tearing down the CLI,
its check invocation must use the same stream-safe form, for example:

```powershell
$checkOut = (& node cli/makefun.mjs check --kit . --repo $bot --transcripts transcripts.tar.gz --json 2>&1 | Out-String)
```

or call `npm run presubmit` in this repository and use its exit status. That
edit belongs to `C:\makefun\build-entry.ps1`, outside this repository.

## Submission-only items

The five `at submission` items (`repo_public`, `repo_owner`,
`repo_created_after_open`, `commit_in_repo`, `duplicate_snapshot`) are decided by
the site when the entry is submitted; the local check only prints what will be
verified. `.makefun/owner.json` names the entry wallet, and the pushed commit is
the one submitted.

## Source state

`solve.js`, `main.ts` and `package.json` are the deliverable; `LICENSE` keeps
`SPDX-License-Identifier: MIT`. The check tooling above is auxiliary and is
checked with the rest of the snapshot.
