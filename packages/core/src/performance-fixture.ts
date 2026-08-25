import { defaultProfileFor } from './model/profile';
import { createEmptySystem } from './model/serialize';
import type { LngLat, Pattern, Service, Stop, TransitSystem, Way } from './model/system';

export interface PerformanceFixtureCounts {
  ways: number;
  points: number;
  stops: number;
  patterns: number;
}

export interface PerformanceFixtureOptions {
  id: string;
  label: string;
  counts: PerformanceFixtureCounts;
  zoom: number;
}

const FIXTURE_COLORS = ['#e4572e', '#17bebb', '#ffc914', '#2e282a', '#76b041', '#5c4d7d'] as const;

const ROAD_PROFILE = {
  lanes: defaultProfileFor('road').lanes.map((lane, laneIndex) => ({
    ...lane,
    // Stable lane ids keep repeated benchmark runs byte-for-byte comparable.
    id: `perf-lane-${laneIndex}`,
  })),
};

function rounded(value: number): number {
  return Number(value.toFixed(6));
}

function fixtureCenter(wayCount: number): LngLat {
  const columns = Math.ceil(Math.sqrt(wayCount));
  const rows = Math.ceil(wayCount / columns);
  return [
    rounded(-115.31 + ((columns - 1) * 0.0035) / 2),
    rounded(36.02 + ((rows - 1) * 0.003) / 2),
  ];
}

function allocatedCount(total: number, buckets: number, index: number): number {
  const floor = Math.floor(total / buckets);
  return floor + (index < total % buckets ? 1 : 0);
}

function wayPoints(wayIndex: number, pointCount: number, wayCount: number): LngLat[] {
  const columns = Math.ceil(Math.sqrt(wayCount));
  const column = wayIndex % columns;
  const row = Math.floor(wayIndex / columns);
  const horizontal = row % 2 === 0;
  const originLng = -115.31 + column * 0.0035;
  const originLat = 36.02 + row * 0.003;

  return Array.from({ length: pointCount }, (_, pointIndex) => {
    const along = pointIndex * 0.00008;
    const wobble = Math.sin((wayIndex + pointIndex) * 0.37) * 0.00004;
    return horizontal
      ? [rounded(originLng + along), rounded(originLat + wobble)]
      : [rounded(originLng + wobble), rounded(originLat + along)];
  });
}

function makeWays(options: PerformanceFixtureOptions): Way[] {
  return Array.from({ length: options.counts.ways }, (_, wayIndex) => ({
    id: `${options.id}-way-${wayIndex.toString().padStart(4, '0')}`,
    typeId: 'road',
    points: wayPoints(
      wayIndex,
      allocatedCount(options.counts.points, options.counts.ways, wayIndex),
      options.counts.ways,
    ),
    geometry: 'freeform',
    grade: 'atGrade',
    profile: ROAD_PROFILE,
    source: 'performance-fixture',
  }));
}

function makeStops(options: PerformanceFixtureOptions, ways: Way[]): Stop[] {
  return Array.from({ length: options.counts.stops }, (_, stopIndex) => {
    const way = ways[stopIndex % ways.length];
    const pointIndex = Math.floor((way.points.length - 1) / 2);
    const coord = way.points[pointIndex];
    return {
      id: `${options.id}-stop-${stopIndex.toString().padStart(4, '0')}`,
      name: `Stop ${stopIndex + 1}`,
      coord: [...coord],
      anchors: [{ wayId: way.id, t: pointIndex / (way.points.length - 1) }],
    };
  });
}

function makePattern(options: PerformanceFixtureOptions, patternIndex: number, way: Way): Pattern {
  return {
    id: `${options.id}-pattern-${patternIndex.toString().padStart(3, '0')}`,
    sections: [
      {
        kind: 'shared',
        legs: [
          {
            wayId: way.id,
            direction: 'withPoints',
            extent: { kind: 'whole' },
            lane: { kind: 'auto' },
          },
        ],
      },
    ],
  };
}

function makeServices(
  options: PerformanceFixtureOptions,
  ways: Way[],
): Pick<TransitSystem, 'lines' | 'services'> {
  const services: Service[] = Array.from({ length: options.counts.patterns }, (_, patternIndex) => {
    const wayIndex = Math.floor((patternIndex * ways.length) / options.counts.patterns);
    const pattern = makePattern(options, patternIndex, ways[wayIndex]);
    return {
      id: `${options.id}-service-${patternIndex.toString().padStart(3, '0')}`,
      modeId: 'bus',
      frequencyMinutes: 15,
      spanStart: '05:00',
      spanEnd: '01:00',
      path: {
        id: `${options.id}-service-${patternIndex.toString().padStart(3, '0')}`,
        sections: pattern.sections,
      },
    };
  });
  const lines = services.map((service, index) => ({
    id: `${options.id}-line-${index.toString().padStart(3, '0')}`,
    name: `Route ${index + 1}`,
    color: FIXTURE_COLORS[index % FIXTURE_COLORS.length],
    serviceIds: [service.id],
  }));
  return { lines, services };
}

/** Builds a stable synthetic transit document whose only variable is scale. */
export function generatePerformanceFixture(options: PerformanceFixtureOptions): TransitSystem {
  const ways = makeWays(options);
  return {
    ...createEmptySystem(0),
    id: `perf-${options.id}`,
    name: `Performance fixture: ${options.label}`,
    viewport: { center: fixtureCenter(ways.length), zoom: options.zoom },
    ways,
    stops: makeStops(options, ways),
    ...makeServices(options, ways),
  };
}

export function countPerformanceFixture(system: TransitSystem): PerformanceFixtureCounts {
  return {
    ways: system.ways.length,
    points: system.ways.reduce((sum, way) => sum + way.points.length, 0),
    stops: system.stops.length,
    patterns: system.services.length,
  };
}
