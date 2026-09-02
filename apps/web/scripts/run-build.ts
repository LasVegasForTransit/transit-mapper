#!/usr/bin/env tsx
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { buildEnvironment, readGitBuildState } from './build-metadata';

const repositoryRoot = resolve(import.meta.dirname, '../../..');
// Forwarded so `pnpm build -- --force` reaches Turbo. Swallowing the flags
// makes one that changes what gets built look like it ran and did nothing,
// which is how a stale bundle survives a deliberate rebuild.
const forwarded = process.argv.slice(2);
// pnpm passes its own `--` separator through in argv, and to Turbo a bare `--`
// means "everything after this belongs to the task", which would hand `--force`
// to tsc instead. Drop it so the flags stay Turbo's.
if (forwarded[0] === '--') forwarded.shift();
const result = spawnSync('pnpm', ['exec', 'turbo', 'run', 'build', ...forwarded], {
  cwd: repositoryRoot,
  env: buildEnvironment(process.env, readGitBuildState(repositoryRoot)),
  stdio: 'inherit',
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
