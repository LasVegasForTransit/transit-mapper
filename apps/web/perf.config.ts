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
];
