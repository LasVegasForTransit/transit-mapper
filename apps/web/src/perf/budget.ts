import { PERF_METRIC_NAMES } from './report';
import type {
  EvaluatePerfBudgetsOptions,
  PerfAbsoluteBudgets,
  PerfBundleEntry,
  PerfBudgetEvaluation,
  PerfBudgetViolation,
  PerfFirstSessionByteBudget,
  PerfFirstSessionSample,
  PerfMetricName,
  PerfProtocol,
  PerfReport,
} from './types';

function scenarioMetric(
  report: PerfReport,
  scenarioId: string,
  metric: PerfMetricName,
): number | undefined {
  return report.scenarios.find((scenario) => scenario.scenarioId === scenarioId)?.metrics[metric]
    .median;
}

function scenarioGateMetric(
  report: PerfReport,
  scenarioId: string,
  metric: PerfMetricName,
): number | undefined {
  const summary = report.scenarios.find((scenario) => scenario.scenarioId === scenarioId);
  return summary?.gateValues[metric] ?? summary?.metrics[metric].p95;
}

function absoluteLimit(budgets: PerfAbsoluteBudgets, metric: PerfMetricName): number | undefined {
  return budgets[metric];
}

function violatesAbsolute(metric: PerfMetricName, actual: number, limit: number): boolean {
  // The policy says fewer than 1% of frames, so equality is already outside
  // the budget. Every other upper bound is inclusive.
  if (metric === 'paintedFramesOver33Ratio') return actual >= limit;
  return actual > limit;
}

function absoluteViolations(options: EvaluatePerfBudgetsOptions): PerfBudgetViolation[] {
  const violations: PerfBudgetViolation[] = [];
  for (const scenario of options.scenarios) {
    for (const metric of PERF_METRIC_NAMES) {
      const actual = scenarioGateMetric(options.report, scenario.id, metric);
      const limit = absoluteLimit(scenario.absoluteBudgets, metric);
      if (actual !== undefined && limit !== undefined && violatesAbsolute(metric, actual, limit)) {
        violations.push({
          kind: 'absolute',
          scenarioId: scenario.id,
          metric,
          actual,
          limit,
          message: `${scenario.id} ${metric} is ${actual}; the absolute budget is ${limit}.`,
        });
      }
    }
  }
  return violations;
}

const CALIBRATED_DURATION_METRICS = new Set<PerfMetricName>([
  'loadMs',
  'firstContentfulPaintMs',
  'largestContentfulPaintMs',
  'firstMapCanvasMs',
  'longTaskTotalMs',
  'inputToNextPaintP95Ms',
  'paintedFrameP95Ms',
  'maxUnexpectedLongTaskMs',
  'warmLoadMs',
  'warmLargestContentfulPaintMs',
  'warmInputToNextPaintP95Ms',
]);

function normalizeForCalibration(
  actual: number,
  metric: PerfMetricName,
  report: PerfReport,
  baseline: PerfReport,
): number {
  const currentCalibration = report.calibration?.medianMs;
  const baselineCalibration = baseline.calibration?.medianMs;
  if (!CALIBRATED_DURATION_METRICS.has(metric) || !currentCalibration || !baselineCalibration) {
    return actual;
  }
  return actual * (baselineCalibration / currentCalibration);
}

function regressionViolations(options: EvaluatePerfBudgetsOptions): PerfBudgetViolation[] {
  if (options.baseline?.status !== 'ok') return [];
  const violations: PerfBudgetViolation[] = [];

  for (const scenario of options.scenarios) {
    for (const metric of PERF_METRIC_NAMES) {
      const actual = scenarioMetric(options.report, scenario.id, metric);
      const baseline = scenarioMetric(options.baseline, scenario.id, metric);
      if (actual === undefined || baseline === undefined) continue;
      const normalizedActual = normalizeForCalibration(
        actual,
        metric,
        options.report,
        options.baseline,
      );
      const limit = Number((baseline + baseline * options.maxRegressionRatio).toPrecision(12));
      const tolerance = Number.EPSILON * Math.max(1, Math.abs(limit)) * 8;
      if (normalizedActual - limit > tolerance) {
        violations.push({
          kind: 'regression',
          scenarioId: scenario.id,
          metric,
          actual,
          normalizedActual,
          baseline,
          limit,
          message:
            `${scenario.id} ${metric} regressed from ${baseline} to ${actual}` +
            (normalizedActual === actual ? '' : ` (${normalizedActual} after calibration)`) +
            '; ' +
            `the ${options.maxRegressionRatio * 100}% limit is ${limit}.`,
        });
      }
    }
  }
  return violations;
}

type DeliveredBundleEncoding = 'gzip' | 'brotli';

function bundleValue(entry: PerfBundleEntry, encoding: DeliveredBundleEncoding): number {
  if (encoding === 'gzip') return entry.gzipBytes;
  return entry.brotliBytes;
}

function bundleRegressionViolations(
  report: PerfReport,
  baseline: PerfReport,
  maxRegressionRatio: number,
): PerfBudgetViolation[] {
  const violations: PerfBudgetViolation[] = [];
  const encodings: DeliveredBundleEncoding[] = ['gzip', 'brotli'];

  for (const entry of report.bundles) {
    const baselineEntry = baseline.bundles.find((candidate) => candidate.entry === entry.entry);
    if (!baselineEntry) continue;
    for (const encoding of encodings) {
      const actual = bundleValue(entry, encoding);
      const baselineValue = bundleValue(baselineEntry, encoding);
      const limit = Number((baselineValue + baselineValue * maxRegressionRatio).toPrecision(12));
      if (actual <= limit) continue;
      violations.push({
        kind: 'bundle-regression',
        bundleEntry: entry.entry,
        bundleEncoding: encoding,
        actual,
        baseline: baselineValue,
        limit,
        message:
          `${entry.entry} ${encoding} bundle regressed from ${baselineValue} to ${actual} bytes; ` +
          `the ${maxRegressionRatio * 100}% limit is ${limit} bytes.`,
      });
    }
  }
  return violations;
}

function firstSessionSettlementViolations(report: PerfReport): PerfBudgetViolation[] {
  return report.firstSessions
    .filter((sample) => !sample.network.settled)
    .map((sample) => ({
      kind: 'first-session-unsettled',
      firstSessionJourney: sample.journey,
      actual: sample.network.unsettledNonMapRequestCount,
      limit: 0,
      message:
        `${sample.journey} still had ${sample.network.unsettledNonMapRequestCount} ` +
        'automatic non-map request(s) at or after the 60-second boundary.',
    }));
}

function matchingFirstSession(
  report: PerfReport,
  budget: PerfFirstSessionByteBudget,
): PerfFirstSessionSample | undefined {
  return report.firstSessions.find(
    (sample) => sample.journey === budget.journey && sample.cacheState === budget.cacheState,
  );
}

function firstSessionLimit(value: number, ratio: number, direction: 'reduce' | 'grow'): number {
  const multiplier = direction === 'reduce' ? 1 - ratio : 1 + ratio;
  return Number((value * multiplier).toPrecision(12));
}

function missingFirstSessionViolation(
  budget: PerfFirstSessionByteBudget,
  missing: 'candidate' | 'baseline',
): PerfBudgetViolation {
  return {
    kind: 'first-session-sample-missing',
    firstSessionJourney: budget.journey,
    firstSessionCacheState: budget.cacheState,
    message:
      `The ${missing} report has no ${budget.cacheState} ${budget.journey} ` +
      'automatic-byte sample required by policy.',
  };
}

function firstSessionByteViolations(
  report: PerfReport,
  baseline: PerfReport,
  budgets: readonly PerfFirstSessionByteBudget[],
): PerfBudgetViolation[] {
  const violations: PerfBudgetViolation[] = [];
  for (const budget of budgets) {
    const sample = matchingFirstSession(report, budget);
    const baselineSample = matchingFirstSession(baseline, budget);
    if (!sample) {
      violations.push(missingFirstSessionViolation(budget, 'candidate'));
      continue;
    }
    if (!baselineSample) {
      violations.push(missingFirstSessionViolation(budget, 'baseline'));
      continue;
    }

    const actual = sample.network.total.total.encodedBytes;
    const baselineBytes = baselineSample.network.total.total.encodedBytes;
    if (budget.minimumReductionRatio !== undefined) {
      const limit = firstSessionLimit(baselineBytes, budget.minimumReductionRatio, 'reduce');
      if (actual > limit) {
        violations.push({
          kind: 'first-session-byte-target',
          firstSessionJourney: budget.journey,
          firstSessionCacheState: budget.cacheState,
          actual,
          baseline: baselineBytes,
          limit,
          message:
            `${budget.journey} delivered ${actual} automatic encoded bytes; the required ` +
            `${budget.minimumReductionRatio * 100}% reduction from ${baselineBytes} permits ` +
            `at most ${limit} bytes.`,
        });
      }
    }
    if (budget.maximumRegressionRatio !== undefined) {
      const limit = firstSessionLimit(baselineBytes, budget.maximumRegressionRatio, 'grow');
      if (actual > limit) {
        violations.push({
          kind: 'first-session-byte-regression',
          firstSessionJourney: budget.journey,
          firstSessionCacheState: budget.cacheState,
          actual,
          baseline: baselineBytes,
          limit,
          message:
            `${budget.journey} delivered ${actual} automatic encoded bytes, above the ` +
            `${budget.maximumRegressionRatio * 100}% regression limit of ${limit} bytes ` +
            `from the ${baselineBytes}-byte baseline.`,
        });
      }
    }
  }
  return violations;
}

function protocolValues(protocol: PerfProtocol): unknown[] {
  return [
    protocol.profile,
    protocol.browser,
    protocol.browserChannel,
    protocol.headed,
    protocol.cpuThrottlingRate,
    protocol.cache,
    protocol.viewport.width,
    protocol.viewport.height,
    protocol.viewport.deviceScaleFactor,
    protocol.network.name,
    protocol.network.downloadThroughputBytesPerSecond,
    protocol.network.uploadThroughputBytesPerSecond,
    protocol.network.latencyMs,
    protocol.warmupRuns,
    protocol.measuredRuns,
    protocol.warmReloadsPerMeasuredRun,
  ];
}

function protocolsMatch(report: PerfReport, baseline: PerfReport): boolean {
  const frozen = protocolValues(baseline.protocol);
  return protocolValues(report.protocol).every((value, index) => value === frozen[index]);
}

export function evaluatePerfBudgets(options: EvaluatePerfBudgetsOptions): PerfBudgetEvaluation {
  if (options.report.status === 'unavailable') {
    return {
      status: 'unavailable',
      violations: [],
      notices: [options.report.unavailableReason ?? 'The performance run is unavailable.'],
    };
  }

  const firstSessionViolations = firstSessionSettlementViolations(options.report);
  if (options.enforceNumericBudgets === false) {
    return {
      status: firstSessionViolations.length === 0 ? 'pass' : 'fail',
      violations: firstSessionViolations,
      notices: [
        'Smoke mode proves the production build and browser journey; numeric budgets require a full audit.',
      ],
    };
  }

  const violations = [...firstSessionViolations, ...absoluteViolations(options)];
  const notices: string[] = [];
  if (options.baseline?.status !== 'ok') {
    if (options.requireBaseline) {
      violations.push({
        kind: 'baseline-missing',
        message: 'A valid baseline report is required but was not provided.',
      });
    } else {
      notices.push('No baseline report was provided; only absolute budgets were evaluated.');
    }
  } else if (!protocolsMatch(options.report, options.baseline)) {
    violations.push({
      kind: 'baseline-incompatible',
      message:
        `The candidate ${options.report.protocol.profile} protocol does not match the frozen ` +
        `${options.baseline.protocol.profile} protocol; unlike evidence cannot be compared.`,
    });
  } else {
    violations.push(
      ...firstSessionByteViolations(
        options.report,
        options.baseline,
        options.firstSessionBudgets ?? [],
      ),
    );
    violations.push(...regressionViolations(options));
    violations.push(
      ...bundleRegressionViolations(options.report, options.baseline, options.maxRegressionRatio),
    );
  }

  return {
    status: violations.length === 0 ? 'pass' : 'fail',
    violations,
    notices,
  };
}
