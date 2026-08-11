import { describe, expect, it, vi } from 'vitest';
import { laneCapacity } from '../../src/model/profile';
import {
  continueNamedWay,
  nameWay,
  renameNamedWay,
  withWayCapacity,
  withWayClass,
  withWayGeometry,
  withWayGrade,
  withWayProfile,
} from '../../src/model/way-property-edits';
import { aRoad, aStation, aSystem } from '../support/fixtures.test';

describe('way property transform identity', () => {
  it('preserves the input for missing ways and named-way identities', () => {
    const system = aSystem();

    expect(withWayGeometry(system, 'missing', 'curved')).toBe(system);
    expect(withWayGrade(system, 'missing', 'elevated')).toBe(system);
    expect(withWayClass(system, 'missing', 'arterial')).toBe(system);
    expect(withWayProfile(system, 'missing', { lanes: [] })).toBe(system);
    expect(withWayCapacity(system, 'missing', 3, 'right')).toBe(system);
    expect(renameNamedWay(system, 'missing', 'Main Street')).toBe(system);
    expect(continueNamedWay(system, 'missing', 'branch')).toBe(system);
  });

  it('preserves the input when each way property already matches', () => {
    const road = aRoad(
      'road',
      [
        [0, 0],
        [0.001, 0],
      ],
      { classId: 'arterial' },
    );
    const system = aSystem({ ways: [road] });

    expect(withWayGeometry(system, road.id, road.geometry)).toBe(system);
    expect(withWayGrade(system, road.id, road.grade)).toBe(system);
    expect(withWayClass(system, road.id, road.classId)).toBe(system);
    expect(withWayProfile(system, road.id, road.profile)).toBe(system);
    expect(
      withWayProfile(system, road.id, {
        lanes: road.profile.lanes.map((lane) => ({ ...lane })),
      }),
    ).toBe(system);
    expect(withWayCapacity(system, road.id, laneCapacity(road.profile), 'right')).toBe(system);
  });

  it('replaces only the edited way and leaves timestamp policy to its caller', () => {
    const road = aRoad('road', [
      [0, 0],
      [0.001, 0],
    ]);
    const untouched = aRoad('untouched', [
      [1, 1],
      [1.001, 1],
    ]);
    const station = aStation('station', [0.0005, 0], { wayId: road.id, t: 0.5 });
    const system = aSystem({ updatedAt: 321, ways: [road, untouched], stations: [station] });

    const withGeometry = withWayGeometry(system, road.id, 'curved');
    expect(withGeometry.ways[0]).toEqual({ ...road, geometry: 'curved' });
    expect(withGeometry.ways[1]).toBe(untouched);
    expect(withGeometry.updatedAt).toBe(321);

    const withGrade = withWayGrade(withGeometry, road.id, 'elevated');
    expect(withGrade.ways[0].grade).toBe('elevated');
    expect(withGrade.ways[1]).toBe(untouched);

    const withClass = withWayClass(withGrade, road.id, 'arterial');
    expect(withClass.ways[0].classId).toBe('arterial');
    expect(withClass.ways[1]).toBe(untouched);
  });

  it('changes capacity structurally while preserving unrelated records', () => {
    const road = aRoad('road', [
      [0, 0],
      [0.001, 0],
    ]);
    const untouched = aRoad('untouched', [
      [1, 1],
      [1.001, 1],
    ]);
    const system = aSystem({ ways: [road, untouched] });

    const next = withWayCapacity(system, road.id, 3, 'right');

    expect(laneCapacity(next.ways[0].profile)).toBe(3);
    expect(next.ways[1]).toBe(untouched);
    expect(next.nodes).toBe(system.nodes);
  });

  it('joins an existing named way without minting a duplicate identity', () => {
    const first = aRoad('first', [
      [0, 0],
      [0.001, 0],
    ]);
    const second = aRoad('second', [
      [0, 0.001],
      [0.001, 0.001],
    ]);
    const createId = vi.fn(() => 'unused');
    const system = aSystem({
      ways: [first, second],
      namedWays: [{ id: 'main', name: 'Main Street', wayIds: [first.id] }],
    });

    const next = nameWay(system, second.id, '  Main Street  ', createId);

    expect(next.namedWays).toEqual([
      { id: 'main', name: 'Main Street', wayIds: [first.id, second.id] },
    ]);
    expect(createId).not.toHaveBeenCalled();
    expect(next.ways).toBe(system.ways);
  });

  it('creates, renames, continues, and clears shared way identity immutably', () => {
    const first = aRoad('first', [
      [0, 0],
      [0.001, 0],
    ]);
    const branch = aRoad('branch', [
      [0, 0],
      [0, 0.001],
    ]);
    const system = aSystem({ ways: [first, branch] });

    const named = nameWay(system, first.id, '  Broadway  ', () => 'broadway');
    expect(named.namedWays).toEqual([{ id: 'broadway', name: 'Broadway', wayIds: [first.id] }]);

    const continued = continueNamedWay(named, first.id, branch.id);
    expect(continued.namedWays[0].wayIds).toEqual([first.id, branch.id]);
    expect(continueNamedWay(continued, first.id, branch.id)).toBe(continued);

    const renamed = renameNamedWay(continued, 'broadway', '  Downtown Broadway  ');
    expect(renamed.namedWays[0].name).toBe('Downtown Broadway');
    expect(renameNamedWay(renamed, 'broadway', 'Downtown Broadway')).toBe(renamed);

    const cleared = nameWay(renamed, first.id, '   ');
    expect(cleared.namedWays[0].wayIds).toEqual([branch.id]);
    expect(cleared.ways).toBe(system.ways);
  });
});
