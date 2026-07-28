// Development/performance-build instrumentation. Ordinary production builds
// compile out the harness at the MapCanvas boundary (see perf/index.ts).

/** Summary of a set of frame durations (milliseconds between painted frames). */
export interface FrameStats {
  samples: number;
  fps: number; // derived from the MEDIAN frame time (steady-state feel, not the mean)
  medianMs: number;
  p95Ms: number;
  worstMs: number;
  meanMs: number;
  /** Fraction of frames slower than one 60Hz budget (16.7ms) and one 30Hz budget (33.3ms). */
  pctOver16: number;
  pctOver33: number;
}

const FRAME_60HZ_MS = 1000 / 60;
const FRAME_30HZ_MS = 1000 / 30;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[idx];
}

/** Reduce raw frame durations to a FrameStats summary. Pure — the same shape
 *  the overlay and the scripted pan benchmark both report, so before/after
 *  numbers are directly comparable. */
export function summarizeFrames(durations: number[]): FrameStats {
  const n = durations.length;
  if (n === 0) {
    return {
      samples: 0,
      fps: 0,
      medianMs: 0,
      p95Ms: 0,
      worstMs: 0,
      meanMs: 0,
      pctOver16: 0,
      pctOver33: 0,
    };
  }
  const sorted = [...durations].sort((a, b) => a - b);
  const median = percentile(sorted, 50);
  const sum = durations.reduce((acc, d) => acc + d, 0);
  return {
    samples: n,
    fps: median > 0 ? 1000 / median : 0,
    medianMs: median,
    p95Ms: percentile(sorted, 95),
    worstMs: sorted[sorted.length - 1],
    meanMs: sum / n,
    pctOver16: durations.filter((d) => d > FRAME_60HZ_MS).length / n,
    pctOver33: durations.filter((d) => d > FRAME_30HZ_MS).length / n,
  };
}

/** Compact one-line rendering of a FrameStats, for the overlay and console. */
export function formatFrameStats(s: FrameStats): string {
  if (s.samples === 0) return 'no frames';
  return `${s.fps.toFixed(0)} fps  •  med ${s.medianMs.toFixed(1)}ms  p95 ${s.p95Ms.toFixed(1)}ms  worst ${s.worstMs.toFixed(1)}ms  •  >16ms ${(s.pctOver16 * 100).toFixed(0)}%  •  n=${s.samples}`;
}
