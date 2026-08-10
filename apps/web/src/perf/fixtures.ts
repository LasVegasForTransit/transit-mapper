import { defaultProfileFor } from '@transitmapper/core/model/profile';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
import type {
  LngLat,
  Pattern,
  Service,
  Station,
  TransitSystem,
  Way,
} from '@transitmapper/core/model/system';
import { PERF_FIXTURES } from './fixtureDefinitions';
import type { PerfFixtureCounts, PerfFixtureId } from './types';

const FIXTURE_COLORS = ['#e4572e', '#17bebb', '#ffc914', '#2e282a', '#76b041', '#5c4d7d'] as const;

const ROAD_PROFILE = {
  lanes: defaultProfileFor('road').lanes.map((lane, laneIndex) => ({
    ...lane,
    // Catalog profiles normally mint ids because editor-created lanes need
    // identity. Benchmark content must be byte-for-byte stable across runs.
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

function makeWays(scenarioId: PerfFixtureId): Way[] {
  const counts = PERF_FIXTURES[scenarioId].counts;

  return Array.from({ length: counts.ways }, (_, wayIndex) => ({
    id: `${scenarioId}-way-${wayIndex.toString().padStart(4, '0')}`,
    typeId: 'road',
    points: wayPoints(wayIndex, allocatedCount(counts.points, counts.ways, wayIndex), counts.ways),
    geometry: 'freeform',
    grade: 'atGrade',
    profile: ROAD_PROFILE,
    source: 'performance-fixture',
  }));
}

function makeStations(scenarioId: PerfFixtureId, ways: Way[]): Station[] {
  const stationCount = PERF_FIXTURES[scenarioId].counts.stations;

  return Array.from({ length: stationCount }, (_, stationIndex) => {
    const way = ways[stationIndex % ways.length];
    const pointIndex = Math.floor((way.points.length - 1) / 2);
    const coord = way.points[pointIndex];
    return {
      id: `${scenarioId}-station-${stationIndex.toString().padStart(4, '0')}`,
      name: `Station ${stationIndex + 1}`,
      coord: [...coord],
      anchors: [
        {
          wayId: way.id,
          t: pointIndex / (way.points.length - 1),
        },
      ],
    };
  });
}

function makePattern(scenarioId: PerfFixtureId, patternIndex: number, way: Way): Pattern {
  return {
    id: `${scenarioId}-pattern-${patternIndex.toString().padStart(3, '0')}`,
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
  scenarioId: PerfFixtureId,
  ways: Way[],
): {
  lines: TransitSystem['lines'];
  services: Service[];
} {
  const patternCount = PERF_FIXTURES[scenarioId].counts.patterns;

  const services = Array.from({ length: patternCount }, (_, patternIndex) => {
    const wayIndex = Math.floor((patternIndex * ways.length) / patternCount);
    const pattern = makePattern(scenarioId, patternIndex, ways[wayIndex]);
    return {
      id: `${scenarioId}-service-${patternIndex.toString().padStart(3, '0')}`,
      modeId: 'bus',
      frequencyMinutes: 15,
      spanStart: '05:00',
      spanEnd: '01:00',
      path: {
        id: `${scenarioId}-service-${patternIndex.toString().padStart(3, '0')}`,
        sections: pattern.sections,
      },
    };
  });
  const lines = services.map((service, index) => ({
    id: `${scenarioId}-line-${index.toString().padStart(3, '0')}`,
    name: `Route ${index + 1}`,
    color: FIXTURE_COLORS[index % FIXTURE_COLORS.length],
    serviceIds: [service.id],
  }));
  return { lines, services };
}

/**
 * Builds synthetic documents with stable identifiers and geometry. Real agency
 * data cannot be committed to the benchmark, and random data makes two runs
 * incomparable, so scale is the variable while content stays fixed.
 */
export function generatePerfFixture(scenarioId: PerfFixtureId): TransitSystem {
  const ways = makeWays(scenarioId);
  const base = createEmptySystem(0);
  const definition = PERF_FIXTURES[scenarioId];
  const network = makeServices(scenarioId, ways);

  return {
    ...base,
    id: `perf-${scenarioId}`,
    name: `Performance fixture: ${definition.label}`,
    viewport: {
      center: fixtureCenter(ways.length),
      zoom: scenarioId === 'small' ? 12 : 10,
    },
    ways,
    stations: makeStations(scenarioId, ways),
    ...network,
  };
}

export function countPerfFixture(system: TransitSystem): PerfFixtureCounts {
  return {
    ways: system.ways.length,
    points: system.ways.reduce((sum, way) => sum + way.points.length, 0),
    stations: system.stations.length,
    patterns: system.services.length,
  };
}
