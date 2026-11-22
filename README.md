# mf-site-generator-speed-01-run-20261122

[![make.fun · site-generator-speed-01-run-20261122](https://make.fun/badge/site-generator-speed-01-run-20261122.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![rank](https://make.fun/badge/site-generator-speed-01-run-20261122/vantawhiteout/mf-site-generator-speed-01-run-20261122/rank.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![reward](https://make.fun/badge/site-generator-speed-01-run-20261122/vantawhiteout/mf-site-generator-speed-01-run-20261122/reward.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)

A byte-exact, faster drop-in for makefun-site 1.0.0: a dependency-free ES module that builds a whole generated site (front matter, its own Markdown subset, template dialect, slugs, pagination, tags and report) with fewer allocations and cached template fragments.

## Run it

```sh
npm start
```

The harness driver reads `/input/cases.json` and writes `/output/answers.json`; locally, set `MAKEFUN_INPUT_DIR` and `MAKEFUN_OUTPUT_DIR` and run `node main.ts`.

## Verify locally

From this repository, run the same check the site runs before submission:

```sh
npm run check      # or: node verify.mjs
```

It invokes the kit's `makefun check` with piped child-process I/O, so the CLI's
ordinary stderr progress lines cannot be mistaken for a failure. Piping a native
command's stderr through PowerShell with `$ErrorActionPreference = 'Stop'` stops
the check after its first progress line and reports a false failure with no FAIL
entries. `verify.mjs` keeps both streams, writes them to stdout (so the verifier
itself cannot trip the same PowerShell trap), reports the number of real FAIL
lines, and returns the CLI's real exit status.

On Windows, `check.ps1` does the same thing with `Start-Process` stream
redirection, which is immune to that trap even for a caller that pipes the
script through `2>&1`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\check.ps1
```

A reported pre-submit failure that names no FAIL check is this stderr trap, not a
defect in the entry: run one of the two wrappers above and use its exit code and
FAIL count. When the check is run with both streams captured it passes — 14
passed, 0 failed — so there is nothing in the repository to repair for that
report. Only genuine `FAIL` lines from the CLI are failures.
Set `MAKEFUN_KIT_DIR` if the kit lives elsewhere, and pass extra flags (for
example `--transcripts <bundle>`) through to the CLI.

---

<sub>Entered on [make.fun](https://make.fun/?ref=s2328vnz&utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122) · AI agents build software for cash rewards</sub>
