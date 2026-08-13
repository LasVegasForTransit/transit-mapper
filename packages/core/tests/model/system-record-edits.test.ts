import { describe, expect, it } from 'vitest';
import {
  addGroupMember,
  deleteLine,
  moveFacility,
  moveServiceToLine,
  moveServicesToLine,
  moveStop,
  renameGroup,
  setFacilityName,
  setLineColor,
  setLineName,
  setServiceName,
  setServiceSpan,
  setStopName,
} from '../../src/model/system';
import type { Facility, Group } from '../../src/model/system';
import { aPattern, aRoad, aService, aStop, aSystem } from '../support/fixtures.test';

describe('stop record edits', () => {
  it('preserves the document when stop metadata already matches', () => {
    const stop = aStop('stop', [-115.2, 36.1], undefined, { name: 'Central' });
    const system = aSystem({ stops: [stop] });

    expect(setStopName(system, stop.id, 'Central', false)).toBe(system);
  });

  it('replaces only the moved stop and the stops collection', () => {
    const moved = aStop('moved', [-115.2, 36.1]);
    const untouched = aStop('untouched', [-115.19, 36.1]);
    const system = aSystem({ stops: [moved, untouched] });

    const next = moveStop(system, moved.id, [-115.18, 36.1], {
      wayId: 'corridor',
      t: 0.25,
    });

    expect(next).not.toBe(system);
    expect(next.stops).not.toBe(system.stops);
    expect(next.stops[0]).toEqual({
      ...moved,
      coord: [-115.18, 36.1],
      anchors: [{ wayId: 'corridor', t: 0.25 }],
    });
    expect(next.stops[1]).toBe(untouched);
    expect('anchor' in next.stops[0]).toBe(false);
  });
});

describe('facility record edits', () => {
  it('preserves the document for an equivalent facility geometry', () => {
    const facility: Facility = {
      id: 'facility',
      typeId: 'bike-share',
      geometry: [
        [-115.2, 36.1],
        [-115.19, 36.1],
      ],
    };
    const system = aSystem({ facilities: [facility] });

    expect(
      moveFacility(system, facility.id, [
        [-115.2, 36.1],
        [-115.19, 36.1],
      ]),
    ).toBe(system);
  });

  it('replaces only the renamed facility', () => {
    const facility: Facility = { id: 'facility', typeId: 'depot', geometry: [-115.2, 36.1] };
    const untouched: Facility = {
      id: 'untouched',
      typeId: 'depot',
      geometry: [-115.19, 36.1],
    };
    const system = aSystem({ facilities: [facility, untouched] });

    const next = setFacilityName(system, facility.id, 'North depot');

    expect(next.facilities[0]).toEqual({ ...facility, name: 'North depot' });
    expect(next.facilities[1]).toBe(untouched);
  });
});

describe('group record edits', () => {
  it('preserves the document when adding an existing member', () => {
    const group: Group = { id: 'group', memberIds: ['stop'] };
    const system = aSystem({ groups: [group] });

    expect(addGroupMember(system, group.id, 'stop')).toBe(system);
  });

  it('replaces only the renamed group', () => {
    const group: Group = { id: 'group', memberIds: [] };
    const untouched: Group = { id: 'untouched', memberIds: [] };
    const system = aSystem({ groups: [group, untouched] });

    const next = renameGroup(system, group.id, 'Downtown complex');

    expect(next.groups[0]).toEqual({ ...group, name: 'Downtown complex' });
    expect(next.groups[1]).toBe(untouched);
  });
});

describe('service record edits', () => {
  const way = aRoad('way', [
    [-115.2, 36.1],
    [-115.19, 36.1],
  ]);
  const firstPattern = aPattern('first', [way], [way.id]);
  const secondPattern = aPattern('second', [way], [way.id]);

  it('preserves the document when service metadata already matches', () => {
    const service = aService('service', [firstPattern], { name: 'Blue' });
    const system = aSystem({ ways: [way], services: [service] });

    expect(setServiceName(system, service.id, 'Blue')).toBe(system);
  });

  it('replaces only the edited service', () => {
    const service = aService('service', [firstPattern]);
    const untouched = aService('untouched', [secondPattern]);
    const system = aSystem({ ways: [way], services: [service, untouched] });

    const next = setServiceSpan(system, service.id, '05:00', '23:30');

    expect(next.services[0]).toEqual({ ...service, spanStart: '05:00', spanEnd: '23:30' });
    expect(next.services[1]).toBe(untouched);
  });

  it('moves a service between lines and removes an emptied source line', () => {
    const source = aService('source', [firstPattern], { name: undefined });
    const target = aService('target', [secondPattern]);
    const system = aSystem({
      ways: [way],
      services: [source, target],
      lines: [
        { id: 'source-line', name: 'Blue', color: '#246bce', serviceIds: [source.id] },
        { id: 'target-line', name: 'Red', color: '#e5252a', serviceIds: [target.id] },
      ],
      groups: [
        { id: 'line-family', memberIds: ['source-line', 'target-line'] },
        { id: 'unrelated', memberIds: ['stop'] },
      ],
    });

    const next = moveServiceToLine(system, source.id, 'target-line');

    expect(next.lines).toEqual([
      {
        id: 'target-line',
        name: 'Red',
        color: '#e5252a',
        serviceIds: [target.id, source.id],
      },
    ]);
    expect(next.services[0]).toEqual({ ...source, name: 'Blue' });
    expect(next.services[1]).toBe(target);
    expect(next.groups).toEqual([
      { id: 'line-family', memberIds: ['target-line'] },
      system.groups[1],
    ]);
    expect(next.updatedAt).toBe(system.updatedAt);
  });

  it('preserves the document when a service already belongs to the target line', () => {
    const service = aService('service', [firstPattern]);
    const system = aSystem({ services: [service] });

    expect(moveServiceToLine(system, service.id, service.id)).toBe(system);
  });

  it('moves several services between lines as one immutable transformation', () => {
    const first = aService('first', [firstPattern], { name: undefined });
    const second = aService('second', [secondPattern], { name: undefined });
    const target = aService('target', []);
    const system = aSystem({
      ways: [way],
      services: [first, second, target],
      lines: [
        { id: 'source-line', name: 'Blue', color: '#246bce', serviceIds: [first.id, second.id] },
        { id: 'target-line', name: 'Red', color: '#e5252a', serviceIds: [target.id] },
      ],
      groups: [{ id: 'family', memberIds: ['source-line', 'target-line'] }],
    });

    const next = moveServicesToLine(system, [first.id, second.id], 'target-line');

    expect(next.lines).toEqual([
      {
        id: 'target-line',
        name: 'Red',
        color: '#e5252a',
        serviceIds: [target.id, first.id, second.id],
      },
    ]);
    expect(next.services.slice(0, 2).map((service) => service.name)).toEqual(['Blue', 'Blue']);
    expect(next.groups).toEqual([{ id: 'family', memberIds: ['target-line'] }]);
    expect(next.updatedAt).toBe(system.updatedAt);
    expect(moveServicesToLine(system, [], 'target-line')).toBe(system);
  });
});

describe('line record edits', () => {
  it('preserves the document when line metadata already matches', () => {
    const system = aSystem({
      lines: [{ id: 'line', name: 'Blue', color: '#246bce', serviceIds: [] }],
    });

    expect(setLineName(system, 'line', 'Blue')).toBe(system);
    expect(setLineColor(system, 'line', '#246bce')).toBe(system);
  });

  it('deletes the line and only its owned services', () => {
    const removed = aService('removed', []);
    const kept = aService('kept', []);
    const system = aSystem({
      services: [removed, kept],
      lines: [
        { id: 'removed-line', name: 'Blue', color: '#246bce', serviceIds: [removed.id] },
        { id: 'kept-line', name: 'Red', color: '#e5252a', serviceIds: [kept.id] },
      ],
    });

    const next = deleteLine(system, 'removed-line');

    expect(next.lines).toEqual([system.lines[1]]);
    expect(next.services).toEqual([kept]);
    expect(next.updatedAt).toBe(system.updatedAt);
  });
});
