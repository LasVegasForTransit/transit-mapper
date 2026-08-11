import { describe, expect, it } from 'vitest';
import { createRendererStatsCollector } from '../../src/perf/renderer-stats';

describe('renderer statistics', () => {
  it('records projection, cache, tier, vertex, and patch work without losing prior samples', () => {
    const stats = createRendererStatsCollector();

    stats.recordProjection({
      durationMs: 3.25,
      candidateFeatureCount: 120,
      visibleFeatureCount: 48,
      generatedVertexCount: 900,
      cacheHitCount: 31,
      cacheMissCount: 4,
      tierTransitionCount: 2,
    });
    stats.recordPatch({ addedFeatureCount: 5, removedFeatureCount: 2, sourceUploadCount: 3 });
    stats.recordFullUpload(12);

    expect(stats.snapshot()).toEqual({
      projectionCount: 1,
      projectionDurationMs: 3.25,
      maxProjectionDurationMs: 3.25,
      candidateFeatureCount: 120,
      visibleFeatureCount: 48,
      generatedVertexCount: 900,
      cacheHitCount: 31,
      cacheMissCount: 4,
      tierTransitionCount: 2,
      patchCount: 1,
      patchAddedFeatureCount: 5,
      patchRemovedFeatureCount: 2,
      fullUploadCount: 1,
      sourceUploadCount: 15,
    });
  });

  it('returns defensive snapshots', () => {
    const stats = createRendererStatsCollector();
    const first = stats.snapshot();
    first.projectionCount = 99;

    expect(stats.snapshot().projectionCount).toBe(0);
  });
});
