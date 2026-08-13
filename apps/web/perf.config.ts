import type { BundleBudget } from './src/perf/bundleBudget';
import { createPerfProtocol, PERF_PROTOCOL, PERF_SCENARIO_LIST } from './src/perf/scenarios';

export { createPerfProtocol, PERF_PROTOCOL, PERF_SCENARIO_LIST };

export const PERF_MAX_REGRESSION_RATIO = 0.1;
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
    // Stop and Station are now separate editing surfaces across the outline,
    // inspector, and gestures. Shared row rendering keeps the measured main
    // delta to 0.24%; this remains a sub-0.5% delivery-ceiling adjustment.
    maximumGzipBytes: 518_144,
    maximumBrotliBytes: 450_560,
  },
  {
    entry: 'embed',
    maximumGzipBytes: 358_400,
    maximumBrotliBytes: 307_200,
  },
];
