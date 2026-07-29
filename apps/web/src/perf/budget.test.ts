import { describe, expect, it } from 'vitest';
import { evaluatePerfBudgets } from './budget';
import { createPerfReport, createUnavailablePerfReport } from './report';
import { PERF_PROTOCOL, PERF_SCENARIOS } from './scenarios';
import type { CreatePerfReportOptions, PerfMetricValues, PerfReport, PerfSample } from './types';

function metrics(loadMs: number): PerfMetricValues {
  return {
    loadMs,
    firstContentfulPaintMs: 1_000,
    largestContentfulPaintMs: 1_500,
    firstMapCanvasMs: 1_600,
    cumulativeLayoutShift: 0.01,
    longTaskTotalMs: 50,
    transferBytes: 100_000,
    inputToNextPaintP95Ms: 40,
    paintedFrameP95Ms: 16,
    paintedFramesOver33Ratio: 0,
    maxUnexpectedLongTaskMs: 0,
    warmLoadMs: loadMs,
    warmLargestContentfulPaintMs: 1_250,
    warmCumulativeLayoutShift: 0.005,
    warmInputToNextPaintP95Ms: 30,
  };
}

function sample(
  run: number,
  loadMs: number,
  metricOverrides: Partial<PerfMetricValues> = {},
): PerfSample {
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
    phaseCounters: null,
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
    metrics: { ...metrics(loadMs), ...metricOverrides },
    gesture,
    warmGesture: gesture,
    counters,
    warmCounters: counters,
    network,
    warmNetwork: network,
    memory,
    warmMemory: memory,
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

function report(loadMs: number): PerfReport {
  const samples = [1, 2, 3, 4, 5].map((run) => sample(run, loadMs));
  const options: CreatePerfReportOptions = {
    generatedAt: '2026-07-28T12:00:00.000Z',
    protocol: PERF_PROTOCOL,
    scenarios: [PERF_SCENARIOS.small],
    samples,
  };
  return createPerfReport(options);
}

describe('performance budgets', () => {
  it('fails when an absolute budget is exceeded', () => {
    const scenario = {
      ...PERF_SCENARIOS.small,
      absoluteBudgets: {
        ...PERF_SCENARIOS.small.absoluteBudgets,
        loadMs: 100,
      },
    };
    const actual = createPerfReport({
      generatedAt: '2026-07-28T12:00:00.000Z',
      protocol: PERF_PROTOCOL,
      scenarios: [scenario],
      samples: [1, 2, 3, 4, 5].map((run) => sample(run, 101)),
    });

    const result = evaluatePerfBudgets({
      report: actual,
      scenarios: [scenario],
      maxRegressionRatio: 0.1,
    });

    expect(result.status).toBe('fail');
    expect(result.violations).toContainEqual(
      expect.objectContaining({
        kind: 'absolute',
        scenarioId: 'small',
        metric: 'loadMs',
        actual: 101,
        limit: 100,
      }),
    );
  });

  it('uses the five-run p95 for absolute startup gates instead of hiding a bad run', () => {
    const scenario = {
      ...PERF_SCENARIOS.small,
      absoluteBudgets: {
        ...PERF_SCENARIOS.small.absoluteBudgets,
        loadMs: 100,
      },
    };
    const actual = createPerfReport({
      generatedAt: '2026-07-28T12:00:00.000Z',
      protocol: PERF_PROTOCOL,
      scenarios: [scenario],
      samples: [90, 90, 90, 90, 101].map((loadMs, index) => sample(index + 1, loadMs)),
    });

    const result = evaluatePerfBudgets({
      report: actual,
      scenarios: [scenario],
      maxRegressionRatio: 0.1,
    });

    expect(result.violations).toContainEqual(
      expect.objectContaining({
        kind: 'absolute',
        metric: 'loadMs',
        actual: 101,
      }),
    );
  });

  it('allows a baseline change at exactly ten percent', () => {
    const result = evaluatePerfBudgets({
      report: report(110),
      baseline: report(100),
      scenarios: [PERF_SCENARIOS.small],
      maxRegressionRatio: 0.1,
    });

    expect(result.violations.filter((violation) => violation.kind === 'regression')).toEqual([]);
  });

  it('fails when one percent of painted frames exceed 33 milliseconds', () => {
    const scenario = {
      ...PERF_SCENARIOS.small,
      absoluteBudgets: {
        ...PERF_SCENARIOS.small.absoluteBudgets,
        paintedFramesOver33Ratio: 0.01,
      },
    };
    const samples = [1, 2, 3, 4, 5].map((run) => sample(run, 100, { paintedFramesOver33Ratio: 0 }));
    for (const measured of samples) {
      measured.gesture.paintedFrameMs = Array.from({ length: 100 }, () => 16);
    }
    for (let index = 0; index < 5; index += 1) {
      samples[4].gesture.paintedFrameMs[index] = 34;
    }
    const actual = createPerfReport({
      generatedAt: '2026-07-28T12:00:00.000Z',
      protocol: PERF_PROTOCOL,
      scenarios: [scenario],
      samples,
    });

    const result = evaluatePerfBudgets({
      report: actual,
      scenarios: [scenario],
      maxRegressionRatio: 0.1,
    });

    expect(result.status).toBe('fail');
    expect(result.violations).toContainEqual(
      expect.objectContaining({
        kind: 'absolute',
        metric: 'paintedFramesOver33Ratio',
        actual: 0.01,
      }),
    );
  });

  it('fails a baseline regression greater than ten percent', () => {
    const result = evaluatePerfBudgets({
      report: report(110.01),
      baseline: report(100),
      scenarios: [PERF_SCENARIOS.small],
      maxRegressionRatio: 0.1,
    });

    expect(result.status).toBe('fail');
    expect(result.violations).toContainEqual(
      expect.objectContaining({
        kind: 'regression',
        scenarioId: 'small',
        metric: 'loadMs',
        baseline: 100,
        limit: 110,
        actual: 110.01,
      }),
    );
  });

  it('fails a delivered bundle regression greater than ten percent', () => {
    const baseline = report(100);
    baseline.bundles = [{ entry: 'main', rawBytes: 1_000, gzipBytes: 500, brotliBytes: 400 }];
    const actual = report(100);
    actual.bundles = [{ entry: 'main', rawBytes: 1_000, gzipBytes: 551, brotliBytes: 400 }];

    const result = evaluatePerfBudgets({
      report: actual,
      baseline,
      scenarios: [PERF_SCENARIOS.small],
      maxRegressionRatio: 0.1,
    });

    expect(result.violations).toContainEqual(
      expect.objectContaining({
        kind: 'bundle-regression',
        bundleEntry: 'main',
        bundleEncoding: 'gzip',
        actual: 551,
        limit: 550,
      }),
    );
  });

  it('reports raw bundle growth without making it a performance violation', () => {
    const baseline = report(100);
    baseline.bundles = [{ entry: 'main', rawBytes: 1_000, gzipBytes: 500, brotliBytes: 400 }];
    const actual = report(100);
    actual.bundles = [{ entry: 'main', rawBytes: 9_000, gzipBytes: 500, brotliBytes: 400 }];

    const result = evaluatePerfBudgets({
      report: actual,
      baseline,
      scenarios: [PERF_SCENARIOS.small],
      maxRegressionRatio: 0.1,
    });

    expect(result.violations).not.toContainEqual(
      expect.objectContaining({
        kind: 'bundle-regression',
        bundleEncoding: 'raw',
      }),
    );
  });

  it('treats a smoke as functional evidence rather than one-sample timing statistics', () => {
    const actual = report(10_000);

    const result = evaluatePerfBudgets({
      report: actual,
      scenarios: [PERF_SCENARIOS.small],
      maxRegressionRatio: 0.1,
      enforceNumericBudgets: false,
    });

    expect(result.status).toBe('pass');
    expect(result.violations).toEqual([]);
    expect(result.notices).toContain(
      'Smoke mode proves the production build and browser journey; numeric budgets require a full audit.',
    );
  });

  it('normalizes duration regressions with the deterministic CPU calibration', () => {
    const baseline = report(100);
    baseline.calibration = {
      benchmark: 'integer-mix-v1',
      samplesMs: [100],
      medianMs: 100,
      displayFrameIntervalSamplesMs: [16.7],
      displayFrameIntervalMedianMs: 16.7,
      estimatedDisplayRefreshHz: 1000 / 16.7,
    };
    const actual = report(120);
    actual.calibration = {
      benchmark: 'integer-mix-v1',
      samplesMs: [120],
      medianMs: 120,
      displayFrameIntervalSamplesMs: [16.7],
      displayFrameIntervalMedianMs: 16.7,
      estimatedDisplayRefreshHz: 1000 / 16.7,
    };

    const result = evaluatePerfBudgets({
      report: actual,
      baseline,
      scenarios: [PERF_SCENARIOS.small],
      maxRegressionRatio: 0.1,
    });

    expect(
      result.violations.filter(
        (violation) => violation.kind === 'regression' && violation.metric === 'loadMs',
      ),
    ).toEqual([]);
  });

  it('does not use display cadence to normalize a regression', () => {
    const baseline = report(100);
    baseline.calibration = {
      benchmark: 'integer-mix-v1',
      samplesMs: [100],
      medianMs: 100,
      displayFrameIntervalSamplesMs: [16.7],
      displayFrameIntervalMedianMs: 16.7,
      estimatedDisplayRefreshHz: 1000 / 16.7,
    };
    const actual = report(120);
    actual.calibration = {
      benchmark: 'integer-mix-v1',
      samplesMs: [100],
      medianMs: 100,
      displayFrameIntervalSamplesMs: [33.3],
      displayFrameIntervalMedianMs: 33.3,
      estimatedDisplayRefreshHz: 1000 / 33.3,
    };

    const result = evaluatePerfBudgets({
      report: actual,
      baseline,
      scenarios: [PERF_SCENARIOS.small],
      maxRegressionRatio: 0.1,
    });

    expect(result.violations).toContainEqual(
      expect.objectContaining({
        kind: 'regression',
        metric: 'loadMs',
        actual: 120,
        normalizedActual: 120,
      }),
    );
  });

  it('fails clearly when CI requires a missing baseline', () => {
    const result = evaluatePerfBudgets({
      report: report(100),
      scenarios: [PERF_SCENARIOS.small],
      maxRegressionRatio: 0.1,
      requireBaseline: true,
    });

    expect(result.status).toBe('fail');
    expect(result.violations).toContainEqual(
      expect.objectContaining({
        kind: 'baseline-missing',
      }),
    );
  });

  it('does not evaluate unavailable reports as passing', () => {
    const unavailable = createUnavailablePerfReport({
      generatedAt: '2026-07-28T12:00:00.000Z',
      protocol: PERF_PROTOCOL,
      scenarios: [PERF_SCENARIOS.small],
      reason: 'Google Chrome was not found.',
    });
    const result = evaluatePerfBudgets({
      report: unavailable,
      scenarios: [PERF_SCENARIOS.small],
      maxRegressionRatio: 0.1,
    });

    expect(result.status).toBe('unavailable');
    expect(result.violations).toEqual([]);
  });
});
