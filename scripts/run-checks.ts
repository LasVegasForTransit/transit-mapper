#!/usr/bin/env tsx
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const fix = args.length === 1 && args[0] === '--fix';

if (args.length > 0 && !fix) {
  console.error('usage: pnpm check [--fix]');
  process.exit(2);
}

function run(command: string, commandArgs: readonly string[]): void {
  const result = spawnSync(command, commandArgs, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// Repair tasks mutate files and must finish before the read-only validation
// graph starts. Everything after this handoff is scheduled natively by Turbo.
if (fix) {
  run('pnpm', ['format']);
  run('pnpm', ['lint:fix']);
}

// Turbo runs 10 tasks at once by default. Six of the tasks in this graph are
// Vitest suites that each fork a worker per core, and one of them boots
// workerd, so the default fans out to dozens of processes. On CI's four-core
// runner that starved whichever suite lost the race, which surfaced as
// `@transitmapper/web#verify` or `@transitmapper/worker#verify` failing at
// random rather than as an out-of-memory message.
run('pnpm', ['exec', 'turbo', 'run', 'validate', '--concurrency=4']);
