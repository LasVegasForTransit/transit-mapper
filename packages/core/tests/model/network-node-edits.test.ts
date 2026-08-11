import { armRefKey, laneRefKey } from '../../src/model/components';
import { haversineMeters } from '../../src/model/geo';
import {
  disconnectNodeWay,
  setApproachControl,
  setDrivingSide,
  setNodeConnectors,
  setNodeControl,
  setTurnRestriction,
} from '../../src/model/network-node-edits';
import type { LaneConnector } from '../../src/model/system';
import { aRoad, aStation, aSystem } from '../support/fixtures.test';
import { describe, expect, it } from 'vitest';

describe('pure network node edits', () => {
  it('sets whole-node control without touching timestamps or unrelated collections', () => {
    const first = aRoad('first', [
      [0, 0],
      [0.001, 0],
    ]);
    const second = aRoad('second', [
      [0, 0],
      [0, 0.001],
    ]);
    const system = aSystem({
      updatedAt: 123,
      ways: [first, second],
      nodes: [
        {
          id: 'junction',
          coord: [0, 0],
          refs: [
            { wayId: first.id, pointIndex: 0 },
            { wayId: second.id, pointIndex: 0 },
          ],
        },
      ],
    });

    const next = setNodeControl(system, 'junction', 'signal');

    expect(next).not.toBe(system);
    expect(next.nodes[0]).toEqual({ ...system.nodes[0], control: 'signal' });
    expect(next.nodes).not.toBe(system.nodes);
    expect(next.ways).toBe(system.ways);
    expect(next.updatedAt).toBe(123);
    expect(setNodeControl(next, 'junction', 'signal')).toBe(next);
    expect(setNodeControl(system, 'missing', 'signal')).toBe(system);
    expect(setNodeControl(system, 'junction', undefined)).toBe(system);
  });

  it('sets and clears an explicit lane graph with structural no-op detection', () => {
    const first = aRoad('first', [
      [0, 0],
      [0.001, 0],
    ]);
    const second = aRoad('second', [
      [0, 0],
      [0, 0.001],
    ]);
    const connectors: LaneConnector[] = [
      {
        from: { wayId: first.id, laneId: first.profile.lanes[0].id },
        to: { wayId: second.id, laneId: second.profile.lanes[0].id },
      },
    ];
    const system = aSystem({
      ways: [first, second],
      nodes: [
        {
          id: 'junction',
          coord: [0, 0],
          refs: [
            { wayId: first.id, pointIndex: 0 },
            { wayId: second.id, pointIndex: 0 },
          ],
        },
      ],
    });

    const next = setNodeConnectors(system, 'junction', connectors);

    expect(next.nodes[0].connectors).toBe(connectors);
    expect(setNodeConnectors(next, 'junction', structuredClone(connectors))).toBe(next);
    expect(setNodeConnectors(system, 'missing', connectors)).toBe(system);
    expect(setNodeConnectors(system, 'junction', undefined)).toBe(system);
    const cleared = setNodeConnectors(next, 'junction', undefined);
    expect(cleared.nodes[0]).not.toHaveProperty('connectors');
    expect(cleared.updatedAt).toBe(system.updatedAt);
  });

  it('sets and clears one approach control without replacing equal systems', () => {
    const way = aRoad('way', [
      [0, 0],
      [0.001, 0],
    ]);
    const system = aSystem({ updatedAt: 456, ways: [way] });
    const key = armRefKey(way.id, 'start');

    const next = setApproachControl(system, way.id, 'start', 'stop');

    expect(next.approachControls).toEqual({ [key]: { control: 'stop' } });
    expect(next.ways).toBe(system.ways);
    expect(next.updatedAt).toBe(456);
    expect(setApproachControl(next, way.id, 'start', 'stop')).toBe(next);
    expect(setApproachControl(system, way.id, 'start', undefined)).toBe(system);
    expect(setApproachControl(next, way.id, 'start', undefined).approachControls).toEqual({});
  });

  it('sets and clears one lane restriction while treating target order as semantic noise', () => {
    const way = aRoad('way', [
      [0, 0],
      [0.001, 0],
    ]);
    const laneId = way.profile.lanes[0].id;
    const system = aSystem({ updatedAt: 789, ways: [way] });
    const key = laneRefKey(way.id, laneId);

    const next = setTurnRestriction(system, way.id, laneId, ['north', 'east']);

    expect(next.turnRestrictions).toEqual({
      [key]: { allowedTargets: ['north', 'east'] },
    });
    expect(next.updatedAt).toBe(789);
    expect(setTurnRestriction(next, way.id, laneId, ['east', 'north'])).toBe(next);
    expect(setTurnRestriction(system, way.id, laneId, undefined)).toBe(system);
    expect(setTurnRestriction(next, way.id, laneId, undefined).turnRestrictions).toEqual({});
  });

  it('changes the document driving side without rewriting an equal value', () => {
    const system = aSystem({ drivingSide: 'right', updatedAt: 987 });

    expect(setDrivingSide(system, 'right')).toBe(system);
    const next = setDrivingSide(system, 'left');
    expect(next).toEqual({ ...system, drivingSide: 'left' });
    expect(next.updatedAt).toBe(987);
  });

  it('disconnects one arm by nudging its geometry and cleaning dependent node data', () => {
    const leaving = aRoad('leaving', [
      [0, 0],
      [0.001, 0],
    ]);
    const north = aRoad('north', [
      [0, 0],
      [0, 0.001],
    ]);
    const west = aRoad('west', [
      [0, 0],
      [-0.001, 0],
    ]);
    const rider = aStation('rider', [0.0001, 0], { wayId: leaving.id, t: 0.1 });
    const bystander = aStation('bystander', [0, 0.0001], { wayId: north.id, t: 0.1 });
    const connectors: LaneConnector[] = [
      {
        from: { wayId: leaving.id, laneId: leaving.profile.lanes[0].id },
        to: { wayId: north.id, laneId: north.profile.lanes[0].id },
      },
      {
        from: { wayId: north.id, laneId: north.profile.lanes[0].id },
        to: { wayId: leaving.id, laneId: leaving.profile.lanes[0].id },
      },
      {
        from: { wayId: north.id, laneId: north.profile.lanes[0].id },
        to: { wayId: west.id, laneId: west.profile.lanes[0].id },
      },
    ];
    const system = aSystem({
      updatedAt: 321,
      ways: [leaving, north, west],
      stations: [rider, bystander],
      nodes: [
        {
          id: 'junction',
          coord: [0, 0],
          refs: [
            { wayId: leaving.id, pointIndex: 0 },
            { wayId: north.id, pointIndex: 0 },
            { wayId: west.id, pointIndex: 0 },
          ],
          connectors,
        },
      ],
    });

    const next = disconnectNodeWay(system, 'junction', leaving.id);

    const nextLeaving = next.ways[0];
    expect(nextLeaving.id).toBe(leaving.id);
    expect(haversineMeters(leaving.points[0], nextLeaving.points[0])).toBeCloseTo(12, 1);
    expect(nextLeaving.points[1]).toBe(leaving.points[1]);
    expect(next.ways[1]).toBe(north);
    expect(next.ways[2]).toBe(west);
    expect(next.nodes[0].refs).toEqual([
      { wayId: north.id, pointIndex: 0 },
      { wayId: west.id, pointIndex: 0 },
    ]);
    expect(next.nodes[0].connectors).toEqual([connectors[2]]);
    expect(next.stations[0]).not.toBe(rider);
    expect(next.stations[0].coord).not.toEqual(rider.coord);
    expect(next.stations[1]).toBe(bystander);
    expect(next.updatedAt).toBe(321);
    expect(disconnectNodeWay(system, 'missing', leaving.id)).toBe(system);
    expect(disconnectNodeWay(system, 'junction', 'missing')).toBe(system);
  });
});
