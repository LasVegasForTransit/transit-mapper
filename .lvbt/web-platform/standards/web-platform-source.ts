import { execFileSync } from 'node:child_process';

import type { WebPreset } from './web-platform.ts';

const paths = [
  'packages',
  'examples/with-astro',
  'examples/with-vite-react',
  'standards',
  'LICENSE',
];

function readPreset(repository: string, ref: string, release: string | null): WebPreset {
  const git = (args: string[]) =>
    execFileSync('git', ['-C', repository, ...args], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
  const commit = git(['rev-parse', '--verify', `${ref}^{commit}`]).trim();
  const entries = git(['ls-tree', '-rz', commit, '--', ...paths])
    .split('\0')
    .filter(Boolean);
  const files: Record<string, string> = {};
  const executables: string[] = [];
  for (const entry of entries) {
    const [header, name] = entry.split('\t');
    if (!name || !header?.startsWith('100')) throw new Error(`Unsupported preset entry: ${entry}`);
    files[name] = git(['show', `${commit}:${name}`]);
    if (header.startsWith('100755')) executables.push(name);
  }
  if (!files['packages/cli/catalog.json'])
    throw new Error('Release has no organization dependency catalog.');
  return { formatVersion: 1, preset: 'lvbt-web', release, commit, files, executables };
}

export function readRelease(repository: string, release: string): WebPreset {
  if (!/^v\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/.test(release)) {
    throw new Error('Use an explicit version tag, such as v0.2.7.');
  }
  return readPreset(repository, `refs/tags/${release}`, release);
}

export function readCommit(repository: string, commit: string): WebPreset {
  if (!/^[a-f0-9]{40}$/.test(commit)) {
    throw new Error('Use a full commit SHA for an unpublished preset.');
  }
  return readPreset(repository, commit, null);
}
