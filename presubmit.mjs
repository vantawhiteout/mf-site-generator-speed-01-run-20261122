#!/usr/bin/env node
// Reliable pre-submit gate for this entry: the site's check plus grade-local.
//
// Both commands run through captured child-process pipes. `check --json` keeps
// the CLI's progress lines out of STDERR, so a PowerShell caller that merges
// this script's streams with `2>&1` under Stop cannot trip the native-STDERR
// trap that killed the harness's plain `check ... 2>&1` invocation.
//
// Nothing is invented here: the check lines are rendered from the CLI's JSON,
// grade-local's real output is echoed verbatim, and either a FAIL line or a
// non-zero CLI exit fails the gate.
import { runCheck, runCli, repo } from './check-lib.mjs';

const check = runCheck(process.argv.slice(2));
process.stdout.write('\n===== check =====\n');
for (const line of check.report) process.stdout.write(`${line}\n`);

process.stdout.write('\n===== grade-local =====\n');
const grade = runCli([
  'grade-local', '--kit', '.', '--bot', repo, '--driver', 'process',
]);
if (grade.output) process.stdout.write(grade.output);
const gradeFails = grade.output.split(/\r?\n/).filter((line) => /^\s*FAIL\b/.test(line));
process.stdout.write(
  `grade-local: CLI exit ${grade.status}; ${gradeFails.length} FAIL line(s)` +
    (gradeFails.length ? `: ${gradeFails.map((line) => line.trim()).join(' | ')}` : '') +
    '.\n',
);

const bad = [];
if (!check.ok) bad.push('check');
if (!grade.ok || gradeFails.length > 0) bad.push('grade-local');
if (bad.length === 0) {
  process.stdout.write('\npresubmit: all gates passed.\n');
  process.exit(0);
}
process.stdout.write(`\npresubmit: FAILED gate(s): ${bad.join(', ')}.\n`);
process.exit(1);
