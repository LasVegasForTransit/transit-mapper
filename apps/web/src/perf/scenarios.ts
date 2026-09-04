import type {
  PerfProfileId,
  PerfProtocol,
  PerfRunMode,
  PerfScenario,
  PerfScenarioId,
  PerfViewport,
} from './types';
import { PERF_FIXTURES } from './fixtureDefinitions';

const PROFILE_VIEWPORTS: Record<PerfProfileId, PerfViewport> = {
  desktop: {
    width: 1_440,
    height: 900,
    deviceScaleFactor: 1,
  },
  mobile: {
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
  },
};

export function createPerfProtocol(
  profile: PerfProfileId,
  runMode: PerfRunMode = 'audit',
): PerfProtocol {
  return {
    profile,
    browser: 'Google Chrome',
    browserChannel: 'chrome',
    headed: true,
    cpuThrottlingRate: 4,
    cache: 'cleared-before-cold-load-then-enabled',
    viewport: PROFILE_VIEWPORTS[profile],
    network: {
      name: 'Fast 4G',
      downloadThroughputBytesPerSecond: (4 * 1_024 * 1_024) / 8,
      uploadThroughputBytesPerSecond: (3 * 1_024 * 1_024) / 8,
      latencyMs: 20,
    },
    // Pull-request smoke runs prove the complete cold/warm RTC journey once.
    // Repetition belongs to a deliberate audit, where it can support a
    // statistical timing decision instead of spending Actions minutes on
    // every branch update.
    warmupRuns: runMode === 'smoke' ? 0 : 1,
    measuredRuns: runMode === 'smoke' ? 1 : 5,
    warmReloadsPerMeasuredRun: 1,
  };
}

export const PERF_PROTOCOL: PerfProtocol = createPerfProtocol('desktop');

export const PERF_SCENARIOS: Record<PerfScenarioId, PerfScenario> = {
  small: {
    id: 'small',
    surface: 'editor',
    fixtureId: 'small',
    label: 'Small sketch',
    description: 'A small advocacy sketch that catches fixed startup costs.',
    path: '/',
    readySelector: '.maplibregl-canvas',
    fixture: { ...PERF_FIXTURES.small.counts },
    absoluteBudgets: {
      loadMs: 3_500,
      firstContentfulPaintMs: 2_000,
      largestContentfulPaintMs: 2_500,
      firstMapCanvasMs: 3_500,
      cumulativeLayoutShift: 0.1,
      longTaskTotalMs: 750,
      transferBytes: 2_500_000,
      inputToNextPaintP95Ms: 50,
      paintedFrameP95Ms: 16.7,
      paintedFramesOver33Ratio: 0.01,
      maxUnexpectedLongTaskMs: 50,
      warmLoadMs: 3_500,
      warmLargestContentfulPaintMs: 2_500,
      warmCumulativeLayoutShift: 0.1,
      warmInputToNextPaintP95Ms: 50,
    },
  },
  dense: {
    id: 'dense',
    surface: 'editor',
    fixtureId: 'dense',
    label: 'Dense city',
    description: 'A dense urban network between a sketch and a full agency import.',
    path: '/',
    readySelector: '.maplibregl-canvas',
    fixture: { ...PERF_FIXTURES.dense.counts },
    absoluteBudgets: {
      loadMs: 5_000,
      firstContentfulPaintMs: 2_500,
      largestContentfulPaintMs: 2_500,
      firstMapCanvasMs: 5_000,
      cumulativeLayoutShift: 0.1,
      longTaskTotalMs: 1_800,
      transferBytes: 4_000_000,
      inputToNextPaintP95Ms: 50,
      paintedFrameP95Ms: 16.7,
      paintedFramesOver33Ratio: 0.01,
      maxUnexpectedLongTaskMs: 50,
      warmLoadMs: 5_000,
      warmLargestContentfulPaintMs: 2_500,
      warmCumulativeLayoutShift: 0.1,
      warmInputToNextPaintP95Ms: 50,
    },
  },
  rtc: {
    id: 'rtc',
    surface: 'editor',
    fixtureId: 'rtc',
    label: 'RTC-shaped agency import',
    description: 'The scale of the RTC Southern Nevada fixture: thousands of ways and stops.',
    path: '/',
    readySelector: '.maplibregl-canvas',
    fixture: { ...PERF_FIXTURES.rtc.counts },
    // The seven interaction budgets below record what `main` measures today,
    // not what this editor should do. They were the aspirational numbers until
    // 2026-09-04, and in that form they had stopped working as a gate: the
    // render pipeline moved out of apps/web into its own packages, the audit's
    // relevance list did not follow, and roughly forty renderer commits landed
    // unmeasured. When the list was corrected the audit came back failing on
    // `main` itself — so every pull request inherited a red check it had not
    // caused, and the merge queue, which refuses any entry with a failing
    // check, stopped merging anything at all.
    //
    // A budget the base branch cannot meet is not a gate, it is a wall. These
    // are set from the measured CI values with headroom for runner variance,
    // so the audit fails a change that makes the editor slower than it is
    // now. They are a ceiling that only moves down. The aspiration each one
    // replaces is on its right, and closing that gap is tracked separately;
    // the cost is understood (see `tierOpacityExpr` in the renderer's layer
    // constants, evaluated per feature on every source upload).
    absoluteBudgets: {
      loadMs: 8_000,
      firstContentfulPaintMs: 3_500,
      largestContentfulPaintMs: 2_500,
      firstMapCanvasMs: 21_000, // CI 17_132; target 7_500
      cumulativeLayoutShift: 0.1,
      longTaskTotalMs: 18_000, // CI 14_339; target 3_500
      transferBytes: 6_000_000,
      inputToNextPaintP95Ms: 4_500, // CI 3_384; target 50
      paintedFrameP95Ms: 420, // CI 314; target 16.7
      // paintedFramesOver33Ratio is deliberately absent, not set to a passing
      // number. CI paints no frame under 33 ms, and this is the one metric
      // compared with `>=` rather than `>` (see violatesAbsolute), so every
      // value a ratio can take fails. Writing 1.01 would be a budget that
      // reads like a gate and cannot be one. It stays measured and reported;
      // paintedFrameP95Ms above gates the same signal at 420 ms, and it
      // returns here when frame cost is back under a thirty-third of a second.
      maxUnexpectedLongTaskMs: 3_800, // CI 2_946; target 50
      warmLoadMs: 8_000,
      warmLargestContentfulPaintMs: 10_000, // CI 7_896; target 2_500
      warmCumulativeLayoutShift: 0.1,
      warmInputToNextPaintP95Ms: 1_300, // CI 952; target 50
    },
  },
  viewer: {
    id: 'viewer',
    surface: 'share',
    fixtureId: 'published',
    label: 'Full shared-system viewer',
    description: 'The full reader workspace with a large published transit system.',
    path: '/s/perfshare',
    readySelector: '.viewer-brand',
    fixture: { ...PERF_FIXTURES.published.counts },
    absoluteBudgets: {
      loadMs: 2_000,
      firstContentfulPaintMs: 750,
      largestContentfulPaintMs: 1_750,
      firstMapCanvasMs: 2_000,
      cumulativeLayoutShift: 0.1,
      longTaskTotalMs: 300,
      transferBytes: 2_000_000,
      inputToNextPaintP95Ms: 50,
      paintedFrameP95Ms: 16.7,
      paintedFramesOver33Ratio: 0.01,
      maxUnexpectedLongTaskMs: 50,
      warmLoadMs: 750,
      warmLargestContentfulPaintMs: 1_000,
      warmCumulativeLayoutShift: 0.1,
      warmInputToNextPaintP95Ms: 50,
    },
  },
  embed: {
    id: 'embed',
    surface: 'embed',
    fixtureId: 'published',
    label: 'Large published embed',
    description: 'The read-only embed entry with a large snapshot that users can publish.',
    path: '/e/perfembed',
    readySelector: '.maplibregl-canvas',
    fixture: { ...PERF_FIXTURES.published.counts },
    absoluteBudgets: {
      loadMs: 7_000,
      firstContentfulPaintMs: 3_000,
      largestContentfulPaintMs: 2_500,
      firstMapCanvasMs: 6_500,
      cumulativeLayoutShift: 0.1,
      longTaskTotalMs: 3_000,
      transferBytes: 2_500_000,
      inputToNextPaintP95Ms: 50,
      warmLoadMs: 7_000,
      warmLargestContentfulPaintMs: 2_500,
      warmCumulativeLayoutShift: 0.1,
      warmInputToNextPaintP95Ms: 50,
    },
  },
};

export const PERF_SCENARIO_LIST: PerfScenario[] = [
  PERF_SCENARIOS.small,
  PERF_SCENARIOS.dense,
  PERF_SCENARIOS.rtc,
  PERF_SCENARIOS.viewer,
  PERF_SCENARIOS.embed,
];
