import type { Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import * as journeys from '../../scripts/perf/journeys';
import { createPerfReport } from '../../src/perf/report';
import type { RendererStatsSnapshot } from '@transitmapper/renderer/stats';
import { PERF_PROTOCOL, PERF_SCENARIOS } from '../../src/perf/scenarios';
import type { PerfSample } from '../../src/perf/types';

const RENDERER_STATS: RendererStatsSnapshot = {
  passengerLineSceneCount: 0,
  passengerLineSceneDurationMs: 0,
  projectionCount: 2,
  projectionDurationMs: 4.5,
  maxProjectionDurationMs: 3,
  projectionSettlementLatencyMs: 18,
  maxProjectionSettlementLatencyMs: 11,
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
  projectionYieldCount: 1,
  projectionScheduledDurationMs: 7.5,
  maxProjectionScheduledDurationMs: 3.5,
  canceledProjectionCount: 0,
  failedProjectionCount: 0,
  maxProjectionSliceMs: 3.5,
  maxProjectionUnitMs: 2.5,
  maxSceneCommitMs: 0.5,
  projectionPreparationCount: 2,
  projectionPreparationDurationMs: 3.5,
  overBudgetProjectionPreparationCount: 0,
  maxProjectionPreparationMs: 2,
  editorProjectionCount: 1,
  editorProjectionDurationMs: 0.5,
  maxEditorProjectionDurationMs: 0.5,
  editorProjectionSettlementLatencyMs: 0.5,
  maxEditorProjectionSettlementLatencyMs: 0.5,
  editorCandidateFeatureCount: 2,
  editorVisibleFeatureCount: 1,
  editorGeneratedVertexCount: 3,
  editorCacheHitCount: 0,
  editorCacheMissCount: 1,
  editorTierTransitionCount: 0,
};

function measuredSample(rendererStats: RendererStatsSnapshot): PerfSample {
  const gesture = {
    name: 'map-drag' as const,
    frameSource: 'map-render' as const,
    inputToNextPaintMs: [12],
    paintedFrameMs: [16],
    unexpectedLongTaskMs: [],
    actions: ['camera-drag'] as const,
    simulationState: 'running' as const,
  };
  return {
    scenarioId: 'small',
    run: 1,
    metrics: {
      loadMs: 1,
      firstContentfulPaintMs: 1,
      largestContentfulPaintMs: 1,
      firstMapCanvasMs: 1,
      cumulativeLayoutShift: 0,
      longTaskTotalMs: 0,
      transferBytes: 1,
      inputToNextPaintP95Ms: 12,
      paintedFrameP95Ms: 16,
      paintedFramesOver33Ratio: 0,
      maxUnexpectedLongTaskMs: 0,
      warmLoadMs: 1,
      warmLargestContentfulPaintMs: 1,
      warmCumulativeLayoutShift: 0,
      warmInputToNextPaintP95Ms: 12,
    },
    gesture: { ...gesture, actions: [...gesture.actions] },
    warmGesture: { ...gesture, actions: [...gesture.actions], simulationState: 'paused' },
    counters: {
      sourceUploadCount: 0,
      paintedFrameCount: 1,
      unexpectedLongTaskCount: 0,
      domNodeCount: 1,
      phaseCounters: null,
    },
    warmCounters: {
      sourceUploadCount: 0,
      paintedFrameCount: 1,
      unexpectedLongTaskCount: 0,
      domNodeCount: 1,
      phaseCounters: null,
    },
    network: { requestCount: 0, cacheHitCount: 0, cacheMissCount: 0, transferBytes: 0 },
    warmNetwork: { requestCount: 0, cacheHitCount: 0, cacheMissCount: 0, transferBytes: 0 },
    memory: { jsHeapUsedBytes: 1, jsHeapTotalBytes: 1 },
    warmMemory: { jsHeapUsedBytes: 1, jsHeapTotalBytes: 1 },
    persistence: {
      serializedBytes: 1,
      parseMs: 0,
      serializationMs: 0,
      localStorageWriteMs: 0,
      localStorageWriteOutcome: 'stored',
      offThreadSerializationThresholdMs: 50,
      indexedDbThresholdBytes: 4_000_000,
      recommendOffThreadSerialization: false,
      recommendIndexedDb: false,
    },
    rendererStats,
    warmRendererStats: { ...rendererStats, projectionCount: 1 },
  };
}

describe('renderer statistics in performance reports', () => {
  it('collects finite cold and warm snapshots without report aggregation mutating them', async () => {
    expect(journeys).toHaveProperty('collectRendererStatsSnapshot');
    const page = {
      evaluate: () => Promise.resolve(RENDERER_STATS),
    } as unknown as Page;
    const rendererStats = await journeys.collectRendererStatsSnapshot(page);
    if (!rendererStats) throw new Error('The renderer statistics seam returned no snapshot.');
    const beforeAggregation = structuredClone(rendererStats);

    const report = createPerfReport({
      generatedAt: '2026-08-11T12:00:00.000Z',
      protocol: { ...PERF_PROTOCOL, measuredRuns: 1 },
      scenarios: [PERF_SCENARIOS.small],
      samples: [measuredSample(rendererStats)],
    });
    const serialized = JSON.parse(JSON.stringify(report)) as {
      samples: Array<{
        rendererStats: RendererStatsSnapshot;
        warmRendererStats: RendererStatsSnapshot;
      }>;
    };

    expect(Object.values(serialized.samples[0].rendererStats).every(Number.isFinite)).toBe(true);
    expect(Object.values(serialized.samples[0].warmRendererStats).every(Number.isFinite)).toBe(
      true,
    );
    expect(rendererStats).toEqual(beforeAggregation);
  });
});
