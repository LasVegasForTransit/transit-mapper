import { nudgeSelection } from '../../src/model/selection-nudge';
import { aRoad, aStation, aSystem } from '../support/fixtures.test';
import { describe, expect, it } from 'vitest';

describe('multi-selection nudging', () => {
  it('preserves the system reference when the selection has no movable geometry', () => {
    const system = aSystem();

    expect(nudgeSelection(system, [], 1, 1)).toBe(system);
    expect(nudgeSelection(system, [{ kind: 'service', id: 'missing' }], 1, 1)).toBe(system);
    expect(nudgeSelection(system, [{ kind: 'way', id: 'missing' }], 1, 1)).toBe(system);
    expect(nudgeSelection(system, [{ kind: 'way', id: 'missing' }], 0, 0)).toBe(system);
  });

  it('moves selected ways once and carries their anchored stations with them', () => {
    const way = aRoad('way', [
      [0, 0],
      [1, 0],
    ]);
    const anchored = aStation('anchored', [0.5, 0], { wayId: 'way', t: 0.5 });
    const directlySelected = aStation('direct', [4, 5]);
    const untouched = aStation('untouched', [8, 9]);
    const system = aSystem({ ways: [way], stations: [anchored, directlySelected, untouched] });

    const next = nudgeSelection(
      system,
      [
        { kind: 'way', id: 'way' },
        { kind: 'station', id: 'anchored' },
        { kind: 'station', id: 'direct' },
      ],
      2,
      3,
    );

    expect(next.ways[0].points).toEqual([
      [2, 3],
      [3, 3],
    ]);
    expect(next.stations[0].coord[0]).toBeCloseTo(2.5);
    expect(next.stations[0].coord[1]).toBeCloseTo(3);
    expect(next.stations[1].coord).toEqual([6, 8]);
    expect(next.stations[2]).toBe(untouched);
    expect(next.facilities).toBe(system.facilities);
    expect(next.updatedAt).toBe(system.updatedAt);
  });

  it('moves both point and polygon facilities without touching other records', () => {
    const point = { id: 'point', typeId: 'entrance', geometry: [1, 2] as [number, number] };
    const area = {
      id: 'area',
      typeId: 'depot',
      geometry: [
        [0, 0],
        [1, 0],
      ] as [number, number][],
    };
    const system = aSystem({ facilities: [point, area] });

    const next = nudgeSelection(
      system,
      [
        { kind: 'facility', id: 'point' },
        { kind: 'facility', id: 'area' },
      ],
      -1,
      4,
    );

    expect(next.facilities).toEqual([
      { ...point, geometry: [0, 6] },
      {
        ...area,
        geometry: [
          [-1, 4],
          [0, 4],
        ],
      },
    ]);
    expect(next.stations).toBe(system.stations);
  });

  it('follows the first moved anchor even when it is not the primary anchor', () => {
    const stationary = aRoad('stationary', [
      [0, 1],
      [1, 1],
    ]);
    const moved = aRoad('moved', [
      [0, 0],
      [1, 0],
    ]);
    const station = {
      ...aStation('station', [0.25, 0]),
      anchors: [
        { wayId: 'stationary', t: 0.25 },
        { wayId: 'moved', t: 0.25 },
      ],
    };
    const system = aSystem({ ways: [stationary, moved], stations: [station] });

    const next = nudgeSelection(system, [{ kind: 'way', id: 'moved' }], 2, 3);

    expect(next.stations[0].coord[0]).toBeCloseTo(2.25);
    expect(next.stations[0].coord[1]).toBeCloseTo(3);
  });

  it('moves a junction when every referenced point moves together', () => {
    const east = aRoad('east', [
      [0, 0],
      [1, 0],
    ]);
    const north = aRoad('north', [
      [0, 0],
      [0, 1],
    ]);
    const node = {
      id: 'junction',
      coord: [0, 0] as [number, number],
      refs: [
        { wayId: east.id, pointIndex: 0 },
        { wayId: north.id, pointIndex: 0 },
      ],
    };
    const system = aSystem({ ways: [east, north], nodes: [node] });

    const next = nudgeSelection(
      system,
      [
        { kind: 'way', id: east.id },
        { kind: 'way', id: north.id },
      ],
      2,
      3,
    );

    expect(next.nodes[0]).toEqual({ ...node, coord: [2, 3] });
    expect(next.nodes[0].refs).toBe(node.refs);
  });

  it('disconnects a moved arm while preserving the junction between stationary arms', () => {
    const east = aRoad('east', [
      [0, 0],
      [1, 0],
    ]);
    const north = aRoad('north', [
      [0, 0],
      [0, 1],
    ]);
    const west = aRoad('west', [
      [0, 0],
      [-1, 0],
    ]);
    const eastLane = east.profile.lanes[0].id;
    const northLane = north.profile.lanes[0].id;
    const westLane = west.profile.lanes[0].id;
    const retainedConnector = {
      from: { wayId: north.id, laneId: northLane },
      to: { wayId: west.id, laneId: westLane },
    };
    const system = aSystem({
      ways: [east, north, west],
      nodes: [
        {
          id: 'junction',
          coord: [0, 0],
          refs: [
            { wayId: east.id, pointIndex: 0 },
            { wayId: north.id, pointIndex: 0 },
            { wayId: west.id, pointIndex: 0 },
          ],
          connectors: [
            {
              from: { wayId: east.id, laneId: eastLane },
              to: { wayId: north.id, laneId: northLane },
            },
            retainedConnector,
          ],
        },
      ],
    });

    const next = nudgeSelection(system, [{ kind: 'way', id: east.id }], 2, 3);

    expect(next.nodes[0]).toEqual({
      ...system.nodes[0],
      refs: [
        { wayId: north.id, pointIndex: 0 },
        { wayId: west.id, pointIndex: 0 },
      ],
      connectors: [retainedConnector],
    });
  });

  it('removes a partial junction that has fewer than two stationary refs', () => {
    const east = aRoad('east', [
      [0, 0],
      [1, 0],
    ]);
    const north = aRoad('north', [
      [0, 0],
      [0, 1],
    ]);
    const system = aSystem({
      ways: [east, north],
      nodes: [
        {
          id: 'junction',
          coord: [0, 0],
          refs: [
            { wayId: east.id, pointIndex: 0 },
            { wayId: north.id, pointIndex: 0 },
          ],
        },
      ],
    });

    const next = nudgeSelection(system, [{ kind: 'way', id: east.id }], 2, 3);

    expect(next.nodes).toEqual([]);
  });

  it('preserves unrelated node references when a detached way moves', () => {
    const detached = aRoad('detached', [
      [2, 2],
      [3, 2],
    ]);
    const east = aRoad('east', [
      [0, 0],
      [1, 0],
    ]);
    const north = aRoad('north', [
      [0, 0],
      [0, 1],
    ]);
    const system = aSystem({
      ways: [detached, east, north],
      nodes: [
        {
          id: 'junction',
          coord: [0, 0],
          refs: [
            { wayId: east.id, pointIndex: 0 },
            { wayId: north.id, pointIndex: 0 },
          ],
        },
      ],
    });

    const next = nudgeSelection(system, [{ kind: 'way', id: detached.id }], 2, 3);

    expect(next.nodes).toBe(system.nodes);
    expect(next.nodes[0]).toBe(system.nodes[0]);
  });
});
