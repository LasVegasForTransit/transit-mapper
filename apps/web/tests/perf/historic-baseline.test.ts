import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LEGACY_BASELINE_MARK_SOURCE,
  LEGACY_BASELINE_REVISION,
  legacyBaselineArtifactPaths,
} from '../../scripts/perf/historic-baseline';

describe('the 497a549 baseline artifact', () => {
  it('keeps the historical app output separate from the candidate artifact', () => {
    const worktreeRoot = '/tmp/transitmapper-497a549-example/source';

    expect(legacyBaselineArtifactPaths(worktreeRoot)).toEqual({
      appRoot: resolve(worktreeRoot, 'apps/web'),
      outputDirectory: resolve(worktreeRoot, 'apps/web/dist'),
      embedHtmlPath: resolve(worktreeRoot, 'apps/web/dist/embed.html'),
    });
  });

  it('pins the only supported observer adapter to its audited revision', () => {
    expect(LEGACY_BASELINE_REVISION).toBe('497a549');
    expect(LEGACY_BASELINE_MARK_SOURCE).toBe('legacy-497a549-observer-v1');
  });
});
