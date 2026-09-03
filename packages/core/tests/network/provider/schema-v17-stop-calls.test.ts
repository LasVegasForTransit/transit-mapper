import { describe, expect, it } from 'vitest';
import type { Pattern, TransitSystem, Trip } from '../../../src/transit/authored-system';
import { migrateSchemaV16System } from '../../../src/model/schema-v17-system/migrate-v16';
import { projectPatternStopCalls } from '../../../src/network/schema-v17-system/stop-calls';
import { aPattern, aRoad, aService, aStop, aSystem } from '../../support/fixtures.test';

function v17System(): TransitSystem {
  const way = aRoad('call-way', [
    [-115.2, 36.14],
    [-115.16, 36.14],
  ]);
  const result = migrateSchemaV16System(
    aSystem({
      ways: [way],
      stops: [
        aStop('call-stop-a', [-115.19, 36.14], { wayId: way.id, t: 0.2 }),
        aStop('call-stop-b', [-115.17, 36.14], { wayId: way.id, t: 0.8 }),
      ],
      services: [aService('call-plan', [aPattern('call-pattern', [way], [way.id])])],
    }),
  );
  if (result.kind !== 'migrated') throw new Error('Stop-call fixture did not migrate.');
  return result.system;
}

function patternWithCalls(system: TransitSystem): Pattern {
  const pattern = system.patterns.find((candidate) => candidate.stopCalls.length > 0);
  if (!pattern) throw new Error('The fixture has no Pattern with stop calls.');
  return pattern;
}

function tripFor(pattern: Pattern, pickup: 'regular' | 'none'): Trip {
  return {
    id: 'trip-1',
    patternId: pattern.id,
    calendarId: 'calendar-1',
    stopTimes: pattern.stopCalls.map((call) => ({
      stopCallId: call.id,
      precision: 'unknown' as const,
      pickup,
      dropOff: pickup,
    })),
  };
}

describe('schema-v17 stop call projection', () => {
  it('reports calls in authored order with their own sequence', () => {
    const system = v17System();
    const pattern = patternWithCalls(system);
    const calls = projectPatternStopCalls(pattern, system);

    expect(calls.map((call) => call.stopId)).toEqual(pattern.stopCalls.map((call) => call.stopId));
    expect(calls.map((call) => call.sequence)).toEqual(calls.map((_call, index) => index));
  });

  it('reports unknown service when no Trip mentions the call', () => {
    const system = v17System();
    const pattern = patternWithCalls(system);

    for (const call of projectPatternStopCalls(pattern, { ...system, trips: [] })) {
      expect(call.service).toBe('unknown');
    }
  });

  it('reports served when a Trip boards there', () => {
    const system = v17System();
    const pattern = patternWithCalls(system);
    const withTrip = { ...system, trips: [tripFor(pattern, 'regular')] };

    for (const call of projectPatternStopCalls(pattern, withTrip)) {
      expect(call.service).toBe('served');
    }
  });

  it('reports skipped only when a Trip states no boarding at all', () => {
    const system = v17System();
    const pattern = patternWithCalls(system);
    const withTrip = { ...system, trips: [tripFor(pattern, 'none')] };

    for (const call of projectPatternStopCalls(pattern, withTrip)) {
      expect(call.service).toBe('skipped');
    }
  });

  it('treats one boarding Trip as enough when another skips the same call', () => {
    const system = v17System();
    const pattern = patternWithCalls(system);
    const withTrips = {
      ...system,
      trips: [tripFor(pattern, 'none'), { ...tripFor(pattern, 'regular'), id: 'trip-2' }],
    };

    for (const call of projectPatternStopCalls(pattern, withTrips)) {
      expect(call.service).toBe('served');
    }
  });

  it('ignores Trips that belong to another Pattern', () => {
    const system = v17System();
    const pattern = patternWithCalls(system);
    const foreign = { ...tripFor(pattern, 'regular'), patternId: 'another-pattern' };

    for (const call of projectPatternStopCalls(pattern, { ...system, trips: [foreign] })) {
      expect(call.service).toBe('unknown');
    }
  });
});
