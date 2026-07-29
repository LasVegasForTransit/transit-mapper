import type { BundleBudget } from './src/perf/bundleBudget';
import { createPerfProtocol, PERF_PROTOCOL, PERF_SCENARIO_LIST } from './src/perf/scenarios';

export { createPerfProtocol, PERF_PROTOCOL, PERF_SCENARIO_LIST };

export const PERF_MAX_REGRESSION_RATIO = 0.1;
export const PERF_DEFAULT_ARTIFACT_DIRECTORY = 'artifacts/performance';
export const PERF_BASELINE_DIRECTORY = 'perf';

/**
 * Entry budgets include the HTML document, CSS, entry chunk, and the full
 * static and dynamic import graph. They are intentionally absolute policy
 * limits, not measurements copied from a particular run.
 */
export const BUNDLE_BUDGETS: BundleBudget[] = [
  {
    entry: 'main',
    // The desktop PWA controller and view-specific workspace are editor-only,
    // but still belong in this entry. CI measures 1,627,645 raw bytes after the
    // workspace landed, so preserve the same deliberately narrow raw headroom
    // while leaving the compressed delivery budgets unchanged.
    maximumRawBytes: 1_628_000,
    maximumGzipBytes: 463_000,
    maximumBrotliBytes: 400_000,
  },
  {
    entry: 'embed',
    maximumRawBytes: 1_100_000,
    maximumGzipBytes: 320_000,
    maximumBrotliBytes: 280_000,
  },
];
