import { laneRefKey } from '../../src/model/components';
import { deleteSelection } from '../../src/model/selection-deletion';
import { aPattern, aRoad, aService, aStation, aSystem } from '../support/fixtures.test';
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
      stations: [
        aStation('removed-station', [0, 0], { wayId: 'removed', t: 0 }),
        aStation(
          'kept-station',
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
      groups: [{ id: 'group', memberIds: ['removed', 'service', 'removed-station', 'kept'] }],
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
    expect(next.stations).toEqual([
      expect.objectContaining({
        id: 'kept-station',
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
    const station = aStation('station', [0, 0]);
    const system = aSystem({ facilities: [facility], stations: [station] });

    const next = deleteSelection(system, [{ kind: 'facility', id: 'facility' }]);

    expect(next).not.toBe(system);
    expect(next.facilities).toEqual([]);
    expect(next.stations).toBe(system.stations);
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
});
