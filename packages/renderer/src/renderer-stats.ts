export interface RendererProjectionSample {
  /** Sum of generation-local scheduler slices plus unscheduled preparation.
   * It excludes requestAnimationFrame queue latency. */
  cpuDurationMs: number;
  /** User-observed wall time from submission until the accepted live scene. */
  settlementLatencyMs: number;
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

/** Per-job cooperative scheduling deltas. The MapLibre adapter records a
 * completed, canceled, or failed generation once; this collector never reads
 * scheduler internals or asks projection geometry to be traversed again. */
interface RendererSchedulingSample {
  sliceCount: number;
  yieldCount: number;
  canceledJobCount: number;
  failedJobCount: number;
  totalSliceDurationMs: number;
  maxSliceDurationMs: number;
  maxUnitDurationMs: number;
  maxCommitDurationMs: number;
}

interface RendererPreparationSample {
  preparationCount: number;
  preparationDurationMs: number;
  maxPreparationDurationMs: number;
  overBudgetPreparationCount: number;
}

export interface RendererStatsSnapshot {
  projectionCount: number;
  projectionDurationMs: number;
  maxProjectionDurationMs: number;
  projectionSettlementLatencyMs: number;
  maxProjectionSettlementLatencyMs: number;
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
  projectionSliceCount: number;
  projectionYieldCount: number;
  /** Cooperative main-thread time for every physical job, including work
   * later canceled or discarded by adaptive refinement. */
  projectionScheduledDurationMs: number;
  maxProjectionScheduledDurationMs: number;
  canceledProjectionCount: number;
  failedProjectionCount: number;
  maxProjectionSliceMs: number;
  maxProjectionUnitMs: number;
  maxSceneCommitMs: number;
  projectionPreparationCount: number;
  projectionPreparationDurationMs: number;
  overBudgetProjectionPreparationCount: number;
  maxProjectionPreparationMs: number;
  editorProjectionCount: number;
  editorProjectionDurationMs: number;
  maxEditorProjectionDurationMs: number;
  editorProjectionSettlementLatencyMs: number;
  maxEditorProjectionSettlementLatencyMs: number;
  editorCandidateFeatureCount: number;
  editorVisibleFeatureCount: number;
  editorGeneratedVertexCount: number;
  editorCacheHitCount: number;
  editorCacheMissCount: number;
  editorTierTransitionCount: number;
}

export interface RendererStatsCollector {
  recordProjection(sample: RendererProjectionSample): void;
  recordEditorProjection(sample: RendererProjectionSample): void;
  recordPatch(sample: RendererPatchSample): void;
  recordFullUpload(sourceUploadCount: number): void;
  recordScheduling(sample: RendererSchedulingSample): void;
  recordPreparation(sample: RendererPreparationSample): void;
  snapshot(): RendererStatsSnapshot;
}

const RENDERER_INSTRUMENTATION_BUILD =
  import.meta.env.DEV || import.meta.env.VITE_PERF_BUILD === '1';

function emptyRendererStats(): RendererStatsSnapshot {
  return {
    projectionCount: 0,
    projectionDurationMs: 0,
    maxProjectionDurationMs: 0,
    projectionSettlementLatencyMs: 0,
    maxProjectionSettlementLatencyMs: 0,
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
    projectionSliceCount: 0,
    projectionYieldCount: 0,
    projectionScheduledDurationMs: 0,
    maxProjectionScheduledDurationMs: 0,
    canceledProjectionCount: 0,
    failedProjectionCount: 0,
    maxProjectionSliceMs: 0,
    maxProjectionUnitMs: 0,
    maxSceneCommitMs: 0,
    projectionPreparationCount: 0,
    projectionPreparationDurationMs: 0,
    overBudgetProjectionPreparationCount: 0,
    maxProjectionPreparationMs: 0,
    editorProjectionCount: 0,
    editorProjectionDurationMs: 0,
    maxEditorProjectionDurationMs: 0,
    editorProjectionSettlementLatencyMs: 0,
    maxEditorProjectionSettlementLatencyMs: 0,
    editorCandidateFeatureCount: 0,
    editorVisibleFeatureCount: 0,
    editorGeneratedVertexCount: 0,
    editorCacheHitCount: 0,
    editorCacheMissCount: 0,
    editorTierTransitionCount: 0,
  };
}

function enabledRendererStatsCollector(): RendererStatsCollector {
  const stats = emptyRendererStats();
  return {
    recordProjection(sample) {
      stats.projectionCount += 1;
      stats.projectionDurationMs += sample.cpuDurationMs;
      stats.maxProjectionDurationMs = Math.max(stats.maxProjectionDurationMs, sample.cpuDurationMs);
      stats.projectionSettlementLatencyMs += sample.settlementLatencyMs;
      stats.maxProjectionSettlementLatencyMs = Math.max(
        stats.maxProjectionSettlementLatencyMs,
        sample.settlementLatencyMs,
      );
      stats.candidateFeatureCount += sample.candidateFeatureCount;
      stats.visibleFeatureCount += sample.visibleFeatureCount;
      stats.generatedVertexCount += sample.generatedVertexCount;
      stats.cacheHitCount += sample.cacheHitCount;
      stats.cacheMissCount += sample.cacheMissCount;
      stats.tierTransitionCount += sample.tierTransitionCount;
    },
    recordEditorProjection(sample) {
      stats.editorProjectionCount += 1;
      stats.editorProjectionDurationMs += sample.cpuDurationMs;
      stats.maxEditorProjectionDurationMs = Math.max(
        stats.maxEditorProjectionDurationMs,
        sample.cpuDurationMs,
      );
      stats.editorProjectionSettlementLatencyMs += sample.settlementLatencyMs;
      stats.maxEditorProjectionSettlementLatencyMs = Math.max(
        stats.maxEditorProjectionSettlementLatencyMs,
        sample.settlementLatencyMs,
      );
      stats.editorCandidateFeatureCount += sample.candidateFeatureCount;
      stats.editorVisibleFeatureCount += sample.visibleFeatureCount;
      stats.editorGeneratedVertexCount += sample.generatedVertexCount;
      stats.editorCacheHitCount += sample.cacheHitCount;
      stats.editorCacheMissCount += sample.cacheMissCount;
      stats.editorTierTransitionCount += sample.tierTransitionCount;
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
    recordScheduling(sample) {
      stats.projectionSliceCount += sample.sliceCount;
      stats.projectionYieldCount += sample.yieldCount;
      stats.projectionScheduledDurationMs += sample.totalSliceDurationMs;
      stats.maxProjectionScheduledDurationMs = Math.max(
        stats.maxProjectionScheduledDurationMs,
        sample.totalSliceDurationMs,
      );
      stats.canceledProjectionCount += sample.canceledJobCount;
      stats.failedProjectionCount += sample.failedJobCount;
      stats.maxProjectionSliceMs = Math.max(stats.maxProjectionSliceMs, sample.maxSliceDurationMs);
      stats.maxProjectionUnitMs = Math.max(stats.maxProjectionUnitMs, sample.maxUnitDurationMs);
      stats.maxSceneCommitMs = Math.max(stats.maxSceneCommitMs, sample.maxCommitDurationMs);
    },
    recordPreparation(sample) {
      stats.projectionPreparationCount += sample.preparationCount;
      stats.projectionPreparationDurationMs += sample.preparationDurationMs;
      stats.overBudgetProjectionPreparationCount += sample.overBudgetPreparationCount;
      stats.maxProjectionPreparationMs = Math.max(
        stats.maxProjectionPreparationMs,
        sample.maxPreparationDurationMs,
      );
    },
    snapshot: () => ({ ...stats }),
  };
}

/** Development/performance instrumentation. Production keeps the renderer's
 * lightweight call sites but omits the diagnostic accumulator from delivery. */
export function createRendererStatsCollector(): RendererStatsCollector {
  if (RENDERER_INSTRUMENTATION_BUILD) return enabledRendererStatsCollector();
  return {
    recordProjection() {},
    recordEditorProjection() {},
    recordPatch() {},
    recordFullUpload() {},
    recordScheduling() {},
    recordPreparation() {},
    snapshot: emptyRendererStats,
  };
}
