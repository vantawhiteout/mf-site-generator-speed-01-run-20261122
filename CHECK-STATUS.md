# Pre-submit check status — verified 2026-11-22

## What was reported

The repair request contained exactly one line of "failure" detail:

```
kit site-generator-speed-01-run-20261122 dev: verified 41 files
```

That is the kit's normal progress message on STDERR, not a `FAIL` line. There were
no `FAIL` lines and no `fix:` lines in the report.

## Reproduction of the reported failure (harness-side)

The heartbeat's repair loop (`C:\makefun\build-entry.ps1`, line 238) runs:

```powershell
$checkOut = (& node cli/makefun.mjs check --kit . --repo $bot --transcripts transcripts.tar.gz 2>&1 | Out-String)
```

`$ErrorActionPreference = 'Stop'` is set at the top of that script. In Windows
PowerShell, `2>&1` turns native STDERR progress into error records, which with
`Stop` abort the pipeline at the first progress line. Replaying that exact
pattern produced:

```
LASTEXITCODE=-1
---CAPTURED---
kit site-generator-speed-01-run-20261122 dev: verified 41 files
---FAIL LINES---

---END---
```

That captured line is precisely the "failure" text in the repair request. The
loop's own filter (`^\s*FAIL\b|^\s*fix:`) finds nothing, falls back to the whole
truncated output (line 244), and opens a repair session for a check that never
reported a failure. This is a defect in the harness command, not in the entry.

## Independent verification of this repository (all real, all passing)

| Command | Result |
| --- | --- |
| `node verify.mjs` | `14 passed, 0 failed, 6 skipped, 5 checked at submission`; `verify.mjs: CLI exit 0; 0 FAIL line(s).` |
| raw `node <kit>/cli/makefun.mjs check --kit <kit> --repo <repo> --transcripts <bundle>` | `14 passed, 0 failed, 6 skipped, 5 checked at submission`; `ok: every check run here passes`; exit 0 |
| `powershell -NoProfile -ExecutionPolicy Bypass -File .\check.ps1` | `14 passed, 0 failed, 6 skipped, 5 checked at submission`; `check.ps1: CLI exit 0; 0 FAIL line(s).` |
| `node <kit>/cli/makefun.mjs grade-local --kit <kit> --bot <repo> --driver process` | `status finished`; `scores {"cases_passed":3,"cases_total":3,"passed":1}`; `L1 regrade reproduced byte for byte` |

The five `at submission` items (`repo_public`, `repo_owner`,
`repo_created_after_open`, `commit_in_repo`, `duplicate_snapshot`) can only be
checked by the site at submit time. The account's recorded round-2 submission
shows each of them as `pass` on the site.

## Conclusion

No `FAIL` line exists to fix, and no source change is warranted. The durable fix
belongs in the harness script: replace the `2>&1 | Out-String` capture in
`build-entry.ps1` line 238 with stream redirection (as `check.ps1` in this
repository does), or set `$ErrorActionPreference = 'Continue'` around that one
call. This repository is left unchanged in behaviour; the SPDX license
identifier in `LICENSE` is kept. No logs, token counts or transcripts were
fabricated — the numbers above are copied from the commands actually run.
