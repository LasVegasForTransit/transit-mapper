import path from 'node:path';
import { findManifests, loadManifest } from '../platform/manifest.mjs';

/**
 * Every platform.json at the root or under apps/ matches the schema the CLI
 * ships and names nothing it does not declare. This is the structural half of
 * `pnpm preflight --production`, cheap enough to run on every commit, so a
 * typo in the manifest fails the check before anyone relies on it.
 */
export function checkPlatform({ cwd }) {
  const lines = [];
  for (const file of findManifests(cwd)) {
    try {
      loadManifest(path.join(cwd, file));
    } catch (error) {
      lines.push(...error.message.split('\n').map((line) => line.trim()));
    }
  }
  return {
    name: 'platform',
    ok: lines.length === 0,
    lines,
    fix: 'correct the fields named above; the platform manifest reference in repository-tooling describes each one',
  };
}
