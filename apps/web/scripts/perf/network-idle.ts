export interface NetworkActivityInterval {
  startedAtMs: number;
  completedAtMs: number | null;
}

interface FindNetworkIdleOptions {
  intervals: readonly NetworkActivityInterval[];
  notBeforeMs: number;
  boundaryMs: number;
  quietWindowMs: number;
}

/** Returns the first end of a complete all-target quiet window. Requests are
 * merged as intervals so overlap across pages, frames, and Workers cannot be
 * mistaken for separate idle periods. */
export function findNetworkIdleAt(options: FindNetworkIdleOptions): number | null {
  const intervals = options.intervals
    .map((interval) => ({
      start: Math.max(options.notBeforeMs, interval.startedAtMs),
      end: Math.min(options.boundaryMs, interval.completedAtMs ?? options.boundaryMs),
    }))
    .filter(
      (interval) => interval.end >= options.notBeforeMs && interval.start <= options.boundaryMs,
    )
    .sort((left, right) => left.start - right.start || left.end - right.end);
  let quietStart = options.notBeforeMs;
  for (const interval of intervals) {
    if (interval.end <= quietStart) continue;
    if (interval.start - quietStart >= options.quietWindowMs) {
      return quietStart + options.quietWindowMs;
    }
    quietStart = Math.max(quietStart, interval.end);
  }
  return options.boundaryMs - quietStart >= options.quietWindowMs
    ? quietStart + options.quietWindowMs
    : null;
}
