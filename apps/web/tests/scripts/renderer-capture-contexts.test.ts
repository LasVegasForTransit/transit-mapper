import type { Page } from 'playwright-core';
import { describe, expect, it, vi } from 'vitest';
import { contextRendererStats } from '../../scripts/renderer-capture/capture-contexts';

describe('renderer context evidence', () => {
  it('attributes statistics only to the editor renderer that owns the collector', async () => {
    const snapshot = {
      projectionCount: 1,
      projectionDurationMs: 2,
      maxProjectionDurationMs: 2,
      projectionSettlementLatencyMs: 8,
      maxProjectionSettlementLatencyMs: 8,
      candidateFeatureCount: 3,
      visibleFeatureCount: 4,
      generatedVertexCount: 5,
      cacheHitCount: 6,
      cacheMissCount: 7,
      tierTransitionCount: 8,
      patchCount: 9,
      patchAddedFeatureCount: 10,
      patchRemovedFeatureCount: 11,
      fullUploadCount: 12,
      sourceUploadCount: 13,
      projectionSliceCount: 14,
      projectionYieldCount: 15,
      projectionScheduledDurationMs: 21,
      maxProjectionScheduledDurationMs: 3.5,
      canceledProjectionCount: 16,
      failedProjectionCount: 17,
      maxProjectionSliceMs: 3.5,
      maxProjectionUnitMs: 2.5,
      maxSceneCommitMs: 0.5,
      editorProjectionCount: 1,
      editorProjectionDurationMs: 0.25,
      maxEditorProjectionDurationMs: 0.25,
      editorProjectionSettlementLatencyMs: 0.25,
      maxEditorProjectionSettlementLatencyMs: 0.25,
      editorCandidateFeatureCount: 1,
      editorVisibleFeatureCount: 1,
      editorGeneratedVertexCount: 2,
      editorCacheHitCount: 0,
      editorCacheMissCount: 0,
      editorTierTransitionCount: 0,
    };
    const evaluate = vi.fn(() => Promise.resolve(snapshot));
    const page = { evaluate } as unknown as Page;

    await expect(contextRendererStats(page, 'editor')).resolves.toEqual(snapshot);
    await expect(contextRendererStats(page, 'export')).resolves.toBeNull();
    await expect(contextRendererStats(page, 'onboarding')).resolves.toBeNull();
    await expect(contextRendererStats(page, 'embed')).resolves.toBeNull();
    expect(evaluate).toHaveBeenCalledOnce();
  });
});
