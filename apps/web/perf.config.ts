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
    // Renderer work must displace obsolete editor work or move behind an
    // already-loaded worker boundary. Increasing this limit would hide a
    // delivery regression from people opening the editor on real networks.
    maximumGzipBytes: 518_144,
    maximumBrotliBytes: 450_560,
  },
  {
    entry: 'embed',
    maximumGzipBytes: 358_400,
    maximumBrotliBytes: 307_200,
  },
];
