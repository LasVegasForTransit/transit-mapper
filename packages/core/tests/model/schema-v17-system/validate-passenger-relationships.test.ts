import { describe, expect, it } from 'vitest';
import type { TransitSystem } from '../../../src/transit/authored-system';
import { migrateSchemaV16System } from '../../../src/model/schema-v17-system/migrate-v16';
import { validateAuthoredPassengerRelationships } from '../../../src/model/schema-v17-system/validate-passenger-relationships';
import { aPattern, aRoad, aService, aStop, aSystem } from '../../support/fixtures.test';

function passengerSystem(): TransitSystem {
  const way = aRoad('route-way', [
    [-115.2, 36.14],
    [-115.16, 36.14],
  ]);
  const service = aService('route-plan', [aPattern('route-pattern', [way], [way.id])], {
    schedule: [
      {
        id: 'weekday',
        label: 'Weekday',
        days: 'weekday',
        spanStart: '06:00',
        spanEnd: '22:00',
        frequencyMinutes: 10,
      },
    ],
  });
  const result = migrateSchemaV16System(
    aSystem({
      ways: [way],
      stops: [aStop('route-stop', [-115.18, 36.14], { wayId: way.id, t: 0.5 })],
      services: [service],
    }),
  );
  if (result.kind !== 'migrated') throw new Error('Passenger fixture did not migrate.');
  return result.system;
}

describe('schema-v17 passenger relationships', () => {
  it('accepts the complete relationship graph produced by v16 migration', () => {
    expect(() => validateAuthoredPassengerRelationships(passengerSystem())).not.toThrow();
  });

  it('requires every ServicePlan to have exactly one Line owner', () => {
    const missingOwner = passengerSystem();
    missingOwner.lines = [];
    expect(() => validateAuthoredPassengerRelationships(missingOwner)).toThrow(/Line owner/);

    const duplicateOwner = passengerSystem();
    duplicateOwner.lines.push({
      id: 'other-line',
      name: 'Other Line',
      color: '#123456',
      servicePlanIds: [duplicateOwner.servicePlans[0].id],
    });
    expect(() => validateAuthoredPassengerRelationships(duplicateOwner)).toThrow(/Line owners/);
  });

  it('allows ServicePlans on one Line to share a Pattern', () => {
    const system = passengerSystem();
    const original = system.servicePlans[0];
    system.servicePlans.push({
      ...original,
      id: 'weekend-plan',
      scheduleIds: [],
    });
    system.lines[0].servicePlanIds.push('weekend-plan');

    expect(() => validateAuthoredPassengerRelationships(system)).not.toThrow();
  });

  it('rejects a Pattern shared across distinct passenger Lines', () => {
    const system = passengerSystem();
    const original = system.servicePlans[0];
    system.servicePlans.push({
      ...original,
      id: 'other-plan',
      scheduleIds: [],
    });
    system.lines.push({
      id: 'other-line',
      name: 'Other Line',
      color: '#123456',
      servicePlanIds: ['other-plan'],
    });

    expect(() => validateAuthoredPassengerRelationships(system)).toThrow(/distinct Lines/);
  });

  it('rejects dangling memberships and duplicate entity IDs', () => {
    const dangling = passengerSystem();
    dangling.servicePlans[0].patternIds = ['missing-pattern'];
    expect(() => validateAuthoredPassengerRelationships(dangling)).toThrow(/missing-pattern/);

    const duplicate = passengerSystem();
    duplicate.servicePlans.push({ ...duplicate.servicePlans[0] });
    expect(() => validateAuthoredPassengerRelationships(duplicate)).toThrow(/duplicate/i);
  });

  it('requires scheduled stop times to name calls on their Pattern', () => {
    const system = passengerSystem();
    const pattern = system.patterns[0];
    const calendar = system.calendars[0];
    system.trips = [
      {
        id: 'trip',
        patternId: pattern.id,
        calendarId: calendar.id,
        stopTimes: [
          {
            stopCallId: 'missing-call',
            precision: 'exact',
            pickup: 'regular',
            dropOff: 'regular',
          },
        ],
      },
    ];
    system.schedules[0].tripIds = ['trip'];

    expect(() => validateAuthoredPassengerRelationships(system)).toThrow(/missing-call/);
  });
});
