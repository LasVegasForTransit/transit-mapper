import { describe, expect, it } from 'vitest';
import { countPerfFixture, generatePerfFixture } from '../../src/perf/fixtures';

describe('performance fixtures', () => {
  it('generates the RTC-shaped fixture at the declared scale', () => {
    const fixture = generatePerfFixture('rtc');

    expect(countPerfFixture(fixture)).toEqual({
      ways: 3_800,
      points: 121_000,
      stations: 3_800,
      patterns: 285,
    });
  });

  it('generates every fixture deterministically', () => {
    for (const scenarioId of ['small', 'dense', 'rtc'] as const) {
      const first = generatePerfFixture(scenarioId);
      const second = generatePerfFixture(scenarioId);

      expect(second.id).toBe(first.id);
      expect(second.viewport).toEqual(first.viewport);
      expect(second.ways[137 % second.ways.length]).toEqual(first.ways[137 % first.ways.length]);
      expect(second.stations.at(-1)).toEqual(first.stations.at(-1));
      expect(second.services.at(-1)).toEqual(first.services.at(-1));
    }
  });

  it('centers the small fixture on its own deterministic geometry', () => {
    expect(generatePerfFixture('small').viewport.center).toEqual([-115.303, 36.026]);
  });

  it('keeps the smaller scenarios materially below agency scale', () => {
    const small = countPerfFixture(generatePerfFixture('small'));
    const dense = countPerfFixture(generatePerfFixture('dense'));
    const rtc = countPerfFixture(generatePerfFixture('rtc'));

    expect(small.ways).toBeLessThan(dense.ways);
    expect(dense.ways).toBeLessThan(rtc.ways);
    expect(small.points).toBeLessThan(dense.points);
    expect(dense.points).toBeLessThan(rtc.points);
  });
});
