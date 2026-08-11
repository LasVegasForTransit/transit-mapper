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
    // My systems adds an explicit switcher plus optional visual map cards.
    // Preview drawing stays in the existing Worker; this <1% adjustment is
    // the deliberate delivery allowance for the remaining interactive UI.
    maximumGzipBytes: 516_000,
    maximumBrotliBytes: 450_560,
  },
  {
    entry: 'embed',
    maximumGzipBytes: 358_400,
    maximumBrotliBytes: 307_200,
  },
];
