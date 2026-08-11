import { describe, expect, it } from 'vitest';
import {
  addGroupFootprint,
  addGroupMember,
  createFacility,
  createGroup,
  deleteGroup,
  deleteGroupFootprint,
  moveFacility,
  moveGroupFootprintPoint,
  removeGroupMember,
  removeGroupMembers,
  renameGroup,
  setFacilityName,
  setGroupColor,
} from '../../src/model/system';
import type { Facility, Group } from '../../src/model/system';
import { aSystem } from '../support/fixtures.test';

describe('facility record transform identity', () => {
  it('creates a typed facility without copying its geometry', () => {
    const geometry: [number, number][] = [
      [0, 0],
      [0.001, 0],
      [0.001, 0.001],
    ];

    const facility = createFacility('depot', geometry);

    expect(facility.id).toEqual(expect.any(String));
    expect(facility.typeId).toBe('depot');
    expect(facility.geometry).toBe(geometry);
  });

  it('preserves the input for missing facilities and equal metadata', () => {
    const facility: Facility = {
      id: 'facility',
      typeId: 'depot',
      name: 'North depot',
      geometry: [0, 0],
    };
    const system = aSystem({ facilities: [facility] });

    expect(moveFacility(system, 'missing', [1, 1])).toBe(system);
    expect(setFacilityName(system, 'missing', 'Ghost')).toBe(system);
    expect(moveFacility(system, facility.id, [0, 0])).toBe(system);
    expect(setFacilityName(system, facility.id, 'North depot')).toBe(system);
  });

  it('replaces only a moved facility and preserves unrelated collections', () => {
    const facility: Facility = { id: 'facility', typeId: 'depot', geometry: [0, 0] };
    const untouched: Facility = { id: 'untouched', typeId: 'depot', geometry: [1, 1] };
    const system = aSystem({ updatedAt: 111, facilities: [facility, untouched] });

    const next = moveFacility(system, facility.id, [0.001, 0]);

    expect(next.facilities[0]).toEqual({ ...facility, geometry: [0.001, 0] });
    expect(next.facilities[1]).toBe(untouched);
    expect(next.ways).toBe(system.ways);
    expect(next.updatedAt).toBe(111);
  });
});

describe('group record transform identity', () => {
  it('creates a group with stable member order and no duplicates', () => {
    const group = createGroup(['station', 'way', 'station'], 'Complex');

    expect(group.id).toEqual(expect.any(String));
    expect(group.name).toBe('Complex');
    expect(group.memberIds).toEqual(['station', 'way']);
  });

  it('preserves the input for missing groups and equal or absent edits', () => {
    const group: Group = {
      id: 'group',
      name: 'Downtown',
      color: '#246bce',
      memberIds: ['station'],
      footprint: [
        [0, 0],
        [0.001, 0],
        [0.001, 0.001],
      ],
    };
    const system = aSystem({ groups: [group] });

    expect(addGroupMember(system, 'missing', 'way')).toBe(system);
    expect(removeGroupMember(system, 'missing', 'station')).toBe(system);
    expect(renameGroup(system, 'missing', 'Ghost')).toBe(system);
    expect(setGroupColor(system, 'missing', '#000000')).toBe(system);
    expect(deleteGroup(system, 'missing')).toBe(system);
    expect(addGroupFootprint(system, group.id, [[2, 2]])).toBe(system);
    expect(moveGroupFootprintPoint(system, group.id, 0, group.footprint?.[0] ?? [0, 0])).toBe(
      system,
    );
    expect(moveGroupFootprintPoint(system, group.id, 10, [2, 2])).toBe(system);
    expect(renameGroup(system, group.id, 'Downtown')).toBe(system);
    expect(setGroupColor(system, group.id, '#246bce')).toBe(system);
    expect(addGroupMember(system, group.id, 'station')).toBe(system);
    expect(removeGroupMember(system, group.id, 'missing')).toBe(system);
  });

  it('adds and removes members while preserving untouched group records', () => {
    const group: Group = { id: 'group', memberIds: ['station'] };
    const untouched: Group = { id: 'untouched', memberIds: ['facility'] };
    const system = aSystem({ updatedAt: 222, groups: [group, untouched] });

    const added = addGroupMember(system, group.id, 'way');
    expect(added.groups[0].memberIds).toEqual(['station', 'way']);
    expect(added.groups[1]).toBe(untouched);

    const removed = removeGroupMember(added, group.id, 'station');
    expect(removed.groups[0].memberIds).toEqual(['way']);
    expect(removed.groups[1]).toBe(untouched);
    expect(removed.updatedAt).toBe(222);
  });

  it('removes deleted records from every group and preserves untouched group references', () => {
    const affected: Group = { id: 'affected', memberIds: ['station', 'way', 'facility'] };
    const untouched: Group = { id: 'untouched', memberIds: ['other'] };
    const system = aSystem({ groups: [affected, untouched] });

    expect(removeGroupMembers(system, new Set())).toBe(system);
    expect(removeGroupMembers(system, new Set(['missing']))).toBe(system);

    const next = removeGroupMembers(system, new Set(['station', 'facility']));
    expect(next.groups[0]).toEqual({ ...affected, memberIds: ['way'] });
    expect(next.groups[1]).toBe(untouched);
  });

  it('sets optional metadata without rewriting unrelated collections', () => {
    const group: Group = { id: 'group', memberIds: [] };
    const system = aSystem({ groups: [group] });

    const renamed = renameGroup(system, group.id, 'Complex');
    const colored = setGroupColor(renamed, group.id, '#e5252a');
    const cleared = setGroupColor(colored, group.id, undefined);

    expect(renamed.groups[0].name).toBe('Complex');
    expect(colored.groups[0].color).toBe('#e5252a');
    expect(cleared.groups[0]).toHaveProperty('color', undefined);
    expect(cleared.facilities).toBe(system.facilities);
  });

  it('adds, moves, and removes a footprint immutably', () => {
    const group: Group = { id: 'group', memberIds: [] };
    const footprint: [number, number][] = [
      [0, 0],
      [0.001, 0],
      [0.001, 0.001],
    ];
    const system = aSystem({ groups: [group] });

    const added = addGroupFootprint(system, group.id, footprint);
    expect(added.groups[0].footprint).toBe(footprint);

    const moved = moveGroupFootprintPoint(added, group.id, 1, [0.002, 0]);
    expect(moved.groups[0].footprint).toEqual([footprint[0], [0.002, 0], footprint[2]]);

    const deleted = deleteGroupFootprint(moved, group.id);
    expect(deleted.groups[0]).toHaveProperty('footprint', undefined);
    expect(deleteGroupFootprint(deleted, group.id)).toBe(deleted);
  });

  it('deletes only the selected group', () => {
    const removed: Group = { id: 'removed', memberIds: [] };
    const kept: Group = { id: 'kept', memberIds: [] };
    const system = aSystem({ groups: [removed, kept] });

    const next = deleteGroup(system, removed.id);

    expect(next.groups).toEqual([kept]);
    expect(next.ways).toBe(system.ways);
  });
});
