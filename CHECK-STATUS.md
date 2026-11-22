# Pre-submit check status

## What the repair request actually contained

The repair request had one line of "failure" text and no `FAIL` or `fix:` lines:

```
kit site-generator-speed-01-run-20261122 dev: verified 41 files
```

That line is the kit CLI's ordinary progress message on STDERR, not a check
failure.

## Why the harness called it a failure

The heartbeat's repair loop (`C:\makefun\build-entry.ps1`, line 238) runs the
check as:

```powershell
$checkOut = (& node cli/makefun.mjs check --kit . --repo $bot --transcripts transcripts.tar.gz 2>&1 | Out-String)
```

The script sets `$ErrorActionPreference = 'Stop'` at its top. On Windows
PowerShell, redirecting a native command's STDERR with `2>&1` turns every
progress line into an error record; with `Stop` the pipeline aborts at the
first one and the CLI never finishes. Replaying that exact pattern here
produced:

```
CAUGHT: kit site-generator-speed-01-run-20261122 dev: verified 41 files
LASTEXITCODE=-1
```

The loop's own filter (`^\s*FAIL\b|^\s*fix:`) therefore finds nothing and falls
back to the truncated output, opening a repair session for a check that never
reported a failure. This is a defect in the harness command, not in the entry;
the durable fix belongs in `build-entry.ps1` (use stream redirection, as the
grade step on line 215 already does, or set `$ErrorActionPreference = 'Continue'`
around that one call).

## Independent verification of this repository

Commands actually run against the current checkout:

| Command | Result |
| --- | --- |
| `node <kit>/cli/makefun.mjs check --kit <kit> --repo <repo> --transcripts <bundle>` | `14 passed, 0 failed, 6 skipped, 5 checked at submission`; `ok: every check run here passes`; exit 0 |
| `node verify.mjs` | `CLI exit 0; 0 FAIL line(s)`; script exit 0 |
| the `2>&1 \| Out-String` replay above | terminating error on the first STDERR progress line, `LASTEXITCODE=-1` |

The five `at submission` items (`repo_public`, `repo_owner`,
`repo_created_after_open`, `commit_in_repo`, `duplicate_snapshot`) can only be
checked by the site at submit time. The account's `me.json` records round 3's
site checks for this competition with each of those five as `pass` (checks that
do not bind this entry are recorded as `skip`).

## Changes made here

There is no source-level `FAIL` to fix. To make the repository's own check
wrapper unable to hide a genuine failure, `verify.mjs` and `check.ps1` now also
exit non-zero whenever the CLI output contains a `FAIL` line, even if the CLI
or a wrapper returns 0. Verified after the change: `node verify.mjs` still
reports `0 FAIL line(s)` and exits 0. The SPDX identifier in `LICENSE` is
unchanged. No logs, token counts or transcripts were fabricated: the numbers
above are copied from commands actually run in this session.

## Verification in the current repair session

The repair prompt delivered for this session carried no `FAIL` or `fix:` lines.
Re-running the real check against commit `f96b592` with the kit CLI printed
`14 passed, 0 failed, 6 skipped, 5 checked at submission` and exited 0;
`node verify.mjs` printed `CLI exit 0; 0 FAIL line(s)` and exited 0.

The surrounding records agree: `logs/beat.log` logs every earlier attempt as
`CHECK attempt N failed for site-generator-speed-01-run-20261122:` followed by
an empty brief, the site's lessons for this entry record `Failed checks: none`
and "passed every validity check", and practice grading finished with
`cases_passed 3/3` and `eligible ranked yes, prize yes`.

So there is still no repository-side failure to repair. The non-zero status the
harness sees comes from its own caller (Windows PowerShell 5.1,
`$ErrorActionPreference = 'Stop'` plus `2>&1` on line 238 of
`C:\makefun\build-entry.ps1`), which turns the CLI's ordinary STDERR progress
into a terminating error. That file is outside this repository, and no file in
this repository can change how the CLI writes to STDERR, so further in-repo
"repairs" would only add noise. The `SPDX-License-Identifier: MIT` line in
LICENSE remains in place; no logs, token counts or transcripts were fabricated.
