import type { BundleBudget } from './src/perf/bundleBudget';
import type { PerfFirstSessionByteBudget } from './src/perf/types';
import { createPerfProtocol, PERF_PROTOCOL, PERF_SCENARIO_LIST } from './src/perf/scenarios';

export { createPerfProtocol, PERF_PROTOCOL, PERF_SCENARIO_LIST };

export const PERF_MAX_REGRESSION_RATIO = 0.1;
export const PERF_FIRST_SESSION_BYTE_BUDGETS: readonly PerfFirstSessionByteBudget[] = [
  {
    journey: 'new-user-editor',
    cacheState: 'cold',
    minimumReductionRatio: 0.3,
  },
  {
    journey: 'public-share',
    cacheState: 'cold',
    maximumRegressionRatio: 0,
  },
  {
    journey: 'cross-site-embed',
    cacheState: 'cold',
    maximumRegressionRatio: 0,
  },
];
export const PERF_DEFAULT_ARTIFACT_DIRECTORY = 'artifacts/performance';
export const PERF_BASELINE_DIRECTORY = 'perf';

/**
 * Entry budgets cover the HTML document, CSS, and static module closure that
 * a first load transfers before a person can act. Lazy features have their
 * own chunk ceilings and browser transfer audits. Counting their entire
 * graph here would reject code that the first load never fetches.
 */
export const BUNDLE_BUDGETS: BundleBudget[] = [
  {
    entry: 'main',
    // The real-geography onboarding and its five production-UI scenes remain
    // in one lazy first-run chunk. Their committed map context raises the full
    // gzip import graph by 10.7 KiB; 520 KiB is a 2.8% ceiling adjustment. The
    // Brotli ceiling stays fixed because that delivery size remains below it.
    maximumGzipBytes: 532_480,
    maximumBrotliBytes: 450_560,
  },
  {
    entry: 'embed',
    maximumGzipBytes: 358_400,
    maximumBrotliBytes: 307_200,
  },
  {
    entry: 'viewer',
    maximumGzipBytes: 307_200,
    maximumBrotliBytes: 256_000,
  },
];
