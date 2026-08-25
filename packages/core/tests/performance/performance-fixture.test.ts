import { describe, expect, it } from 'vitest';
import {
  countPerformanceFixture,
  generatePerformanceFixture,
  type PerformanceFixtureOptions,
} from '../../src/performance-fixture';

const OPTIONS: PerformanceFixtureOptions = {
  id: 'test-grid',
  label: 'Test grid',
  counts: { ways: 4, points: 12, stops: 6, patterns: 3 },
  zoom: 11,
};

describe('performance fixture generation', () => {
  it('builds the requested deterministic document shape', () => {
    const first = generatePerformanceFixture(OPTIONS);
    const second = generatePerformanceFixture(OPTIONS);

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      id: 'perf-test-grid',
      name: 'Performance fixture: Test grid',
      viewport: { center: [-115.30825, 36.0215], zoom: 11 },
    });
    expect(countPerformanceFixture(first)).toEqual(OPTIONS.counts);
    expect(first.ways.map((way) => way.id)).toEqual([
      'test-grid-way-0000',
      'test-grid-way-0001',
      'test-grid-way-0002',
      'test-grid-way-0003',
    ]);
    expect(first.ways.every((way) => way.points.length === 3)).toBe(true);
    expect(first.stops.map((stop) => stop.anchors[0]?.wayId)).toEqual([
      'test-grid-way-0000',
      'test-grid-way-0001',
      'test-grid-way-0002',
      'test-grid-way-0003',
      'test-grid-way-0000',
      'test-grid-way-0001',
    ]);
    expect(first.lines.map((line) => line.serviceIds)).toEqual([
      ['test-grid-service-000'],
      ['test-grid-service-001'],
      ['test-grid-service-002'],
    ]);
  });

  it('distributes remainder points without changing the requested total', () => {
    const system = generatePerformanceFixture({
      ...OPTIONS,
      counts: { ...OPTIONS.counts, points: 14 },
    });

    expect(system.ways.map((way) => way.points.length)).toEqual([4, 4, 3, 3]);
    expect(countPerformanceFixture(system).points).toBe(14);
  });
});
