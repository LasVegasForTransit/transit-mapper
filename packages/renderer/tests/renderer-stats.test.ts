import { describe, expect, it } from 'vitest';
import { createRendererStatsCollector } from '../src/renderer-stats';

describe('renderer statistics', () => {
  it('records projection, cache, tier, vertex, and patch work without losing prior samples', () => {
    const stats = createRendererStatsCollector();

    stats.recordProjection({
      cpuDurationMs: 3.25,
      settlementLatencyMs: 22,
      candidateFeatureCount: 120,
      visibleFeatureCount: 48,
      generatedVertexCount: 900,
      cacheHitCount: 31,
      cacheMissCount: 4,
      tierTransitionCount: 2,
      passengerLineSceneCount: 1,
      passengerLineSceneDurationMs: 40,
    });
    stats.recordEditorProjection({
      cpuDurationMs: 0.75,
      settlementLatencyMs: 0.75,
      candidateFeatureCount: 4,
      visibleFeatureCount: 3,
      generatedVertexCount: 12,
      cacheHitCount: 2,
      cacheMissCount: 1,
      tierTransitionCount: 0,
      passengerLineSceneCount: 0,
      passengerLineSceneDurationMs: 0,
    });
    stats.recordPatch({ addedFeatureCount: 5, removedFeatureCount: 2, sourceUploadCount: 3 });
    stats.recordFullUpload(12);
    stats.recordScheduling({
      sliceCount: 3,
      yieldCount: 2,
      canceledJobCount: 1,
      failedJobCount: 0,
      totalSliceDurationMs: 6.2,
      maxSliceDurationMs: 3.8,
      maxUnitDurationMs: 2.1,
      maxCommitDurationMs: 0.7,
    });
    stats.recordPreparation({
      preparationCount: 1,
      preparationDurationMs: 4.5,
      maxPreparationDurationMs: 4.5,
      overBudgetPreparationCount: 1,
    });

    expect(stats.snapshot()).toEqual({
      projectionCount: 1,
      // The Line scene is built in the worker entry, outside the source
      // projector, so a projection reported every cost except its largest.
      passengerLineSceneCount: 1,
      passengerLineSceneDurationMs: 40,
      projectionDurationMs: 3.25,
      maxProjectionDurationMs: 3.25,
      projectionSettlementLatencyMs: 22,
      maxProjectionSettlementLatencyMs: 22,
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
      projectionSliceCount: 3,
      projectionYieldCount: 2,
      projectionScheduledDurationMs: 6.2,
      maxProjectionScheduledDurationMs: 6.2,
      canceledProjectionCount: 1,
      failedProjectionCount: 0,
      maxProjectionSliceMs: 3.8,
      maxProjectionUnitMs: 2.1,
      maxSceneCommitMs: 0.7,
      projectionPreparationCount: 1,
      projectionPreparationDurationMs: 4.5,
      overBudgetProjectionPreparationCount: 1,
      maxProjectionPreparationMs: 4.5,
      editorProjectionCount: 1,
      editorProjectionDurationMs: 0.75,
      maxEditorProjectionDurationMs: 0.75,
      editorProjectionSettlementLatencyMs: 0.75,
      maxEditorProjectionSettlementLatencyMs: 0.75,
      editorCandidateFeatureCount: 4,
      editorVisibleFeatureCount: 3,
      editorGeneratedVertexCount: 12,
      editorCacheHitCount: 2,
      editorCacheMissCount: 1,
      editorTierTransitionCount: 0,
    });
  });

  it('returns defensive snapshots', () => {
    const stats = createRendererStatsCollector();
    const first = stats.snapshot();
    first.projectionCount = 99;

    expect(stats.snapshot().projectionCount).toBe(0);
  });
});
