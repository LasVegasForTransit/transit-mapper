import { describe, expect, it, vi } from 'vitest';
import { patternWayIds } from '../../src/model/geo';
import {
  deleteWayPoint,
  insertWayPoint,
  joinWayPointToWay,
  moveWayPoint,
} from '../../src/model/way-point-edits';
import { nameWay, withWayProfile } from '../../src/model/way-property-edits';
import { splitWayAtIndex, splitWayAtPosition } from '../../src/model/way-split-edits';
import { aPattern, aRoad, aService, aStop, aSystem } from '../support/fixtures.test';

describe('pure way edits', () => {
  it('forms a real junction and keeps refs aligned through later point edits', () => {
    const trunk = aRoad('trunk', [
      [-115.2, 36.1],
      [-115.1, 36.1],
    ]);
    const branch = aRoad('branch', [
      [-115.15, 36.2],
      [-115.15, 36.1],
    ]);
    const system = aSystem({ ways: [trunk, branch] });

    const joined = joinWayPointToWay(
      system,
      {
        wayId: branch.id,
        index: 1,
        targetWayId: trunk.id,
        coord: [-115.15, 36.1],
      },
      () => 'junction',
    );

    expect(joined.ways.find((way) => way.id === trunk.id)?.points).toHaveLength(3);
    expect(joined.nodes).toEqual([
      {
        id: 'junction',
        coord: [-115.15, 36.1],
        refs: [
          { wayId: trunk.id, pointIndex: 1 },
          { wayId: branch.id, pointIndex: 1 },
        ],
      },
    ]);

    const moved = moveWayPoint(joined, branch.id, 1, [-115.16, 36.05]);
    expect(moved.ways.find((way) => way.id === trunk.id)?.points[1]).toEqual([-115.16, 36.05]);
    expect(moved.nodes[0].coord).toEqual([-115.16, 36.05]);

    const inserted = insertWayPoint(moved, trunk.id, 0, [-115.22, 36.09]);
    expect(inserted.nodes[0].refs.find((ref) => ref.wayId === trunk.id)?.pointIndex).toBe(2);
    const deleted = deleteWayPoint(inserted, trunk.id, 0);
    expect(deleted.nodes[0].refs.find((ref) => ref.wayId === trunk.id)?.pointIndex).toBe(1);
  });

  it('does not mint ids for invalid junction, split, or identity edits', () => {
    const createId = vi.fn(() => 'unused');
    const system = aSystem();

    expect(
      joinWayPointToWay(
        system,
        { wayId: 'missing', index: 0, targetWayId: 'also-missing', coord: [0, 0] },
        createId,
      ),
    ).toBe(system);
    expect(splitWayAtIndex(system, 'missing', 1, createId)).toBe(system);
    expect(splitWayAtPosition(system, 'missing', 0.5, createId)).toBe(system);
    expect(nameWay(system, 'missing', 'Ghost Street', createId)).toBe(system);
    expect(createId).not.toHaveBeenCalled();
  });

  it('splits infrastructure while preserving the riding pattern, stop, and identity', () => {
    const trunk = aRoad('trunk', [
      [-115.3, 36.1],
      [-115.2, 36.1],
      [-115.1, 36.1],
    ]);
    const service = aService('line', [aPattern('pattern', [trunk], [trunk.id])]);
    const eastStop = aStop('east', [-115.15, 36.1], { wayId: trunk.id, t: 0.75 });
    const system = aSystem({
      ways: [trunk],
      services: [service],
      stops: [eastStop],
      namedWays: [{ id: 'street', name: 'Main Street', wayIds: [trunk.id] }],
    });
    const createId = vi
      .fn<() => string>()
      .mockReturnValueOnce('east-half')
      .mockReturnValueOnce('split-node');

    const result = splitWayAtIndex(system, trunk.id, 1, createId);

    expect(result.ways.map((way) => way.id)).toEqual([trunk.id, 'east-half']);
    expect(patternWayIds(result.services[0].path)).toEqual([trunk.id, 'east-half']);
    expect(result.stops[0].anchors[0].wayId).toBe('east-half');
    expect(result.namedWays[0].wayIds).toEqual([trunk.id, 'east-half']);
    expect(result.nodes[0]).toMatchObject({ id: 'split-node' });
  });

  it('prunes lane connectors when replacing a profile', () => {
    const first = aRoad('first', [
      [-115.2, 36.1],
      [-115.1, 36.1],
    ]);
    const second = aRoad('second', [
      [-115.1, 36.1],
      [-115.1, 36.2],
    ]);
    const keptLane = first.profile.lanes[0];
    const removedLane = first.profile.lanes[1];
    const targetLane = second.profile.lanes[0];
    const system = aSystem({
      ways: [first, second],
      nodes: [
        {
          id: 'junction',
          coord: [-115.1, 36.1],
          refs: [
            { wayId: first.id, pointIndex: 1 },
            { wayId: second.id, pointIndex: 0 },
          ],
          connectors: [
            {
              from: { wayId: first.id, laneId: keptLane.id },
              to: { wayId: second.id, laneId: targetLane.id },
            },
            {
              from: { wayId: first.id, laneId: removedLane.id },
              to: { wayId: second.id, laneId: targetLane.id },
            },
          ],
        },
      ],
    });

    const result = withWayProfile(system, first.id, { lanes: [keptLane] });

    expect(result.nodes[0].connectors).toHaveLength(1);
    expect(result.nodes[0].connectors?.[0].from.laneId).toBe(keptLane.id);
  });
});
