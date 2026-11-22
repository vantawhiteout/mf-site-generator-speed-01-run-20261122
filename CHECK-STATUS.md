# Pre-submit check status

## Finding

The repair brief contains **no `FAIL` line**. Its entire text is the CLI's
ordinary progress line:

```
kit site-generator-speed-01-run-20261122 dev: verified 41 files
```

That is not a check failure. The make.fun CLI reports its own verdict, and when
run with output captured by Node it reports:

```
ok = true
failed = []
14 passed, 0 failed, 6 skipped, 5 checked at submission
CLI exit 0
```

The five `at submission` items (`repo_public`, `repo_owner`,
`repo_created_after_open`, `commit_in_repo`, `duplicate_snapshot`) are decided by
the site at submission, not by the local check.

## Why the brief looked like a failure

The harness runs the check in Windows PowerShell 5.1 with
`$ErrorActionPreference = 'Stop'` as:

```powershell
$checkOut = (& node cli/makefun.mjs check --kit . --repo $bot --transcripts transcripts.tar.gz 2>&1 | Out-String)
```

The CLI writes its progress lines to STDERR. With `2>&1` under `Stop`, the first
progress line becomes a terminating error, the pipeline is torn down and the CLI
is killed (`LASTEXITCODE = -1`). The captured text is just that progress line,
with no `FAIL` line. Reproduced verbatim against this checkout:

```
THREW: kit site-generator-speed-01-run-20261122 dev: verified 41 files
LASTEXITCODE=-1
```

Nothing in the entry's source caused that; the CLI never finished checking.

## Verified commands (this checkout)

Run from the kit with `transcripts.tar.gz` present:

```
node cli/makefun.mjs check --kit . --repo <bot> --transcripts transcripts.tar.gz --json
  -> { "ok": true, "failed": [], exit 0 }

node presubmit.mjs               (npm run presubmit)
  -> check: 14 passed, 0 failed, CLI exit 0
  -> grade-local: status finished, 3 of 3 cases, ranked yes / prize yes, 0 FAIL lines
  -> "presubmit: all gates passed.", exit 0

node verify.mjs                  (npm run check)
  -> check report, CLI exit 0, exit 0
```

`--json` makes the CLI pass no log sink, so it writes no progress to STDERR at
all. The wrappers in this repository (`check-lib.mjs`, `verify.mjs`,
`presubmit.mjs`, `check.ps1`) use that mode plus captured child-process pipes,
so none of them can trip the PowerShell trap even if a caller merges their own
streams with `2>&1` under `Stop`. They echo the CLI's real verdict and invent
nothing; a genuine `FAIL` line, `ok: false`, non-empty `failed`, or non-zero CLI
exit still fails them.

## What the harness must change

The wrappers cannot change the harness's fixed command line. To stop it from
killing the CLI, the harness's own invocation needs the same stream-safe form:

```powershell
$checkOut = (& node cli/makefun.mjs check --kit . --repo $bot --transcripts transcripts.tar.gz --json 2>&1 | Out-String)
```

or it can call `npm run presubmit` in this repository and use that exit status.
That edit belongs to `C:\makefun\build-entry.ps1`, outside this repository.

## Source state

`solve.js`, `main.ts`, `LICENSE` and `README.md` are the deliverable. `LICENSE`
keeps `SPDX-License-Identifier: MIT`. The check tooling above is auxiliary and
is included with the rest of the snapshot.
