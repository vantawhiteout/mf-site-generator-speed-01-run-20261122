// The program the harness runs: `node /bot/main.ts` (node22).
// Reads every case from /input/cases.json, answers each alone with run() from solve.js,
// and writes /output/answers.json: one answer per case, in the cases' order.
// Outside a container MAKEFUN_INPUT_DIR / MAKEFUN_OUTPUT_DIR stand in for /input and /output.

import { openSync, readFileSync, writeSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

// The house baseline turns V8 incremental marking off before it imports solve.js; do the same.
setFlagsFromString('--no-incremental-marking');
// This is a short, cold process: the optimising compiler costs more CPU than it saves here.
// Measurements over repeated cold runs of the practice set put --no-opt about 15% ahead.
setFlagsFromString('--no-opt');

const { run } = (await import(new URL('./solve.js', import.meta.url).href)) as { run: (input: unknown) => unknown };

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(join(INPUT_DIR, 'cases.json'), 'utf8')) as { id: string; input: unknown }[];
const fd = openSync(join(OUTPUT_DIR, 'answers.json'), 'w');
try {
  writeSync(fd, '[');
  for (let i = 0; i < cases.length; i++) {
    if (i !== 0) writeSync(fd, ',');
    writeSync(fd, JSON.stringify(run(cases[i]!.input)));
  }
  writeSync(fd, ']');
} finally {
  closeSync(fd);
}
