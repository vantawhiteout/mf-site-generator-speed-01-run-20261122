#!/usr/bin/env node
// Shared, stream-safe runner for the make.fun pre-submit check.
//
// The kit CLI writes its ordinary progress lines ("kit ... verified N files",
// "repository ...", "transcripts ...") to STDERR. Windows PowerShell 5.1 turns
// native STDERR merged with `2>&1` into ErrorRecords; with
// $ErrorActionPreference = 'Stop' the first one aborts the pipeline, the CLI is
// killed (LASTEXITCODE -1) and the caller sees only that progress line. That
// looks like a check failure while the CLI itself reported no FAIL line.
//
// `check --json` moves those progress lines out of STDERR entirely (the CLI
// passes no log sink when JSON is requested). Combining that with captured
// child-process pipes means none of these wrappers can trip the trap, even if a
// caller captures their own STDERR with `2>&1` under Stop.
//
// Everything printed here is derived from the CLI's own JSON output; nothing is
// invented, and a real FAIL line or a non-zero CLI exit is still a failure.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repo = dirname(fileURLToPath(import.meta.url));
const kitName = 'site-generator-speed-01-run-20261122-kit';

export function findKit() {
  const candidates = [join(repo, '..', kitName), join(repo, '..', '..', kitName)];
  return (
    process.env.MAKEFUN_KIT_DIR ??
    candidates.find((dir) => existsSync(join(dir, 'cli', 'makefun.mjs'))) ??
    candidates[0]
  );
}

export function findCli() {
  const kit = findKit();
  const cli = join(kit, 'cli', 'makefun.mjs');
  return { kit, cli, ok: existsSync(cli) };
}

/** Run `check --json` with both streams captured; never write to our STDERR. */
export function runCheck(extraArgs = []) {
  const { kit, cli, ok } = findCli();
  if (!ok) {
    return {
      ok: false,
      status: 2,
      report: [`makefun CLI not found at ${cli}; set MAKEFUN_KIT_DIR to the unpacked kit directory.`],
      json: null,
    };
  }

  const args = [cli, 'check', '--kit', '.', '--repo', repo];
  if (!extraArgs.includes('--transcripts') && existsSync(join(kit, 'transcripts.tar.gz'))) {
    args.push('--transcripts', 'transcripts.tar.gz');
  }
  if (!extraArgs.includes('--json')) args.push('--json');
  args.push(...extraArgs);

  const result = spawnSync(process.execPath, args, {
    cwd: kit,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) {
    return {
      ok: false,
      status: 2,
      report: [result.error?.stack ?? String(result.error)],
      json: null,
    };
  }

  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  let report;
  let json = null;
  try {
    json = JSON.parse(stdout);
    report = formatCheckReport(json, result.status);
  } catch {
    // Keep the CLI's real words if a different CLI version has no --json.
    report = [
      'check --json output was not JSON; echoing the CLI output verbatim:',
      ...stdout.split(/\r?\n/),
      ...stderr.split(/\r?\n/),
    ];
  }
  // A FAIL is a failure even if a wrapper returns 0; so is a non-zero exit.
  const failed = json
    ? (json.failed?.length ?? 0) > 0 ||
      (json.checks ?? []).some((c) => c.status === 'fail') ||
      json.ok === false
    : true;
  return {
    ok: result.status === 0 && !failed,
    status: result.status ?? 1,
    report,
    json,
  };
}

/** Render the CLI's JSON checks in the same shape as its plain-text check. */
export function formatCheckReport(json, status) {
  const lines = [];
  for (const check of json.checks ?? []) {
    const tag = check.status === 'submission' ? 'at submission' : check.status;
    lines.push(`${tag.padEnd(14)}${String(check.check).padEnd(24)}${check.reason ?? ''}`);
    if (check.fix) lines.push(`${''.padEnd(14)}${''.padEnd(24)}to pass: ${check.fix}`);
  }
  for (const note of json.notes ?? []) lines.push(`note: ${note}`);

  const count = (s) => (json.checks ?? []).filter((c) => c.status === s).length;
  lines.push('');
  lines.push(
    `${count('pass')} passed, ${count('fail')} failed, ${count('skip')} skipped, ${count('submission')} checked at submission`,
  );
  lines.push(`check --json: CLI exit ${status}; ${json.ok === true ? 'ok' : 'not ok'}.`);
  return lines;
}

/** Run a CLI subcommand whose plain-text output has no safe JSON mode here. */
export function runCli(args) {
  const { kit, cli, ok } = findCli();
  if (!ok) {
    return {
      ok: false,
      status: 2,
      output: `makefun CLI not found at ${cli}; set MAKEFUN_KIT_DIR to the unpacked kit directory.\n`,
    };
  }
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: kit,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) {
    return { ok: false, status: 2, output: `${result.error?.stack ?? String(result.error)}\n` };
  }
  // Echo both real streams on STDOUT: a caller piping us through `2>&1` cannot
  // trip the PowerShell trap one level up.
  return {
    ok: result.status === 0,
    status: result.status ?? 1,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}
