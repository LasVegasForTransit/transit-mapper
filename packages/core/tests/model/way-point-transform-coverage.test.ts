import { describe, expect, it, vi } from 'vitest';
import {
  appendWayPoint,
  closeWayLoop,
  deleteWayPoint,
  insertWayPoint,
  moveWayPoint,
  straightenWay,
} from '../../src/model/way-point-edits';
import { aRoad, aStation, aSystem } from '../support/fixtures.test';

describe('way point transform identity', () => {
  it('preserves the input for missing, invalid, equal, and protected point edits', () => {
    const road = aRoad('road', [
      [0, 0],
      [0.001, 0],
    ]);
    const system = aSystem({ ways: [road] });

    expect(appendWayPoint(system, 'missing', [0.002, 0])).toBe(system);
    expect(insertWayPoint(system, road.id, -1, [0.0005, 0])).toBe(system);
    expect(insertWayPoint(system, road.id, 3, [0.0005, 0])).toBe(system);
    expect(moveWayPoint(system, road.id, 0, road.points[0])).toBe(system);
    expect(moveWayPoint(system, road.id, 2, [0.002, 0])).toBe(system);
    expect(deleteWayPoint(system, road.id, 0)).toBe(system);
    expect(straightenWay(system, road.id)).toBe(system);
  });

  it('appends a point while preserving unrelated records and timestamp policy', () => {
    const road = aRoad('road', [
      [0, 0],
      [0.001, 0],
    ]);
    const untouched = aRoad('untouched', [
      [1, 1],
      [1.001, 1],
    ]);
    const station = aStation('station', [0.0005, 0], { wayId: road.id, t: 0.5 });
    const system = aSystem({ updatedAt: 123, ways: [road, untouched], stations: [station] });

    const next = appendWayPoint(system, road.id, [0.002, 0]);

    expect(next).not.toBe(system);
    expect(next.ways[0].points).toEqual([...road.points, [0.002, 0]]);
    expect(next.ways[1]).toBe(untouched);
    expect(next.nodes).toBe(system.nodes);
    expect(next.updatedAt).toBe(123);
  });

  it('inserts and deletes points while keeping junction indexes aligned', () => {
    const road = aRoad('road', [
      [0, 0],
      [0.001, 0],
      [0.002, 0],
      [0.003, 0],
    ]);
    const branch = aRoad('branch', [
      [0.002, 0],
      [0.002, 0.001],
    ]);
    const system = aSystem({
      ways: [road, branch],
      nodes: [
        {
          id: 'junction',
          coord: [0.002, 0],
          refs: [
            { wayId: road.id, pointIndex: 2 },
            { wayId: branch.id, pointIndex: 0 },
          ],
        },
      ],
    });

    const inserted = insertWayPoint(system, road.id, 1, [0.0005, 0]);
    expect(inserted.nodes[0].refs[0].pointIndex).toBe(3);
    expect(inserted.ways[1]).toBe(branch);

    const deleted = deleteWayPoint(inserted, road.id, 1);
    expect(deleted.nodes[0].refs[0].pointIndex).toBe(2);
    expect(deleted.ways[0].points).toEqual(road.points);
  });

  it('moves every arm of a junction and preserves unrelated ways', () => {
    const east = aRoad('east', [
      [0, 0],
      [0.001, 0],
    ]);
    const north = aRoad('north', [
      [0, 0],
      [0, 0.001],
    ]);
    const untouched = aRoad('untouched', [
      [1, 1],
      [1.001, 1],
    ]);
    const system = aSystem({
      ways: [east, north, untouched],
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

    const next = moveWayPoint(system, east.id, 0, [-0.001, -0.001]);

    expect(next.ways[0].points[0]).toEqual([-0.001, -0.001]);
    expect(next.ways[1].points[0]).toEqual([-0.001, -0.001]);
    expect(next.ways[2]).toBe(untouched);
    expect(next.nodes[0].coord).toEqual([-0.001, -0.001]);
  });

  it('closes a coincident loop exactly once and does not mint ids for no-ops', () => {
    const createId = vi.fn(() => 'loop-node');
    const open = aRoad('open', [
      [0, 0],
      [0.001, 0],
    ]);
    const loop = aRoad('loop', [
      [0, 0],
      [0.001, 0],
      [0, 0],
    ]);
    const system = aSystem({ ways: [open, loop] });

    expect(closeWayLoop(system, open.id, createId)).toBe(system);
    expect(createId).not.toHaveBeenCalled();

    const closed = closeWayLoop(system, loop.id, createId);
    expect(closed.nodes).toEqual([
      {
        id: 'loop-node',
        coord: [0, 0],
        refs: [
          { wayId: loop.id, pointIndex: 0 },
          { wayId: loop.id, pointIndex: 2 },
        ],
      },
    ]);
    expect(closeWayLoop(closed, loop.id, createId)).toBe(closed);
    expect(createId).toHaveBeenCalledTimes(1);
  });

  it('straightens only non-junction points and remaps retained junction refs', () => {
    const road = aRoad('road', [
      [0, 0],
      [0.001, 0.001],
      [0.002, 0],
      [0.003, 0.001],
      [0.004, 0],
    ]);
    const branch = aRoad('branch', [
      [0.003, 0.001],
      [0.003, 0.002],
    ]);
    const system = aSystem({
      ways: [road, branch],
      nodes: [
        {
          id: 'junction',
          coord: road.points[3],
          refs: [
            { wayId: road.id, pointIndex: 3 },
            { wayId: branch.id, pointIndex: 0 },
          ],
        },
      ],
    });

    const next = straightenWay(system, road.id);

    expect(next.ways[0].points).toEqual([road.points[0], road.points[3], road.points[4]]);
    expect(next.ways[1]).toBe(branch);
    expect(next.nodes[0].refs[0]).toEqual({ wayId: road.id, pointIndex: 1 });
    expect(straightenWay(next, road.id)).toBe(next);
  });
});
