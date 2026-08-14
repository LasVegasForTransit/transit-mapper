import { describe, expect, it } from 'vitest';
import { metersFromOrigin, offsetMeters, pointAtT, resolveWayPath } from '../../src/model/geo';
import { createEmptySystem } from '../../src/model/serialize';
import type { LngLat, TransitSystem } from '../../src/model/system';
import { computeDiagramSystem, layoutDiagram } from '../../src/model/diagramLayout';

function fixture(): TransitSystem {
  return {
    ...createEmptySystem(1),
    ways: [
      {
        id: 'way',
        typeId: 'road',
        points: [
          [-115.2, 36.1],
          [-115.12, 36.13],
        ],
        geometry: 'straight',
        grade: 'atGrade',
        profile: { lanes: [] },
      },
    ],
    stops: [
      {
        id: 'stop',
        coord: [-115.16, 36.115],
        anchors: [{ wayId: 'way', t: 0.5 }],
      },
    ],
  };
}

function operationCounts() {
  return {
    diagramTopologyBuildCount: 0,
    diagramTopologyCacheHitCount: 0,
    diagramStopBuildCount: 0,
    diagramStopCacheHitCount: 0,
  };
}

function strictSegmentsCross(
  firstStart: LngLat,
  firstEnd: LngLat,
  secondStart: LngLat,
  secondEnd: LngLat,
): boolean {
  const orientation = (start: LngLat, end: LngLat, point: LngLat) =>
    (end[0] - start[0]) * (point[1] - start[1]) - (end[1] - start[1]) * (point[0] - start[0]);
  const firstA = orientation(firstStart, firstEnd, secondStart);
  const firstB = orientation(firstStart, firstEnd, secondEnd);
  const secondA = orientation(secondStart, secondEnd, firstStart);
  const secondB = orientation(secondStart, secondEnd, firstEnd);
  return firstA * firstB < 0 && secondA * secondB < 0;
}

function waysCross(first: readonly LngLat[], second: readonly LngLat[]): boolean {
  for (let firstIndex = 0; firstIndex < first.length - 1; firstIndex += 1) {
    for (let secondIndex = 0; secondIndex < second.length - 1; secondIndex += 1) {
      if (
        strictSegmentsCross(
          first[firstIndex],
          first[firstIndex + 1],
          second[secondIndex],
          second[secondIndex + 1],
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

describe('diagram layout dependency cache', () => {
  it('keeps shared junctions and anchored stops on one deterministic schematic position', () => {
    const junction: [number, number] = [-115.16, 36.115];
    const system: TransitSystem = {
      ...fixture(),
      ways: [
        {
          id: 'west-east',
          typeId: 'road',
          points: [[-115.2, 36.1], junction, [-115.12, 36.13]],
          geometry: 'straight',
          grade: 'atGrade',
          profile: { lanes: [] },
        },
        {
          id: 'south-north',
          typeId: 'road',
          points: [[-115.16, 36.08], junction, [-115.16, 36.16]],
          geometry: 'straight',
          grade: 'atGrade',
          profile: { lanes: [] },
        },
      ],
      nodes: [
        {
          id: 'junction',
          coord: junction,
          refs: [
            { wayId: 'west-east', pointIndex: 1 },
            { wayId: 'south-north', pointIndex: 1 },
          ],
        },
      ],
      stops: [
        {
          id: 'junction-stop',
          stationId: 'junction-station',
          coord: junction,
          anchors: [{ wayId: 'west-east', t: 0.5 }],
        },
      ],
      stations: [{ id: 'junction-station', coord: junction }],
    };

    const first = layoutDiagram(system);
    const second = layoutDiagram(system);
    const position = first.nodePositions.junction;

    expect(second).toEqual(first);
    expect(first.system.nodes[0]?.coord).toEqual(position);
    expect(first.system.stops[0]?.coord).toEqual(first.stopAnchors['junction-stop']);
    expect(first.system.stations[0]?.coord).toEqual(first.stationAnchors['junction-station']);
    expect(first.system.stations[0]?.coord).toEqual(first.system.stops[0]?.coord);
    expect(first.system.ways.flatMap((way) => way.points)).toContainEqual(position);
  });

  it('gives coincident Diagram branches distinct octilinear exits', () => {
    const origin: LngLat = [-115.16, 36.115];
    const terminus = offsetMeters(origin, 30, 30);
    const system: TransitSystem = {
      ...fixture(),
      ways: ['alpha', 'bravo', 'charlie'].map((id) => ({
        id,
        typeId: 'road',
        points: [origin, terminus],
        geometry: 'straight' as const,
        grade: 'atGrade' as const,
        profile: { lanes: [] },
      })),
      nodes: [
        {
          id: 'junction',
          coord: origin,
          refs: ['alpha', 'bravo', 'charlie'].map((wayId) => ({ wayId, pointIndex: 0 })),
        },
      ],
    };

    const diagram = layoutDiagram(system).system;
    const headings = diagram.ways.map((way) => {
      const next = way.points[1];
      const [x, y] = metersFromOrigin(way.points[0], next);
      return Math.round(Math.atan2(y, x) / (Math.PI / 4));
    });

    expect(new Set(headings)).toHaveLength(3);
  });

  it('keeps a disconnected schematic component stable when another component changes', () => {
    const system: TransitSystem = {
      ...fixture(),
      ways: [
        {
          id: 'west',
          typeId: 'road',
          points: [
            [-115.24, 36.1],
            [-115.2, 36.122],
          ],
          geometry: 'straight',
          grade: 'atGrade',
          profile: { lanes: [] },
        },
        {
          id: 'east',
          typeId: 'road',
          points: [
            [-115.1, 36.115],
            [-115.06, 36.135],
          ],
          geometry: 'straight',
          grade: 'atGrade',
          profile: { lanes: [] },
        },
      ],
    };

    const first = layoutDiagram(system);
    const changedWest: TransitSystem['ways'][number] = {
      ...system.ways[0],
      points: [
        [-115.24, 36.1],
        [-115.2, 36.14],
      ],
    };
    const second = layoutDiagram({ ...system, ways: [changedWest, system.ways[1]] });

    expect(second.system.ways.find((way) => way.id === 'east')?.points).toEqual(
      first.system.ways.find((way) => way.id === 'east')?.points,
    );
  });

  it('detours an octilinear crossing that geography did not contain', () => {
    const origin: [number, number] = [-115.16, 36.115];
    const point = (x: number, y: number) => offsetMeters(origin, x, y);
    const system: TransitSystem = {
      ...fixture(),
      ways: [
        {
          id: 'north-south',
          typeId: 'road',
          points: [point(-7.91, 8.22), point(-4.46, -4.84)],
          geometry: 'straight',
          grade: 'atGrade',
          profile: { lanes: [] },
        },
        {
          id: 'diagonal',
          typeId: 'road',
          points: [point(-6.23, 6.46), point(1.21, -3.16)],
          geometry: 'straight',
          grade: 'atGrade',
          profile: { lanes: [] },
        },
      ],
    };

    const diagram = layoutDiagram(system).system;
    const first = diagram.ways[0].points;
    const second = diagram.ways[1].points;

    expect(waysCross(first, second)).toBe(false);
  });

  it('preserves a geographic crossing for grade and control rendering', () => {
    const origin: [number, number] = [-115.16, 36.115];
    const point = (x: number, y: number) => offsetMeters(origin, x, y);
    const system: TransitSystem = {
      ...fixture(),
      ways: [
        {
          id: 'descending',
          typeId: 'road',
          points: [point(-8, 8), point(8, -8)],
          geometry: 'straight',
          grade: 'atGrade',
          profile: { lanes: [] },
        },
        {
          id: 'ascending',
          typeId: 'road',
          points: [point(-8, -8), point(8, 8)],
          geometry: 'straight',
          grade: 'elevated',
          profile: { lanes: [] },
        },
      ],
    };

    const diagram = layoutDiagram(system).system;
    expect(waysCross(diagram.ways[0].points, diagram.ways[1].points)).toBe(true);
    expect(diagram.ways.every((way) => way.points.length === 2)).toBe(true);
  });

  it('reuses schematic ways and stops when a non-layout field changes', () => {
    const system = fixture();
    const counts = operationCounts();
    const first = computeDiagramSystem(system, counts);

    const second = computeDiagramSystem(
      {
        ...system,
        facilities: [{ id: 'entrance', typeId: 'entrance', geometry: [-115.16, 36.116] }],
      },
      counts,
    );

    expect(second.ways).toBe(first.ways);
    expect(second.stops).toBe(first.stops);
    expect(second.facilities).toHaveLength(1);
    expect(counts).toEqual({
      diagramTopologyBuildCount: 1,
      diagramTopologyCacheHitCount: 1,
      diagramStopBuildCount: 1,
      diagramStopCacheHitCount: 1,
    });
  });

  it('reuses schematic topology while rebuilding only changed stop placement', () => {
    const system = fixture();
    const counts = operationCounts();
    const first = computeDiagramSystem(system, counts);
    const changedStops = system.stops.map((stop) => ({
      ...stop,
      name: 'Renamed stop',
    }));

    const second = computeDiagramSystem({ ...system, stops: changedStops }, counts);

    expect(second.ways).toBe(first.ways);
    expect(second.stops).not.toBe(first.stops);
    expect(second.stops[0]?.name).toBe('Renamed stop');
    expect(counts).toEqual({
      diagramTopologyBuildCount: 1,
      diagramTopologyCacheHitCount: 1,
      diagramStopBuildCount: 2,
      diagramStopCacheHitCount: 0,
    });
  });

  it('anchors a named corridor label on its routed schematic geometry', () => {
    const system: TransitSystem = {
      ...fixture(),
      namedWays: [{ id: 'main', name: 'Main Street', wayIds: ['way'] }],
    };

    const result = layoutDiagram(system);
    const schematicWay = result.system.ways.find((way) => way.id === 'way');
    expect(schematicWay).toBeDefined();
    if (!schematicWay) return;

    expect(result.labelAnchors).toEqual({
      main: pointAtT(resolveWayPath(schematicWay), 0.5),
    });
  });
});
