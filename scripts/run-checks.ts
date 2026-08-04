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

run('pnpm', ['exec', 'turbo', 'run', 'validate']);
