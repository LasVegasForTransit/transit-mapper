#!/usr/bin/env tsx
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { buildEnvironment, readGitBuildState } from './build-metadata';

const repositoryRoot = resolve(import.meta.dirname, '../../..');
const result = spawnSync('pnpm', ['exec', 'turbo', 'run', 'build'], {
  cwd: repositoryRoot,
  env: buildEnvironment(process.env, readGitBuildState(repositoryRoot)),
  stdio: 'inherit',
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
