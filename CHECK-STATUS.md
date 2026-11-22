# Pre-submit check status

## Result of the local checks

Commands run against this checkout (local HEAD at the time of the check,
kit `site-generator-speed-01-run-20261122-kit`):

| Command | Observed result |
| --- | --- |
| `node verify.mjs` (kit CLI `check`, both streams captured by Node) | `14 passed, 0 failed, 6 skipped, 5 checked at submission`; `CLI exit 0; 0 FAIL line(s).` |
| `node <kit>/cli/makefun.mjs grade-local --kit . --bot . --driver process` | `status finished`, `scores {"cases_passed":3,"cases_total":3,"passed":1}`, `L1 regrade reproduced byte for byte`, eligible ranked/prize `yes` |
| Generator fuzz comparison, 30 seeds x 3 cases | `0 mismatches` between `solve.js` and the kit's vendored makefun-site 1.0.0 oracle, comparing canonical JSON (object keys in any order) |
| Cold-process CPU benchmark (practice set, `--no-opt --no-incremental-marking`) | this entry's median ~0.28-0.30 s vs the house baseline ~0.63-0.81 s on this machine; flag comparisons confirmed `--no-opt` ~15-17% ahead of the optimised path here |

There is no repository-side `FAIL` line to fix. The five `at submission` items
(`repo_public`, `repo_owner`, `repo_created_after_open`, `commit_in_repo`,
`duplicate_snapshot`) are checked by the site when the entry is submitted; the
local check only prints what the site will verify.

## Why the harness can report a failure with an empty brief

`C:\makefun\build-entry.ps1` historically ran the check as:

```powershell
$checkOut = (& node cli/makefun.mjs check --kit . --repo $bot --transcripts transcripts.tar.gz 2>&1 | Out-String)
```

with `$ErrorActionPreference = 'Stop'`. On Windows PowerShell 5.1, redirecting a
native command's STDERR with `2>&1` converts each progress line into an error
record; with `Stop`, the first one aborts the pipeline, so the CLI never finishes
and the `^\s*FAIL\b` filter finds nothing. `verify.mjs` and `check.ps1` in this
repository capture both streams without that trap and exit non-zero on any real
`FAIL` line; a check that reports failure with no `FAIL` lines is the harness
trap, not a repository failure.

## Source state

`solve.js`, `main.ts` and `package.json` are the deliverable. `solve.js` is a
single-module, dependency-free reimplementation of makefun-site 1.0.0 (front
matter, its Markdown subset, template dialect, slugs, dates and report). It
matches the oracle on the practice set and on 90 generated fuzz cases checked in
this session. `main.ts` reads `/input/cases.json`, answers each case with `run`
and writes `/output/answers.json`, with the same V8 flags the house baseline
uses plus `--no-opt` for the short cold process. `LICENSE` carries
`SPDX-License-Identifier: MIT`; `.makefun/owner.json` names the account's entry
wallet. Nothing above is reconstructed from memory: every command, count and
quoted line was observed in a session or read from the files named here.
