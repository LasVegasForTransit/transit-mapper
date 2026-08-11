import { describe, expect, it, vi } from 'vitest';
import {
  combineCarriageways,
  separateCarriageways,
  withMedianWidth,
} from '../../src/model/carriageway-edits';
import { mergeWaysIntoCorridor } from '../../src/model/corridor-merge-edits';
import { formCrossingJunctions } from '../../src/model/crossing-edits';
import { patternWayIds } from '../../src/model/geo';
import { defaultProfileFor, makeOneWay } from '../../src/model/profile';
import { mergeWaysEndToEnd } from '../../src/model/way-merge-edits';
import { removeWayFromSystem } from '../../src/model/way-removal';
import { deleteWayStretch } from '../../src/model/way-stretch-edits';
import { aPattern, aRoad, aService, aStation, aSystem } from '../support/fixtures.test';

describe('pure network edits', () => {
  it('merges end-to-end ways and reconciles every dependent entity', () => {
    const west = aRoad('west', [
      [-115.3, 36.1],
      [-115.2, 36.1],
    ]);
    const east = aRoad('east', [
      [-115.2, 36.1],
      [-115.1, 36.1],
    ]);
    const pattern = aPattern('pattern', [west, east], [west.id, east.id]);
    const system = aSystem({
      ways: [west, east],
      services: [aService('line', [pattern])],
      stations: [aStation('stop', [-115.15, 36.1], { wayId: east.id, t: 0.5 })],
      nodes: [
        {
          id: 'seam',
          coord: [-115.2, 36.1],
          refs: [
            { wayId: west.id, pointIndex: 1 },
            { wayId: east.id, pointIndex: 0 },
          ],
        },
      ],
      namedWays: [{ id: 'street', name: 'Main Street', wayIds: [west.id, east.id] }],
    });

    const merged = mergeWaysEndToEnd(system, west.id, east.id);

    expect(merged.ways.map((way) => way.id)).toEqual([west.id]);
    expect(patternWayIds(merged.services[0].path)).toEqual([west.id]);
    expect(merged.stations[0].anchors[0].wayId).toBe(west.id);
    expect(merged.stations[0].anchors[0].t).toBeTypeOf('number');
    expect(merged.nodes).toEqual([]);
    expect(merged.namedWays[0].wayIds).toEqual([west.id]);
    expect(merged.updatedAt).toBe(system.updatedAt);
  });

  it('separates and recombines carriageways without timestamp policy', () => {
    const road = aRoad('road', [
      [-115.2, 36.1],
      [-115.1, 36.1],
    ]);
    const system = aSystem({ ways: [road] });
    const createId = vi
      .fn<() => string>()
      .mockReturnValueOnce('backward')
      .mockReturnValueOnce('street');

    const separated = separateCarriageways(system, road.id, createId);

    expect(separated?.newWayId).toBe('backward');
    expect(separated?.system.ways).toHaveLength(2);
    expect(separated?.system.namedWays[0]).toMatchObject({
      id: 'street',
      wayIds: [road.id, 'backward'],
    });
    expect(separated?.system.updatedAt).toBe(system.updatedAt);
    if (!separated) throw new Error('The two-way road fixture must separate.');

    const combined = combineCarriageways(separated.system, 'street');
    expect(combined.ways.map((way) => way.id)).toEqual([road.id]);
    expect(combined.updatedAt).toBe(system.updatedAt);
  });

  it('maps an opposite-oriented carriageway junction to the coincident keeper point', () => {
    const keeper = aRoad(
      'keeper',
      [
        [0, 0],
        [1, 0],
        [2, 0],
      ],
      { profile: makeOneWay(defaultProfileFor('road'), 'forward') },
    );
    const other = aRoad(
      'other',
      [
        [2, 0],
        [1, 0],
        [0, 0],
      ],
      { profile: makeOneWay(defaultProfileFor('road'), 'forward') },
    );
    const branch = aRoad('branch', [
      [2, 0],
      [2, 1],
    ]);
    const system = aSystem({
      ways: [keeper, other, branch],
      namedWays: [{ id: 'pair', name: 'Main Street', wayIds: [keeper.id, other.id] }],
      nodes: [
        {
          id: 'junction',
          coord: [2, 0],
          refs: [
            { wayId: other.id, pointIndex: 0 },
            { wayId: branch.id, pointIndex: 0 },
          ],
        },
      ],
    });

    const combined = combineCarriageways(system, 'pair');

    expect(combined.nodes[0].refs).toEqual([
      { wayId: keeper.id, pointIndex: 2 },
      { wayId: branch.id, pointIndex: 0 },
    ]);
    const keeperRef = combined.nodes[0].refs[0];
    const keeperPoint = combined.ways.find((way) => way.id === keeperRef.wayId)?.points[
      keeperRef.pointIndex
    ];
    expect(keeperPoint).toEqual(combined.nodes[0].coord);
  });

  it('moves a sampled carriageway junction onto the nearest keeper point', () => {
    const keeper = aRoad(
      'keeper',
      [
        [0, 0],
        [1, 0],
        [2, 0],
      ],
      { profile: makeOneWay(defaultProfileFor('road'), 'forward') },
    );
    const other = aRoad(
      'other',
      [
        [0, 0.1],
        [1.8, 0.1],
        [2, 0.1],
      ],
      { profile: makeOneWay(defaultProfileFor('road'), 'backward') },
    );
    const branch = aRoad('branch', [
      [1.8, 0.1],
      [3, 0],
    ]);
    const otherLane = other.profile.lanes[0];
    const branchLane = branch.profile.lanes[0];
    const system = aSystem({
      ways: [keeper, other, branch],
      namedWays: [{ id: 'pair', name: 'Main Street', wayIds: [keeper.id, other.id] }],
      stations: [aStation('branch-stop', [1.8, 0.1], { wayId: branch.id, t: 0 })],
      nodes: [
        {
          id: 'junction',
          coord: [1.8, 0.1],
          refs: [
            { wayId: other.id, pointIndex: 1 },
            { wayId: branch.id, pointIndex: 0 },
          ],
          connectors: [
            {
              from: { wayId: other.id, laneId: otherLane.id },
              to: { wayId: branch.id, laneId: branchLane.id },
            },
          ],
        },
      ],
    });

    const combined = combineCarriageways(system, 'pair');

    expect(combined.nodes[0]).toMatchObject({
      coord: [2, 0],
      refs: [
        { wayId: keeper.id, pointIndex: 2 },
        { wayId: branch.id, pointIndex: 0 },
      ],
    });
    expect(combined.ways.find((way) => way.id === branch.id)?.points[0]).toEqual([2, 0]);
    expect(combined.stations[0].coord).toEqual([2, 0]);
    expect(combined.nodes[0].connectors).toEqual([
      {
        from: { wayId: keeper.id, laneId: otherLane.id },
        to: { wayId: branch.id, laneId: branchLane.id },
      },
    ]);
  });

  it('forms a real node and four arms where roads cross', () => {
    const horizontal = aRoad('horizontal', [
      [-115.2, 36.1],
      [-115.1, 36.1],
    ]);
    const vertical = aRoad('vertical', [
      [-115.15, 36.05],
      [-115.15, 36.15],
    ]);
    let sequence = 0;
    const system = aSystem({ ways: [horizontal, vertical] });

    const crossed = formCrossingJunctions(
      system,
      horizontal.id,
      undefined,
      () => `generated-${sequence++}`,
    );

    expect(crossed).not.toBe(system);
    expect(crossed.ways).toHaveLength(4);
    expect(crossed.nodes.some((node) => node.refs.length >= 4)).toBe(true);
    expect(crossed.updatedAt).toBe(system.updatedAt);
  });

  it('deletes a middle stretch while preserving both service remnants', () => {
    const road = aRoad('road', [
      [-115.3, 36.1],
      [-115.1, 36.1],
    ]);
    const pattern = aPattern('pattern', [road], [road.id]);
    const system = aSystem({ ways: [road], services: [aService('line', [pattern])] });
    let sequence = 0;

    const deleted = deleteWayStretch(system, {
      wayId: road.id,
      fromT: 0.25,
      toT: 0.75,
      createId: () => `generated-${sequence++}`,
    });

    expect(deleted.affectedPatterns).toBe(1);
    expect(deleted.system.ways).toHaveLength(2);
    expect(deleted.system.services.map((service) => patternWayIds(service.path))).toHaveLength(2);
    expect(deleted.system.lines[0].serviceIds).toEqual(
      deleted.system.services.map((service) => service.id),
    );
    expect(deleted.system.updatedAt).toBe(system.updatedAt);
  });

  it('deleting a complete way stretch prunes groups after its line and service disappear', () => {
    const road = aRoad('road', [
      [-115.2, 36.1],
      [-115.1, 36.1],
    ]);
    const service = aService('service', [aPattern('path', [road], [road.id])]);
    const system = aSystem({
      ways: [road],
      services: [service],
      lines: [{ id: 'line', name: 'Line', color: '#e4572e', serviceIds: [service.id] }],
      groups: [{ id: 'group', memberIds: [road.id, service.id, 'line'] }],
    });

    const deleted = deleteWayStretch(system, { wayId: road.id, fromT: 0, toT: 1 });

    expect(deleted.system.lines).toEqual([]);
    expect(deleted.system.services).toEqual([]);
    expect(deleted.system.groups[0].memberIds).toEqual([]);
    expect(deleted.system.updatedAt).toBe(system.updatedAt);
  });

  it('preserves input identity for invalid and equal edits', () => {
    const system = aSystem();

    expect(removeWayFromSystem(system, 'missing')).toBe(system);
    expect(mergeWaysEndToEnd(system, 'missing', 'other')).toBe(system);
    expect(combineCarriageways(system, 'missing')).toBe(system);
    expect(withMedianWidth(system, 'missing', undefined)).toBe(system);
    expect(deleteWayStretch(system, { wayId: 'missing', fromT: 0, toT: 1 }).system).toBe(system);
    expect(mergeWaysIntoCorridor(system, ['missing']).system).toBe(system);
  });
});
