import { PERF_METRIC_NAMES } from './report';
import type {
  EvaluatePerfBudgetsOptions,
  PerfAbsoluteBudgets,
  PerfBundleEntry,
  PerfBudgetEvaluation,
  PerfBudgetViolation,
  PerfMetricName,
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
  return summary?.gateValues?.[metric] ?? summary?.metrics[metric].p95;
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
  if (!options.baseline || options.baseline.status !== 'ok') return [];
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

type BundleEncoding = 'raw' | 'gzip' | 'brotli';

function bundleValue(entry: PerfBundleEntry, encoding: BundleEncoding): number {
  if (encoding === 'raw') return entry.rawBytes;
  if (encoding === 'gzip') return entry.gzipBytes;
  return entry.brotliBytes;
}

function bundleRegressionViolations(
  report: PerfReport,
  baseline: PerfReport,
  maxRegressionRatio: number,
): PerfBudgetViolation[] {
  const violations: PerfBudgetViolation[] = [];
  const encodings: BundleEncoding[] = ['raw', 'gzip', 'brotli'];

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

export function evaluatePerfBudgets(options: EvaluatePerfBudgetsOptions): PerfBudgetEvaluation {
  if (options.report.status === 'unavailable') {
    return {
      status: 'unavailable',
      violations: [],
      notices: [options.report.unavailableReason ?? 'The performance run is unavailable.'],
    };
  }

  const violations = absoluteViolations(options);
  const notices: string[] = [];
  if (!options.baseline || options.baseline.status !== 'ok') {
    if (options.requireBaseline) {
      violations.push({
        kind: 'baseline-missing',
        message: 'A valid baseline report is required but was not provided.',
      });
    } else {
      notices.push('No baseline report was provided; only absolute budgets were evaluated.');
    }
  } else {
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
