import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { githubGovernanceDoctor } from './github-governance.js';
import { githubReader } from './github-read.js';
const [root, repository] = process.argv.slice(2);
if (!root) throw new Error('Pass the checked repository root.');
const name = z
  .string()
  .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/)
  .parse(repository);
const ruleset: unknown = JSON.parse(
  await readFile(path.join(root, '.lvbt/web-platform/standards/ruleset.json'), 'utf8'),
);
const checks = await githubGovernanceDoctor({ repository: name, ruleset }, githubReader(root));
process.stdout.write(`${JSON.stringify(checks)}\n`);
