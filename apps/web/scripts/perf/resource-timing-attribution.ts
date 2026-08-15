import type {
  PerfNetworkTarget,
  PerfResourceTimingAttribution,
} from '../../src/perf/network-byte-types';

const MAX_START_TIME_DIFFERENCE_MS = 250;

export interface ResourceTimingMatcher {
  match(
    url: string,
    startedAtMs: number,
    target: PerfNetworkTarget,
  ): PerfResourceTimingAttribution | undefined;
}

export function createResourceTimingMatcher(
  entries: readonly PerfResourceTimingAttribution[],
): ResourceTimingMatcher {
  const remaining = [...entries];
  return {
    match(url, startedAtMs, target) {
      if (target !== 'page' && target !== 'iframe') return undefined;
      let bestIndex = -1;
      let bestDifference = Number.POSITIVE_INFINITY;
      for (const [index, entry] of remaining.entries()) {
        if (entry.url !== url) continue;
        const difference = Math.abs(entry.startTimeMs - startedAtMs);
        if (difference < bestDifference) {
          bestIndex = index;
          bestDifference = difference;
        }
      }
      if (bestIndex < 0 || bestDifference > MAX_START_TIME_DIFFERENCE_MS) return undefined;
      return remaining.splice(bestIndex, 1)[0];
    },
  };
}
