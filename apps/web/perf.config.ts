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
 * Entry budgets include the HTML document, CSS, entry chunk, and the full
 * static and dynamic import graph. Raw bytes remain visible in the report,
 * but only compressed delivery size is an absolute gate. Browser audits own
 * parse and responsiveness costs; raw module size is not a product ceiling.
 */
export const BUNDLE_BUDGETS: BundleBudget[] = [
  {
    entry: 'main',
    // One intentional recalibration for the screen-space renderer foundation:
    // cooperative preparation, stable scene diffs, and source recovery now
    // ship in the editor. Major metric-mesh and Diagram work remains Worker-
    // owned and must not consume this round delivery ceiling.
    maximumGzipBytes: 550 * 1_024,
    maximumBrotliBytes: 470 * 1_024,
  },
  {
    entry: 'embed',
    maximumGzipBytes: 358_400,
    maximumBrotliBytes: 307_200,
  },
];
