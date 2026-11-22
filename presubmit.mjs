#!/usr/bin/env node
// Reliable pre-submit gate for this entry.
//
// Why this exists: the makefun CLI writes its ordinary progress ("kit ...
// verified N files", "repository ...", "transcripts ...") to stderr. Windows
// PowerShell 5.1 turns native stderr merged with `2>&1` into ErrorRecords; with
// $ErrorActionPreference = 'Stop' the FIRST progress line aborts the pipeline,
// so the harness sees a "check failed" with no FAIL lines and an empty brief.
// Running the CLI through child-process pipes keeps both streams intact and
// preserves its real exit status, so the verdict below is the one the site uses.
//
// This script never invents output: it echoes exactly what the CLI printed and
// fails only on a genuine FAIL line or a non-zero CLI exit status.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = dirname(fileURLToPath(import.meta.url));
const kitName = 'site-generator-speed-01-run-20261122-kit';
const candidates = [join(repo, '..', kitName), join(repo, '..', '..', kitName)];
const kit =
  process.env.MAKEFUN_KIT_DIR ??
  candidates.find((dir) => existsSync(join(dir, 'cli', 'makefun.mjs'))) ??
  candidates[0];
const cli = join(kit, 'cli', 'makefun.mjs');
if (!existsSync(cli)) {
  process.stdout.write(`makefun CLI not found at ${cli}; set MAKEFUN_KIT_DIR to the unpacked kit directory.\n`);
  process.exit(2);
}

const extra = process.argv.slice(2);
const transcriptArgs = existsSync(join(kit, 'transcripts.tar.gz'))
  ? ['--transcripts', 'transcripts.tar.gz']
  : [];

// The site's checks, with the transcripts that will actually be uploaded.
function run(label, args) {
  process.stdout.write(`\n===== ${label} =====\n`);
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: kit,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) {
    process.stdout.write(`${result.error?.stack ?? String(result.error)}\n`);
    return { label, ok: false, fails: 1 };
  }
  // Both streams go to stdout: a caller piping this through PowerShell's
  // `2>&1` cannot trip the very stderr trap this script avoids.
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stdout.write(result.stderr);
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const fails = output.split(/\r?\n/).filter((line) => /^\s*FAIL\b/.test(line));
  const status = result.status ?? 1;
  process.stdout.write(`${label}: CLI exit ${status}; ${fails.length} FAIL line(s)`);
  if (fails.length) {
    process.stdout.write(`: ${fails.map((line) => line.trim()).join(' | ')}`);
  }
  process.stdout.write('.\n');
  return { label, ok: status === 0 && fails.length === 0, fails: fails.length };
}

const check = run('check', [
  'check', '--kit', '.', '--repo', repo, ...transcriptArgs, ...extra,
]);
const grade = run('grade-local', [
  'grade-local', '--kit', '.', '--bot', repo, '--driver', 'process',
]);

const results = [check, grade];
const bad = results.filter((r) => !r.ok);
if (bad.length === 0) {
  process.stdout.write('\npresubmit: all gates passed.\n');
  process.exit(0);
}
process.stdout.write(`\npresubmit: FAILED gate(s): ${bad.map((r) => r.label).join(', ')}.\n`);
process.exit(1);
