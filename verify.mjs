#!/usr/bin/env node
// Reproduce the make.fun pre-submit check with reliable output capture.
//
// This uses `check --json` through child-process pipes. The CLI's ordinary
// progress lines then never reach STDERR, so a Windows PowerShell caller that
// merges our streams with `2>&1` under $ErrorActionPreference = 'Stop' cannot
// abort on them. See check-lib.mjs for the failure mechanism this avoids.
//
// Everything echoed comes from the CLI's own JSON verdict; a real FAIL line or
// a non-zero exit still makes this script fail.
import { runCheck } from './check-lib.mjs';

const result = runCheck(process.argv.slice(2));
for (const line of result.report) process.stdout.write(`${line}\n`);
process.exit(result.ok ? 0 : 1);
