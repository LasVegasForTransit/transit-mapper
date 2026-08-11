import { describe, expect, it } from 'vitest';
import {
  deleteLine,
  moveServiceToLine,
  setLineColor,
  setLineName,
  setServiceFrequency,
  setServiceMode,
  setServiceName,
  setServiceSchedule,
  setServiceSpan,
  setServiceVehicleKind,
} from '../../src/model/system';
import type { SchedulePeriod } from '../../src/model/system';
import { aPattern, aRoad, aService, aSystem } from '../support/fixtures.test';

describe('service record transform identity', () => {
  const way = aRoad('way', [
    [0, 0],
    [0.001, 0],
  ]);
  const pattern = aPattern('pattern', [way], [way.id]);

  it('preserves the input for missing services and equal metadata', () => {
    const schedule: SchedulePeriod[] = [
      {
        id: 'peak',
        label: 'Peak',
        days: 'weekday',
        spanStart: '06:00',
        spanEnd: '09:00',
        frequencyMinutes: 10,
      },
    ];
    const service = aService('service', [pattern], {
      name: 'Blue local',
      modeId: 'bus',
      frequencyMinutes: 15,
      spanStart: '05:00',
      spanEnd: '23:00',
      schedule,
      vehicleKindId: 'articulated-bus',
    });
    const system = aSystem({ ways: [way], services: [service] });

    expect(setServiceName(system, 'missing', 'Ghost')).toBe(system);
    expect(setServiceMode(system, 'missing', 'rail')).toBe(system);
    expect(setServiceFrequency(system, 'missing', 10)).toBe(system);
    expect(setServiceSpan(system, 'missing', '06:00', '22:00')).toBe(system);
    expect(setServiceSchedule(system, 'missing', schedule)).toBe(system);
    expect(setServiceVehicleKind(system, 'missing', 'tram')).toBe(system);
    expect(setServiceName(system, service.id, 'Blue local')).toBe(system);
    expect(setServiceMode(system, service.id, 'bus')).toBe(system);
    expect(setServiceFrequency(system, service.id, 15)).toBe(system);
    expect(setServiceSpan(system, service.id, '05:00', '23:00')).toBe(system);
    expect(setServiceSchedule(system, service.id, schedule)).toBe(system);
    expect(setServiceVehicleKind(system, service.id, 'articulated-bus')).toBe(system);
  });

  it('replaces only the edited service and preserves timestamp policy', () => {
    const service = aService('service', [pattern]);
    const untouched = aService('untouched', [pattern]);
    const system = aSystem({ updatedAt: 444, ways: [way], services: [service, untouched] });

    const named = setServiceName(system, service.id, 'Blue local');
    expect(named.services[0].name).toBe('Blue local');
    expect(named.services[1]).toBe(untouched);

    const moded = setServiceMode(named, service.id, 'rail');
    expect(moded.services[0].modeId).toBe('rail');
    expect(moded.services[1]).toBe(untouched);

    const frequent = setServiceFrequency(moded, service.id, 8);
    expect(frequent.services[0].frequencyMinutes).toBe(8);
    expect(frequent.services[1]).toBe(untouched);

    const vehicle = setServiceVehicleKind(frequent, service.id, 'tram');
    expect(vehicle.services[0].vehicleKindId).toBe('tram');
    expect(vehicle.services[1]).toBe(untouched);
    expect(vehicle.lines).toBe(system.lines);
    expect(vehicle.updatedAt).toBe(444);
  });

  it('normalizes empty schedules to undefined without rewriting an empty service', () => {
    const service = aService('service', [pattern], { schedule: undefined });
    const system = aSystem({ ways: [way], services: [service] });

    expect(setServiceSchedule(system, service.id, [])).toBe(system);

    const periods: SchedulePeriod[] = [
      {
        id: 'weekend',
        label: 'Weekend',
        days: 'weekend',
        spanStart: '08:00',
        spanEnd: '20:00',
        frequencyMinutes: 20,
      },
    ];
    const scheduled = setServiceSchedule(system, service.id, periods);
    expect(scheduled.services[0].schedule).toBe(periods);

    const cleared = setServiceSchedule(scheduled, service.id, []);
    expect(cleared.services[0]).toHaveProperty('schedule', undefined);
  });
});

describe('line record transform identity', () => {
  it('replaces only the edited line metadata', () => {
    const first = { id: 'first', name: 'Blue', color: '#246bce', serviceIds: ['service'] };
    const untouched = { id: 'untouched', name: 'Red', color: '#e5252a', serviceIds: [] };
    const service = aService('service', []);
    const system = aSystem({ updatedAt: 555, lines: [first, untouched], services: [service] });

    const named = setLineName(system, first.id, 'Blue Line');
    expect(named.lines[0]).toEqual({ ...first, name: 'Blue Line' });
    expect(named.lines[1]).toBe(untouched);

    const colored = setLineColor(named, first.id, '#123456');
    expect(colored.lines[0].color).toBe('#123456');
    expect(colored.lines[1]).toBe(untouched);
    expect(colored.services).toBe(system.services);
    expect(colored.updatedAt).toBe(555);
  });

  it('preserves the input for missing line mutations', () => {
    const system = aSystem();

    expect(setLineName(system, 'missing', 'Ghost')).toBe(system);
    expect(setLineColor(system, 'missing', '#000000')).toBe(system);
    expect(deleteLine(system, 'missing')).toBe(system);
    expect(moveServiceToLine(system, 'missing', 'also-missing')).toBe(system);
  });

  it('preserves the service collection when deleting a line that owns no services', () => {
    const service = aService('service', []);
    const emptyLine = { id: 'empty', name: 'Empty', color: '#999999', serviceIds: [] };
    const keptLine = { id: 'kept', name: 'Blue', color: '#246bce', serviceIds: [service.id] };
    const system = aSystem({ lines: [emptyLine, keptLine], services: [service] });

    const next = deleteLine(system, emptyLine.id);

    expect(next.lines).toEqual([keptLine]);
    expect(next.services).toBe(system.services);
  });

  it('moves an explicitly named service without rewriting its name or unrelated lines', () => {
    const service = aService('service', [], { name: 'Express' });
    const source = { id: 'source', name: 'Blue', color: '#246bce', serviceIds: [service.id] };
    const target = { id: 'target', name: 'Red', color: '#e5252a', serviceIds: [] };
    const untouched = { id: 'untouched', name: 'Green', color: '#00933c', serviceIds: ['other'] };
    const system = aSystem({ lines: [source, target, untouched], services: [service] });

    const next = moveServiceToLine(system, service.id, target.id);

    expect(next.lines).toEqual([{ ...target, serviceIds: [service.id] }, untouched]);
    expect(next.lines[1]).toBe(untouched);
    expect(next.services).toBe(system.services);
  });
});
