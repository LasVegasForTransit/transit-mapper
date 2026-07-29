import type { PerfFixtureCounts, PerfFixtureId } from './types';

export interface PerfFixtureDefinition {
  label: string;
  counts: PerfFixtureCounts;
}

/** Stable synthetic scales shared by fixture generation and scenario reports.
 *
 * Public surfaces use `published`, not the RTC editor fixture: production
 * refuses share requests above 1 MB, so an agency-scale public snapshot would
 * describe a state users cannot create. The published fixture deliberately
 * leaves room for ordinary model growth beneath that contract. */
export const PERF_FIXTURES: Record<PerfFixtureId, PerfFixtureDefinition> = {
  small: {
    label: 'Small sketch',
    counts: {
      ways: 24,
      points: 240,
      stations: 30,
      patterns: 6,
    },
  },
  dense: {
    label: 'Dense city',
    counts: {
      ways: 600,
      points: 18_000,
      stations: 800,
      patterns: 60,
    },
  },
  published: {
    label: 'Large published system',
    counts: {
      ways: 450,
      points: 13_500,
      stations: 600,
      patterns: 45,
    },
  },
  rtc: {
    label: 'RTC-shaped agency import',
    counts: {
      ways: 3_800,
      points: 121_000,
      stations: 3_800,
      patterns: 285,
    },
  },
};
