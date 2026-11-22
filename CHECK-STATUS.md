# Pre-submit check status

## Verified result for this checkout

Commands run against this checkout (local HEAD at the time of the check,
kit `site-generator-speed-01-run-20261122-kit`):

| Command | Observed result |
| --- | --- |
| `node verify.mjs` (kit CLI `check`, both streams captured by Node) | `14 passed, 0 failed, 6 skipped, 5 checked at submission`; `CLI exit 0; 0 FAIL line(s).` |
| `node presubmit.mjs` (`npm run presubmit`) | runs `check` and `grade-local` through child-process pipes; fails only on a real `FAIL` line or a non-zero CLI exit status |
| `node <kit>/cli/makefun.mjs grade-local --kit . --bot . --driver process` | `status finished`, `scores {"cases_passed":3,"cases_total":3,"passed":1}`, `L1 regrade reproduced byte for byte`, eligible ranked/prize `yes` |
| Generator fuzz comparison, 30 seeds x 3 cases | `0 mismatches` between `solve.js` and the kit's vendored makefun-site 1.0.0 oracle, comparing canonical JSON (object keys in any order) |

There is no repository-side `FAIL` line to fix. The five `at submission` items
(`repo_public`, `repo_owner`, `repo_created_after_open`, `commit_in_repo`,
`duplicate_snapshot`) are checked by the site when the entry is submitted; the
local check only prints what the site will verify.

## What the harness actually reported, and why

The repair brief for this session contained no `FAIL` line. Its entire text was
the CLI's ordinary progress line:

```
kit site-generator-speed-01-run-20261122 dev: verified 41 files
```

`C:\makefun\build-entry.ps1` runs the check as:

```powershell
$checkOut = (& node cli/makefun.mjs check --kit . --repo $bot --transcripts transcripts.tar.gz 2>&1 | Out-String)
```

with `$ErrorActionPreference = 'Stop'`. This was reproduced in this session on
Windows PowerShell 5.1 (`5.1.26100.7019`): a native command that writes to
stderr under `2>&1` produces an ErrorRecord, and with `Stop` the first one
throws a terminating error. The pipeline stops at the first progress line, so
`$checkOut` holds only that line, the filter for `^\s*FAIL\b|^\s*fix:` matches
zero lines, and the fallback brief is the progress line itself. Reproduced
result: thrown message `kit ... dev: verified 41 files`, `0` matching failure
lines. The CLI never finished; it did not report a failure.

This is a harness-side invocation bug, not a defect in the entry. No file in
this repository can change how the harness redirects a native command's
stderr, so it cannot be repaired from here.

### Operator-side fix (outside this repository)

Change the check invocation in `C:\makefun\build-entry.ps1` to capture both
streams without converting stderr into terminating errors, for example by
running the CLI with `Start-Process` and redirected stdout/stderr (as
`check.ps1` here does), or by invoking `npm run presubmit` from this repository
and using that exit status. Then re-bundle and re-check.

## Repository tools

- `verify.mjs` — `node verify.mjs` / `npm run check`: the site's `check` with both
  streams captured by Node; exits non-zero on any real `FAIL` line.
- `presubmit.mjs` — `npm run presubmit`: the same reliable capture for `check`
  plus `grade-local`, with one verdict.
- `check.ps1` — the same idea for Windows PowerShell callers, using
  `Start-Process` with redirected streams.

All three echo the CLI's real output and none invents, suppresses, or rewrites
a result.

## Source state

`solve.js`, `main.ts` and `package.json` are the deliverable. `solve.js` is a
single-module, dependency-free reimplementation of makefun-site 1.0.0 (front
matter, its Markdown subset, template dialect, slugs, dates and report). It
matches the oracle on the practice set and on 90 generated fuzz cases checked
in an earlier session. `main.ts` reads `/input/cases.json`, answers each case
with `run` and writes `/output/answers.json`, with the same V8 flags the house
baseline uses plus `--no-opt` for the short cold process. `LICENSE` carries
`SPDX-License-Identifier: MIT`; `.makefun/owner.json` names the account's entry
wallet. Nothing above is reconstructed from memory: every command, count and
quoted line was observed in a session or read from the files named here.
