import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { OWNER, type RegistryEntry, applyRelease, latestRelease } from './propagate.ts';
import { proposeRelease } from './propose.ts';

const UPSTREAM = `https://github.com/${OWNER}/repository-tooling.git`;

const git = (args: string[], cwd?: string) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();

/** The newest stable release tag of the standard, read without any credentials. */
export function readLatestRelease(): string {
  const tags = git(['ls-remote', '--tags', '--refs', UPSTREAM])
    .split('\n')
    .map((line) => line.split('refs/tags/')[1] ?? '');
  const latest = latestRelease(tags);
  if (!latest) throw new Error('repository-tooling has no stable release tag.');
  return latest;
}

/** A template repository is regenerated from its example; every other repository is updated. */
export function repositoryEntry(name: string, isTemplate: boolean): RegistryEntry {
  return isTemplate
    ? {
        name,
        requiredStatus: 'Validate',
        kind: 'template',
        example: name.replace(/^template-/, ''),
      }
    : { name, requiredStatus: 'Validate', kind: 'consumer' };
}

async function vendoredRelease(root: string): Promise<string | null> {
  const file = path.join(root, '.lvbt/web-platform.json');
  if (!existsSync(file)) return null;
  return (JSON.parse(await readFile(file, 'utf8')) as { release: string | null }).release;
}

/**
 * Runs in a repository's own `Standard update` workflow with that repository's GITHUB_TOKEN: moves
 * the repository to the latest release through a self-merging pull request, and closes update pull
 * requests the repository no longer needs. No credential beyond the workflow's token is involved.
 */
export async function main(): Promise<void> {
  const root = process.cwd();
  const repository = process.env.GITHUB_REPOSITORY ?? `${OWNER}/${path.basename(root)}`;
  const name = repository.split('/')[1] ?? path.basename(root);
  const isTemplate =
    execFileSync('gh', ['api', `repos/${repository}`, '--jq', '.is_template'], {
      encoding: 'utf8',
    }).trim() === 'true';
  const entry = repositoryEntry(name, isTemplate);
  const tag = readLatestRelease();
  const tooling = path.resolve(import.meta.dirname, '..');

  const source = await mkdtemp(path.join(os.tmpdir(), 'lvbt-release-'));
  try {
    git(['clone', '--quiet', '--depth', '1', '--branch', tag, '--single-branch', UPSTREAM, source]);
    const current = await vendoredRelease(root);
    const result =
      current === tag
        ? { changed: false, from: current, skippedWorkflows: [] }
        : await applyRelease({ source, target: root, entry, tag, skipWorkflows: true });
    if (result.reason) {
      process.stdout.write(`${result.reason}\n`);
      return;
    }
    const outcome = await proposeRelease({
      source,
      tooling,
      target: root,
      entry,
      tag,
      changed: result.changed,
      from: result.from,
    });
    if (outcome) process.stdout.write(`${outcome}\n`);
    if (result.skippedWorkflows?.length) {
      process.stderr.write(
        `${tag} changes workflow files this workflow's token may not push. Copy them from the ${tag} example by hand:\n${result.skippedWorkflows.join('\n')}\n`,
      );
      process.exitCode = 1;
    }
  } finally {
    await rm(source, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
