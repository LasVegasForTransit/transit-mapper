import {
  countPerformanceFixture,
  generatePerformanceFixture,
} from '@transitmapper/core/performance-fixture';
import type { TransitSystem } from '@transitmapper/core/model/system';
import { PERF_FIXTURES } from './fixtureDefinitions';
import type { PerfFixtureCounts, PerfFixtureId } from './types';

/**
 * Builds synthetic documents with stable identifiers and geometry. Real agency
 * data cannot be committed to the benchmark, and random data makes two runs
 * incomparable, so scale is the variable while content stays fixed.
 */
export function generatePerfFixture(scenarioId: PerfFixtureId): TransitSystem {
  const definition = PERF_FIXTURES[scenarioId];
  return generatePerformanceFixture({
    id: scenarioId,
    label: definition.label,
    counts: definition.counts,
    zoom: scenarioId === 'small' ? 12 : 10,
  });
}

export function countPerfFixture(system: TransitSystem): PerfFixtureCounts {
  return countPerformanceFixture(system);
}
