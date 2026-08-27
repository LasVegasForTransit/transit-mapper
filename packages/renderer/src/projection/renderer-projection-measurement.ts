import type { SourceFeatureProjectionCounts } from './source-feature-projection';
import type { CooperativeRenderJobSchedulerStats } from './cooperative-render-job-scheduler';
import type { GeographicFeatureProjectionPreparationStats } from './resumable-feature-projection';
import type { RendererProjectionSample, RendererStatsCollector } from '../renderer-stats';

const RENDERER_INSTRUMENTATION_BUILD =
  import.meta.env.DEV || import.meta.env.VITE_PERF_BUILD === '1';

export interface RendererProjectionMeasurementOptions {
  readonly counts: SourceFeatureProjectionCounts;
  readonly collector: RendererStatsCollector;
  readonly enabled: boolean;
  now(): number;
}

export interface RendererProjectionMeasurement {
  recordScheduling(stats: CooperativeRenderJobSchedulerStats): void;
  recordPreparation(stats: GeographicFeatureProjectionPreparationStats): void;
  /** Captures accepted wall latency and returns it for camera preload sizing. */
  markSettled(): number;
  /** Records one accepted cooperative geographic generation. */
  recordCommitted(): void;
  /** Records one synchronous editor-only projection without mixing its work
   * into committed geometry statistics. */
  recordSynchronousEditor(): void;
}

interface ProjectionCountBaseline {
  readonly cacheHitCount: number;
  readonly cacheMissCount: number;
  readonly candidateFeatureCount: number;
  readonly visibleFeatureCount: number;
  readonly generatedVertexCount: number;
  readonly tierTransitionCount: number;
}

function projectionCountBaseline(counts: SourceFeatureProjectionCounts): ProjectionCountBaseline {
  return {
    cacheHitCount:
      counts.featureLaneGeometryCacheHitCount +
      counts.diagramTopologyCacheHitCount +
      counts.diagramStopCacheHitCount,
    cacheMissCount:
      counts.featureLaneGeometryBuildCount +
      counts.diagramTopologyBuildCount +
      counts.diagramStopBuildCount,
    candidateFeatureCount: counts.rendererCandidateFeatureCount,
    visibleFeatureCount: counts.rendererGeneratedFeatureCount,
    generatedVertexCount: counts.rendererGeneratedVertexCount,
    tierTransitionCount: counts.featureTierTransitionCount,
  };
}

function projectionSample(
  counts: SourceFeatureProjectionCounts,
  baseline: ProjectionCountBaseline,
  cpuDurationMs: number,
  settlementLatencyMs: number,
): RendererProjectionSample {
  const current = projectionCountBaseline(counts);
  return {
    cpuDurationMs,
    settlementLatencyMs,
    candidateFeatureCount: current.candidateFeatureCount - baseline.candidateFeatureCount,
    visibleFeatureCount: current.visibleFeatureCount - baseline.visibleFeatureCount,
    generatedVertexCount: current.generatedVertexCount - baseline.generatedVertexCount,
    cacheHitCount: current.cacheHitCount - baseline.cacheHitCount,
    cacheMissCount: current.cacheMissCount - baseline.cacheMissCount,
    tierTransitionCount: current.tierTransitionCount - baseline.tierTransitionCount,
  };
}

/** One logical generation's truthful accounting boundary. Cooperative CPU is
 * accumulated from physical scheduler jobs while elapsed frame-queue time is
 * retained only as settlement latency. */
export function createRendererProjectionMeasurement(
  options: RendererProjectionMeasurementOptions,
): RendererProjectionMeasurement {
  if (!RENDERER_INSTRUMENTATION_BUILD || !options.enabled) {
    const startedAtMs = options.now();
    return {
      recordScheduling() {},
      recordPreparation() {},
      markSettled: () => options.now() - startedAtMs,
      recordCommitted() {},
      recordSynchronousEditor() {},
    };
  }
  const { counts, collector } = options;
  const startedAtMs = options.now();
  const baseline = projectionCountBaseline(counts);
  let cpuDurationMs = 0;
  let settlementLatencyMs = 0;

  const markSettled = () => {
    settlementLatencyMs = options.now() - startedAtMs;
    return settlementLatencyMs;
  };

  return {
    recordScheduling(stats) {
      cpuDurationMs += stats.totalSliceDurationMs;
      collector.recordScheduling(stats);
    },
    recordPreparation(stats) {
      if (!stats.includedInScheduling) cpuDurationMs += stats.preparationDurationMs;
      collector.recordPreparation(stats);
    },
    markSettled,
    recordCommitted() {
      collector.recordProjection(
        projectionSample(counts, baseline, cpuDurationMs, settlementLatencyMs),
      );
    },
    recordSynchronousEditor() {
      const elapsedMs = markSettled();
      collector.recordEditorProjection(projectionSample(counts, baseline, elapsedMs, elapsedMs));
    },
  };
}
