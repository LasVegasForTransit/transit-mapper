import type {
  CreatePerfReportOptions,
  CreateUnavailablePerfReportOptions,
  PerfMetricName,
  PerfMetricSummary,
  PerfReport,
  PerfSample,
  PerfScenario,
  PerfScenarioSummary,
} from './types';

export const PERF_METRIC_NAMES: PerfMetricName[] = [
  'loadMs',
  'firstContentfulPaintMs',
  'largestContentfulPaintMs',
  'firstMapCanvasMs',
  'cumulativeLayoutShift',
  'longTaskTotalMs',
  'transferBytes',
  'inputToNextPaintP95Ms',
  'paintedFrameP95Ms',
  'paintedFramesOver33Ratio',
  'maxUnexpectedLongTaskMs',
  'warmLoadMs',
  'warmLargestContentfulPaintMs',
  'warmCumulativeLayoutShift',
  'warmInputToNextPaintP95Ms',
];

function percentile(sorted: number[], percentileValue: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1);
  return sorted[Math.min(index, sorted.length - 1)];
}

export function summarizeMetric(values: number[]): PerfMetricSummary {
  if (values.length === 0) {
    return {
      samples: 0,
      min: 0,
      median: 0,
      p95: 0,
      max: 0,
      variance: 0,
      standardDeviation: 0,
      coefficientOfVariation: 0,
    };
  }
  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error('Performance metrics must be finite, non-negative numbers.');
  }
  const sorted = [...values].sort((left, right) => left - right);
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const variance = sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / sorted.length;
  const standardDeviation = Math.sqrt(variance);
  return {
    samples: sorted.length,
    min: sorted[0],
    median: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted[sorted.length - 1],
    variance,
    standardDeviation,
    coefficientOfVariation: mean === 0 ? 0 : standardDeviation / mean,
  };
}

function metricValues(samples: PerfSample[], metric: PerfMetricName): number[] {
  return samples.map((sample) => sample.metrics[metric]);
}

function rawOrMetric(raw: number[], samples: PerfSample[], metric: PerfMetricName): number[] {
  return raw.length > 0 ? raw : metricValues(samples, metric);
}

function aggregateGateValues(
  samples: PerfSample[],
  metrics: Record<PerfMetricName, PerfMetricSummary>,
): Record<PerfMetricName, number> {
  const result = Object.fromEntries(
    PERF_METRIC_NAMES.map((metric) => [metric, metrics[metric].p95]),
  ) as Record<PerfMetricName, number>;
  const inputSamples = samples.flatMap((sample) => sample.gesture.inputToNextPaintMs);
  const paintedSamples = samples.flatMap((sample) => [
    ...sample.gesture.paintedFrameMs,
    ...sample.warmGesture.paintedFrameMs,
  ]);
  const unexpectedLongTasks = samples.flatMap((sample) => [
    ...sample.gesture.unexpectedLongTaskMs,
    ...sample.warmGesture.unexpectedLongTaskMs,
  ]);
  const warmInputSamples = samples.flatMap((sample) => sample.warmGesture.inputToNextPaintMs);

  result.inputToNextPaintP95Ms = summarizeMetric(
    rawOrMetric(inputSamples, samples, 'inputToNextPaintP95Ms'),
  ).p95;
  result.paintedFrameP95Ms = summarizeMetric(
    rawOrMetric(paintedSamples, samples, 'paintedFrameP95Ms'),
  ).p95;
  result.paintedFramesOver33Ratio =
    paintedSamples.length === 0
      ? metrics.paintedFramesOver33Ratio.max
      : paintedSamples.filter((duration) => duration > 33.3).length / paintedSamples.length;
  result.maxUnexpectedLongTaskMs =
    unexpectedLongTasks.length === 0
      ? metrics.maxUnexpectedLongTaskMs.max
      : Math.max(...unexpectedLongTasks);
  result.warmInputToNextPaintP95Ms = summarizeMetric(
    rawOrMetric(warmInputSamples, samples, 'warmInputToNextPaintP95Ms'),
  ).p95;
  return result;
}

function summarizeScenario(scenario: PerfScenario, samples: PerfSample[]): PerfScenarioSummary {
  const scenarioSamples = samples
    .filter((sample) => sample.scenarioId === scenario.id)
    .sort((left, right) => left.run - right.run);
  const metrics = Object.fromEntries(
    PERF_METRIC_NAMES.map((metric) => [
      metric,
      summarizeMetric(metricValues(scenarioSamples, metric)),
    ]),
  ) as Record<PerfMetricName, PerfMetricSummary>;

  return {
    scenarioId: scenario.id,
    label: scenario.label,
    fixture: scenario.fixture,
    metrics,
    gateValues: aggregateGateValues(scenarioSamples, metrics),
    persistence: {
      productionSampleCount: scenarioSamples.filter((sample) => sample.persistence.production)
        .length,
      productionSaveMs: summarizeMetric(
        scenarioSamples.flatMap((sample) =>
          sample.persistence.production ? [sample.persistence.production.saveMs] : [],
        ),
      ),
      productionWorkerSerializationMs: summarizeMetric(
        scenarioSamples.flatMap((sample) =>
          sample.persistence.production
            ? [sample.persistence.production.workerSerializationMs]
            : [],
        ),
      ),
      productionIndexedDbWriteMs: summarizeMetric(
        scenarioSamples.flatMap((sample) =>
          sample.persistence.production ? [sample.persistence.production.indexedDbWriteMs] : [],
        ),
      ),
      serializedBytes: Math.max(
        0,
        ...scenarioSamples.map((sample) => sample.persistence.serializedBytes),
      ),
      parseMs: summarizeMetric(scenarioSamples.map((sample) => sample.persistence.parseMs)),
      serializationMs: summarizeMetric(
        scenarioSamples.map((sample) => sample.persistence.serializationMs),
      ),
      localStorageWriteMs: summarizeMetric(
        scenarioSamples.map((sample) => sample.persistence.localStorageWriteMs),
      ),
      outcomes: {
        stored: scenarioSamples.filter(
          (sample) => sample.persistence.localStorageWriteOutcome === 'stored',
        ).length,
        'quota-exceeded': scenarioSamples.filter(
          (sample) => sample.persistence.localStorageWriteOutcome === 'quota-exceeded',
        ).length,
        unavailable: scenarioSamples.filter(
          (sample) => sample.persistence.localStorageWriteOutcome === 'unavailable',
        ).length,
      },
      recommendOffThreadSerialization: scenarioSamples.some(
        (sample) => sample.persistence.recommendOffThreadSerialization,
      ),
      recommendIndexedDb: scenarioSamples.some((sample) => sample.persistence.recommendIndexedDb),
    },
  };
}

function assertSamples(options: CreatePerfReportOptions): void {
  for (const scenario of options.scenarios) {
    const scenarioSamples = options.samples.filter((sample) => sample.scenarioId === scenario.id);
    if (scenarioSamples.length !== options.protocol.measuredRuns) {
      throw new Error(
        `${scenario.id} has ${scenarioSamples.length} measured samples; ` +
          `the protocol requires ${options.protocol.measuredRuns}.`,
      );
    }
  }
}

export function createPerfReport(options: CreatePerfReportOptions): PerfReport {
  assertSamples(options);
  const samples = [...options.samples].sort((left, right) => {
    const scenarioOrder = options.scenarios.findIndex(
      (scenario) => scenario.id === left.scenarioId,
    );
    const otherScenarioOrder = options.scenarios.findIndex(
      (scenario) => scenario.id === right.scenarioId,
    );
    return scenarioOrder - otherScenarioOrder || left.run - right.run;
  });

  return {
    schemaVersion: 3,
    generatedAt: options.generatedAt,
    status: 'ok',
    protocol: options.protocol,
    calibration: options.calibration,
    provenance: options.provenance,
    bundles: options.bundles ?? [],
    firstSessions: options.firstSessions ?? [],
    samples,
    scenarios: options.scenarios.map((scenario) => summarizeScenario(scenario, samples)),
  };
}

export function createUnavailablePerfReport(
  options: CreateUnavailablePerfReportOptions,
): PerfReport {
  return {
    schemaVersion: 3,
    generatedAt: options.generatedAt,
    status: 'unavailable',
    unavailableReason: options.reason,
    protocol: options.protocol,
    calibration: options.calibration,
    bundles: options.bundles ?? [],
    firstSessions: [],
    samples: [],
    scenarios: [],
  };
}
