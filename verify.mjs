#!/usr/bin/env node
// Reproduce the make.fun pre-submit check with reliable output capture.
//
// The kit CLI prints its progress ("kit ... verified N files", "repository ...")
// to stderr. Piping a native command's stderr through PowerShell while
// $ErrorActionPreference = 'Stop' turns those ordinary lines into terminating
// errors: the pipeline stops after the first one, the CLI never finishes, and
// the truncated output contains no FAIL lines. That looks like a check failure
// when there is none. Using child-process pipes here keeps both streams intact
// and preserves the CLI's real exit status.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = dirname(fileURLToPath(import.meta.url));
const kitName = 'site-generator-speed-01-run-20261122-kit';
const candidates = [join(repo, '..', kitName), join(repo, '..', '..', kitName)];
const kit = process.env.MAKEFUN_KIT_DIR ?? candidates.find((dir) => existsSync(join(dir, 'cli', 'makefun.mjs'))) ?? candidates[0];
const cli = join(kit, 'cli', 'makefun.mjs');
if (!existsSync(cli)) {
  console.error(`makefun CLI not found at ${cli}; set MAKEFUN_KIT_DIR to the unpacked kit directory.`);
  process.exit(2);
}

const extra = process.argv.slice(2);
const args = [cli, 'check', '--kit', '.', '--repo', repo];
if (!extra.includes('--transcripts') && existsSync(join(kit, 'transcripts.tar.gz'))) {
  args.push('--transcripts', 'transcripts.tar.gz');
}
args.push(...extra);

const result = spawnSync(process.execPath, args, {
  cwd: kit,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});
if (result.error) {
  console.error(result.error);
  process.exit(2);
}
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status ?? 1);
