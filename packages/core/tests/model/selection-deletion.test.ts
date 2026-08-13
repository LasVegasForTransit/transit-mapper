import { laneRefKey } from '../../src/model/components';
import { patternLegs, patternWayIds, wholeLeg } from '../../src/model/geo';
import { deleteSelection } from '../../src/model/selection-deletion';
import { validateSystem } from '../../src/model/validate';
import { aPattern, aRoad, aService, aStop, aSystem } from '../support/fixtures.test';
import { describe, expect, it } from 'vitest';

describe('multi-selection deletion', () => {
  it('preserves the system reference when no selected record exists', () => {
    const system = aSystem();

    expect(deleteSelection(system, [])).toBe(system);
    expect(deleteSelection(system, [{ kind: 'way', id: 'missing' }])).toBe(system);
  });

  it('deleting a way removes every reference to the records it cascades', () => {
    const removed = aRoad('removed', [
      [0, 0],
      [0.001, 0],
    ]);
    const kept = aRoad('kept', [
      [0.001, 0],
      [0.002, 0],
    ]);
    const service = aService('service', [aPattern('pattern', [removed], ['removed'])]);
    const removedLane = removed.profile.lanes[0].id;
    const keptLane = kept.profile.lanes[0].id;
    const system = aSystem({
      ways: [removed, kept],
      services: [service],
      stops: [
        aStop('removed-stop', [0, 0], { wayId: 'removed', t: 0 }),
        aStop(
          'kept-stop',
          [0.001, 0],
          { wayId: 'removed', t: 1 },
          {
            anchors: [
              { wayId: 'removed', t: 1 },
              { wayId: 'kept', t: 0 },
            ],
          },
        ),
      ],
      groups: [{ id: 'group', memberIds: ['removed', 'service', 'removed-stop', 'named', 'kept'] }],
      nodes: [
        {
          id: 'node',
          coord: [0.001, 0],
          refs: [
            { wayId: 'removed', pointIndex: 1 },
            { wayId: 'kept', pointIndex: 0 },
          ],
          connectors: [
            {
              from: { wayId: 'removed', laneId: removedLane },
              to: { wayId: 'kept', laneId: keptLane },
            },
          ],
        },
      ],
      namedWays: [{ id: 'named', name: 'Removed Street', wayIds: ['removed'] }],
      medians: { named: { kindId: 'median', widthM: 3 } },
      turnRestrictions: {
        [laneRefKey('removed', removedLane)]: { allowedTargets: ['kept'] },
        [laneRefKey('kept', keptLane)]: { allowedTargets: ['removed'] },
      },
      approachControls: { 'removed:end': { control: 'stop' } },
    });

    const next = deleteSelection(system, [{ kind: 'way', id: 'removed' }]);

    expect(next.ways).toEqual([kept]);
    expect(next.services).toEqual([]);
    expect(next.lines).toEqual([]);
    expect(next.stops).toEqual([
      expect.objectContaining({
        id: 'kept-stop',
        anchors: [{ wayId: 'kept', t: 0 }],
      }),
    ]);
    expect(next.nodes).toEqual([]);
    expect(next.namedWays).toEqual([]);
    expect(next.medians).toEqual({});
    expect(next.turnRestrictions).toEqual({
      [laneRefKey('kept', keptLane)]: { allowedTargets: [] },
    });
    expect(next.approachControls).toEqual({});
    expect(next.groups[0].memberIds).toEqual(['kept']);
    expect(next.updatedAt).toBe(system.updatedAt);
  });

  it('deleting records leaves unrelated collections structurally shared', () => {
    const facility = { id: 'facility', typeId: 'entrance', geometry: [0, 0] as [number, number] };
    const stop = aStop('stop', [0, 0]);
    const system = aSystem({ facilities: [facility], stops: [stop] });

    const next = deleteSelection(system, [{ kind: 'facility', id: 'facility' }]);

    expect(next).not.toBe(system);
    expect(next.facilities).toEqual([]);
    expect(next.stops).toBe(system.stops);
    expect(next.ways).toBe(system.ways);
    expect(next.services).toBe(system.services);
    expect(next.lines).toBe(system.lines);
  });

  it('deleting a line removes its services and cleans group membership', () => {
    const service = aService('service', []);
    const system = aSystem({
      services: [service],
      groups: [{ id: 'group', memberIds: ['line', service.id] }],
      lines: [{ id: 'line', name: 'Blue', color: '#246bce', serviceIds: [service.id] }],
    });

    const next = deleteSelection(system, [{ kind: 'line', id: 'line' }]);

    expect(next.lines).toEqual([]);
    expect(next.services).toEqual([]);
    expect(next.groups[0].memberIds).toEqual([]);
    expect(next.updatedAt).toBe(system.updatedAt);
  });

  it('deleting several ways is independent of selection order', () => {
    const a = aRoad('a', [
      [0, 0],
      [0.001, 0],
    ]);
    const cutFirst = aRoad('cut-first', [
      [0.001, 0],
      [0.002, 0],
    ]);
    const b = aRoad('b', [
      [0.002, 0],
      [0.003, 0],
    ]);
    const cutSecond = aRoad('cut-second', [
      [0.003, 0],
      [0.004, 0],
    ]);
    const c = aRoad('c', [
      [0.004, 0],
      [0.005, 0],
    ]);
    const ways = [a, cutFirst, b, cutSecond, c];
    const system = aSystem({
      ways,
      services: [
        aService('service', [
          aPattern(
            'path',
            ways,
            ways.map((way) => way.id),
          ),
        ]),
      ],
    });

    const firstOrder = deleteSelection(system, [
      { kind: 'way', id: cutFirst.id },
      { kind: 'way', id: cutSecond.id },
    ]);
    const reverseOrder = deleteSelection(system, [
      { kind: 'way', id: cutSecond.id },
      { kind: 'way', id: cutFirst.id },
    ]);

    expect(patternWayIds(firstOrder.services[0].path)).toEqual(['a']);
    expect(patternWayIds(reverseOrder.services[0].path)).toEqual(['a']);
  });

  it('deleting ways retains the longest surviving service fragment by physical length', () => {
    const long = aRoad('long', [
      [0, 0],
      [0.03, 0],
    ]);
    const cutFirst = aRoad('cut-first', [
      [0.03, 0],
      [0.031, 0],
    ]);
    const shortA = aRoad('short-a', [
      [0.031, 0],
      [0.032, 0],
    ]);
    const shortB = aRoad('short-b', [
      [0.032, 0],
      [0.033, 0],
    ]);
    const cutSecond = aRoad('cut-second', [
      [0.033, 0],
      [0.034, 0],
    ]);
    const tail = aRoad('tail', [
      [0.034, 0],
      [0.035, 0],
    ]);
    const ways = [long, cutFirst, shortA, shortB, cutSecond, tail];
    const system = aSystem({
      ways,
      services: [
        aService('service', [
          aPattern(
            'path',
            ways,
            ways.map((way) => way.id),
          ),
        ]),
      ],
    });

    const next = deleteSelection(system, [
      { kind: 'way', id: cutFirst.id },
      { kind: 'way', id: cutSecond.id },
    ]);

    expect(patternWayIds(next.services[0].path)).toEqual(['long']);
  });

  it('deleting a way at a section boundary keeps one continuous service fragment', () => {
    const a = aRoad('a', [
      [0, 0],
      [0.002, 0],
    ]);
    const cut = aRoad('cut', [
      [0.002, 0],
      [0.003, 0],
    ]);
    const b = aRoad('b', [
      [0.003, 0],
      [0.004, 0],
    ]);
    const ways = [a, cut, b];
    const path = aPattern(
      'path',
      ways,
      ways.map((way) => way.id),
    );
    const legs = patternLegs(path);
    const system = aSystem({
      ways,
      services: [
        aService('service', [
          {
            ...path,
            sections: [
              { kind: 'shared', legs: legs.slice(0, 2) },
              { kind: 'shared', legs: legs.slice(2) },
            ],
          },
        ]),
      ],
    });

    const next = deleteSelection(system, [{ kind: 'way', id: cut.id }]);

    expect(patternWayIds(next.services[0].path)).toEqual(['a']);
    expect(validateSystem(next)).toEqual([]);
  });

  it('deleting one split branch keeps the longest mutually valid service fragment', () => {
    const trunk = aRoad('trunk', [
      [0, 0],
      [0.01, 0],
    ]);
    const shortOutbound = aRoad('short-outbound', [
      [0.01, 0],
      [0.011, 0],
    ]);
    const removedOutbound = aRoad('removed-outbound', [
      [0.011, 0],
      [0.03, 0],
    ]);
    const inbound = aRoad('inbound', [
      [0.03, 0],
      [0.02, 0.001],
      [0.01, 0],
    ]);
    const tail = aRoad('tail', [
      [0.03, 0],
      [0.04, 0],
    ]);
    const ways = [trunk, shortOutbound, removedOutbound, inbound, tail];
    const trunkSection = { kind: 'shared' as const, legs: [wholeLeg(trunk.id)] };
    const system = aSystem({
      ways,
      services: [
        aService('service', [
          {
            id: 'path',
            sections: [
              trunkSection,
              {
                kind: 'split',
                outbound: [wholeLeg(shortOutbound.id), wholeLeg(removedOutbound.id)],
                inbound: [wholeLeg(inbound.id)],
              },
              { kind: 'shared', legs: [wholeLeg(tail.id)] },
            ],
          },
        ]),
      ],
    });

    expect(validateSystem(system)).toEqual([]);

    const next = deleteSelection(system, [{ kind: 'way', id: removedOutbound.id }]);

    expect(validateSystem(next)).toEqual([]);
    expect(patternWayIds(next.services[0].path)).toEqual([trunk.id]);
    expect(next.services[0].path.sections[0]).toBe(trunkSection);
  });

  it('deleting a stop removes its id from every skipped-stop direction', () => {
    const removed = aStop('removed', [0, 0]);
    const kept = aStop('kept', [0.001, 0]);
    const service = aService('service', [], {
      path: {
        id: 'service',
        sections: [],
        skippedStops: {
          outbound: [removed.id, kept.id],
          inbound: [removed.id],
        },
      },
    });
    const system = aSystem({ stops: [removed, kept], services: [service] });

    const next = deleteSelection(system, [{ kind: 'stop', id: removed.id }]);

    expect(next.services[0].path.skippedStops).toEqual({ outbound: [kept.id] });
    expect(next.updatedAt).toBe(system.updatedAt);
  });
});
