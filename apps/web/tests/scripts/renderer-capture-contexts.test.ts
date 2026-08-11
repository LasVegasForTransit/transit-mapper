import type { Page } from 'playwright-core';
import { describe, expect, it, vi } from 'vitest';
import { contextRendererStats } from '../../scripts/renderer-capture/capture-contexts';

describe('renderer context evidence', () => {
  it('attributes statistics only to the editor renderer that owns the collector', async () => {
    const snapshot = {
      projectionCount: 1,
      projectionDurationMs: 2,
      maxProjectionDurationMs: 2,
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
