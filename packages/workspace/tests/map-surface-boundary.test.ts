import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../../..');

describe('the MapSurface dependency boundary', () => {
  it('keeps editor application modules outside the reusable surface graph', () => {
    const result = spawnSync(
      resolve(repositoryRoot, 'node_modules/.bin/dependency-cruiser'),
      [
        '--config',
        resolve(repositoryRoot, 'dependency-cruiser.config.mjs'),
        'packages/workspace/src/map-surface.tsx',
      ],
      { cwd: repositoryRoot, encoding: 'utf8' },
    );
    if (result.error) throw result.error;

    expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
  });
});
