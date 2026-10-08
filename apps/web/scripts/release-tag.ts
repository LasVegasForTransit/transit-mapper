import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { GitBuildState } from './build-metadata';

export function exactReleaseTag(version: string, commit: string, records: string): string | null {
  const tag = `v${version}`;
  const values = records
    .trim()
    .split('\n')
    .map((line) => line.split(/\s+/u));
  const peeled = values.filter((value) => value[1] === `refs/tags/${tag}^{}`);
  const selected = peeled.length
    ? peeled
    : values.filter((value) => value[1] === `refs/tags/${tag}`);
  return selected.length === 1 && selected[0]?.[0] === commit ? tag : null;
}
export function readSourceReleaseTag(
  root: string,
  environment: NodeJS.ProcessEnv,
  git: GitBuildState | null,
): string | undefined {
  if (environment.TRANSITMAPPER_RELEASE_TAG) return environment.TRANSITMAPPER_RELEASE_TAG;
  if (environment.GITHUB_ACTIONS !== 'true' || !git || git.dirty) return;
  const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
    version: string;
    repository: { url: string };
  };
  const repository = manifest.repository.url.replace(/^git\+/u, '').replace(/\.git$/u, '');
  if (repository !== 'https://github.com/LasVegasForTransit/transit-mapper')
    throw new Error('Release tag discovery requires the reviewed TransitMapper source repository.');
  if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/u.test(manifest.version))
    throw new Error('Release tag discovery requires a valid package version.');
  const ref = `refs/tags/v${manifest.version}`;
  // Query only the version tag after Release Please finishes. No mutable branch,
  // tag creation, or write credential participates in choosing build metadata.
  const records = execFileSync('git', ['ls-remote', repository, ref, `${ref}^{}`], {
    cwd: root,
    encoding: 'utf8',
    timeout: 20_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return exactReleaseTag(manifest.version, git.commitSha, records) ?? undefined;
}
