import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveBuildOutputDirectory } from '../../scripts/build-output';

describe('build output directories', () => {
  it('keeps the instrumented performance artifact outside the public delivery directory', () => {
    const appRoot = '/workspace/apps/web';

    expect(resolveBuildOutputDirectory(appRoot, false)).toBe(resolve(appRoot, 'dist'));
    expect(resolveBuildOutputDirectory(appRoot, true)).toBe(resolve(appRoot, '.perf-harness-dist'));
  });
});
