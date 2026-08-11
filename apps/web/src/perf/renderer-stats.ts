interface RendererProjectionSample {
  durationMs: number;
  candidateFeatureCount: number;
  visibleFeatureCount: number;
  generatedVertexCount: number;
  cacheHitCount: number;
  cacheMissCount: number;
  tierTransitionCount: number;
}

interface RendererPatchSample {
  addedFeatureCount: number;
  removedFeatureCount: number;
  sourceUploadCount: number;
}

export interface RendererStatsSnapshot {
  projectionCount: number;
  projectionDurationMs: number;
  maxProjectionDurationMs: number;
  candidateFeatureCount: number;
  visibleFeatureCount: number;
  generatedVertexCount: number;
  cacheHitCount: number;
  cacheMissCount: number;
  tierTransitionCount: number;
  patchCount: number;
  patchAddedFeatureCount: number;
  patchRemovedFeatureCount: number;
  fullUploadCount: number;
  sourceUploadCount: number;
}

export interface RendererStatsCollector {
  recordProjection(sample: RendererProjectionSample): void;
  recordPatch(sample: RendererPatchSample): void;
  recordFullUpload(sourceUploadCount: number): void;
  snapshot(): RendererStatsSnapshot;
}

function emptyRendererStats(): RendererStatsSnapshot {
  return {
    projectionCount: 0,
    projectionDurationMs: 0,
    maxProjectionDurationMs: 0,
    candidateFeatureCount: 0,
    visibleFeatureCount: 0,
    generatedVertexCount: 0,
    cacheHitCount: 0,
    cacheMissCount: 0,
    tierTransitionCount: 0,
    patchCount: 0,
    patchAddedFeatureCount: 0,
    patchRemovedFeatureCount: 0,
    fullUploadCount: 0,
    sourceUploadCount: 0,
  };
}

/** Development/performance instrumentation. The renderer owns when a unit of
 * work occurs; this collector only aggregates facts and is cheap enough to
 * leave attached throughout a measured journey. */
export function createRendererStatsCollector(): RendererStatsCollector {
  const stats = emptyRendererStats();
  return {
    recordProjection(sample) {
      stats.projectionCount += 1;
      stats.projectionDurationMs += sample.durationMs;
      stats.maxProjectionDurationMs = Math.max(stats.maxProjectionDurationMs, sample.durationMs);
      stats.candidateFeatureCount += sample.candidateFeatureCount;
      stats.visibleFeatureCount += sample.visibleFeatureCount;
      stats.generatedVertexCount += sample.generatedVertexCount;
      stats.cacheHitCount += sample.cacheHitCount;
      stats.cacheMissCount += sample.cacheMissCount;
      stats.tierTransitionCount += sample.tierTransitionCount;
    },
    recordPatch(sample) {
      stats.patchCount += 1;
      stats.patchAddedFeatureCount += sample.addedFeatureCount;
      stats.patchRemovedFeatureCount += sample.removedFeatureCount;
      stats.sourceUploadCount += sample.sourceUploadCount;
    },
    recordFullUpload(sourceUploadCount) {
      stats.fullUploadCount += 1;
      stats.sourceUploadCount += sourceUploadCount;
    },
    snapshot: () => ({ ...stats }),
  };
}
