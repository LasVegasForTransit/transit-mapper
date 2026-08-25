import { describe, expect, it } from 'vitest';
import { PERF_PROTOCOL, PERF_SCENARIOS } from '../../src/perf/scenarios';
import {
  createPartialPerfReport,
  createPerfReport,
  createUnavailablePerfReport,
  summarizeMetric,
} from '../../src/perf/report';
import type { PerfNetworkByteReport } from '../../src/perf/network-byte-types';
import type { PerfMetricValues, PerfSample } from '../../src/perf/types';

function automaticNetwork(): PerfNetworkByteReport {
  const totals = { encodedBytes: 0, decodedBytes: 0, requestCount: 0 };
  return {
    authority: 'cdp-network-encoded-data-length',
    automaticBoundaryMs: 60_000,
    settled: true,
    unsettledNonMapRequestCount: 0,
    requests: [],
    phases: {},
    total: {
      firstPartyApplication: { ...totals },
      externalMap: { ...totals },
      documentData: { ...totals },
      serviceWorker: { ...totals },
      telemetry: { ...totals },
      other: { ...totals },
      total: { ...totals },
    },
  };
}

function metrics(loadMs: number): PerfMetricValues {
  return {
    loadMs,
    firstContentfulPaintMs: loadMs + 1,
    largestContentfulPaintMs: loadMs + 2,
    firstMapCanvasMs: loadMs + 3,
    cumulativeLayoutShift: loadMs / 1_000,
    longTaskTotalMs: loadMs + 4,
    transferBytes: loadMs * 1_000,
    inputToNextPaintP95Ms: loadMs + 5,
    paintedFrameP95Ms: loadMs + 6,
    paintedFramesOver33Ratio: loadMs / 10_000,
    maxUnexpectedLongTaskMs: loadMs + 7,
    warmLoadMs: loadMs + 8,
    warmLargestContentfulPaintMs: loadMs + 9,
    warmCumulativeLayoutShift: loadMs / 2_000,
    warmInputToNextPaintP95Ms: loadMs + 10,
  };
}

function sample(run: number, loadMs: number): PerfSample {
  const gesture = {
    name: 'map-pan' as const,
    frameSource: 'map-render' as const,
    inputToNextPaintMs: [],
    paintedFrameMs: [],
    unexpectedLongTaskMs: [],
    actions: ['camera-drag'] as Array<'camera-drag' | 'entity-drag' | 'draw'>,
    simulationState: 'running' as const,
  };
  const counters = {
    sourceUploadCount: 0,
    paintedFrameCount: 0,
    unexpectedLongTaskCount: 0,
    domNodeCount: 0,
    phaseCounters: {
      fullProjectionCount: 1,
      gestureProjectionCount: 2,
      entityComparisonCount: 3,
      projectedEntityCount: 4,
    },
  };
  const network = {
    requestCount: 0,
    cacheHitCount: 0,
    cacheMissCount: 0,
    transferBytes: 0,
  };
  const memory = { jsHeapUsedBytes: 0, jsHeapTotalBytes: 0 };
  return {
    scenarioId: 'small',
    run,
    metrics: metrics(loadMs),
    gesture,
    warmGesture: gesture,
    counters,
    warmCounters: counters,
    network,
    warmNetwork: network,
    memory,
    warmMemory: memory,
    rendererStats: null,
    warmRendererStats: null,
    persistence: {
      serializedBytes: 0,
      parseMs: 0,
      serializationMs: 0,
      localStorageWriteMs: 0,
      localStorageWriteOutcome: 'stored',
      offThreadSerializationThresholdMs: 50,
      indexedDbThresholdBytes: 4_000_000,
      recommendOffThreadSerialization: false,
      recommendIndexedDb: false,
    },
  };
}

describe('performance reports', () => {
  it('summarizes five measured runs without a warm-up sample', () => {
    const summary = summarizeMetric([50, 10, 40, 20, 30]);

    expect(summary).toEqual({
      samples: 5,
      min: 10,
      median: 30,
      p95: 50,
      max: 50,
      variance: 200,
      standardDeviation: Math.sqrt(200),
      coefficientOfVariation: Math.sqrt(200) / 30,
    });
  });

  it('builds a stable report from measured samples', () => {
    const report = createPerfReport({
      generatedAt: '2026-07-28T12:00:00.000Z',
      protocol: PERF_PROTOCOL,
      scenarios: [PERF_SCENARIOS.small],
      samples: [sample(1, 50), sample(2, 10), sample(3, 40), sample(4, 20), sample(5, 30)],
      firstSessions: [
        {
          journey: 'new-user-editor',
          surface: 'editor',
          cacheState: 'cold',
          milestones: {
            documentResponseEndMs: 20,
            bootstrapStartMs: 5,
            shellMountedMs: 30,
            storageReadStartMs: null,
            storageReadEndMs: null,
            deserializeStartMs: null,
            deserializeEndMs: null,
            systemCommittedMs: 40,
            mapStyleReadyMs: 50,
            firstSystemPaintMs: null,
            interactiveMs: 60,
            networkIdleMs: 100,
            serviceWorkerReadyMs: null,
          },
          network: automaticNetwork(),
        },
      ],
    });

    expect(report.schemaVersion).toBe(3);
    expect(report.status).toBe('ok');
    expect(report.generatedAt).toBe('2026-07-28T12:00:00.000Z');
    expect(report.scenarios[0].metrics.loadMs.median).toBe(30);
    expect(report.scenarios[0].metrics.inputToNextPaintP95Ms.median).toBe(35);
    expect(report.scenarios[0].metrics.loadMs.variance).toBe(200);
    expect(report.scenarios[0].gateValues.loadMs).toBe(50);
    expect(report.samples[0].counters.phaseCounters).toEqual({
      fullProjectionCount: 1,
      gestureProjectionCount: 2,
      entityComparisonCount: 3,
      projectedEntityCount: 4,
    });
    expect(report.samples.map((value) => value.run)).toEqual([1, 2, 3, 4, 5]);
    expect(report.firstSessions[0]).toEqual(
      expect.objectContaining({
        journey: 'new-user-editor',
        surface: 'editor',
        cacheState: 'cold',
      }),
    );
  });

  it('gates painted frames and unexpected long tasks across cold and warm gestures', () => {
    const samples = [1, 2, 3, 4, 5].map((run) => {
      const measured = sample(run, 10);
      measured.gesture = {
        ...measured.gesture,
        paintedFrameMs: [10],
        unexpectedLongTaskMs: [],
      };
      measured.warmGesture = {
        ...measured.warmGesture,
        paintedFrameMs: run === 5 ? [40] : [20],
        unexpectedLongTaskMs: run === 5 ? [65] : [],
      };
      return measured;
    });

    const report = createPerfReport({
      generatedAt: '2026-07-28T12:00:00.000Z',
      protocol: PERF_PROTOCOL,
      scenarios: [PERF_SCENARIOS.small],
      samples,
    });

    expect(report.scenarios[0].gateValues.paintedFrameP95Ms).toBe(40);
    expect(report.scenarios[0].gateValues.paintedFramesOver33Ratio).toBe(0.1);
    expect(report.scenarios[0].gateValues.maxUnexpectedLongTaskMs).toBe(65);
  });

  it('summarizes the measured production Worker and IndexedDB save lane', () => {
    const samples = [1, 2, 3, 4, 5].map((run) => {
      const measured = sample(run, 10);
      measured.persistence.production = {
        saveMs: 450 + run,
        serializationMs: 10 + run,
        indexedDbWriteMs: 2 + run,
      };
      return measured;
    });

    const report = createPerfReport({
      generatedAt: '2026-07-28T12:00:00.000Z',
      protocol: PERF_PROTOCOL,
      scenarios: [PERF_SCENARIOS.small],
      samples,
    });

    expect(report.scenarios[0].persistence.productionSampleCount).toBe(5);
    expect(report.scenarios[0].persistence.productionSaveMs.median).toBe(453);
    expect(report.scenarios[0].persistence.productionSerializationMs.p95).toBe(15);
    expect(report.scenarios[0].persistence.productionIndexedDbWriteMs.max).toBe(7);
  });

  it('reports an unavailable browser without inventing timings', () => {
    const report = createUnavailablePerfReport({
      generatedAt: '2026-07-28T12:00:00.000Z',
      protocol: PERF_PROTOCOL,
      scenarios: [PERF_SCENARIOS.small],
      reason: 'Google Chrome was not found.',
    });

    expect(report.status).toBe('unavailable');
    expect(report.unavailableReason).toBe('Google Chrome was not found.');
    expect(report.samples).toEqual([]);
    expect(report.scenarios).toEqual([]);
  });

  it('retains completed samples when a later phase fails', () => {
    const completed = sample(1, 50);
    const report = createPartialPerfReport({
      generatedAt: '2026-08-20T12:00:00.000Z',
      protocol: { ...PERF_PROTOCOL, measuredRuns: 1 },
      scenarios: [PERF_SCENARIOS.small],
      samples: [completed],
      reason: 'share did not settle',
      phases: [
        { phase: 'instrumented', status: 'passed' },
        { phase: 'first-session', status: 'failed', reason: 'share did not settle' },
      ],
    });

    expect(report.status).toBe('partial');
    expect(report.samples).toEqual([completed]);
    expect(report.scenarios).toHaveLength(1);
    expect(report.phases).toEqual([
      { phase: 'instrumented', status: 'passed' },
      { phase: 'first-session', status: 'failed', reason: 'share did not settle' },
    ]);
  });
});
