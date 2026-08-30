import { describe, expect, it } from 'vitest';
import { aPattern, aRoad, aService, aSystem } from '../../support/fixtures.test';
import { legacyDerivedId } from '../../../src/model/schema-v16-system/legacy-id';
import { migrateSchemaV16System } from '../../../src/model/schema-v17-system/migrate-v16';

describe('schema-v16 authored compatibility migration', () => {
  it('keeps temporary rail and bus plans under their original passenger Line', () => {
    const way = aRoad('red-line-track', [
      [-115.2, 36.14],
      [-115.16, 36.14],
    ]);
    const rail = aService('red-line-rail', [aPattern('red-line-rail-path', [way], [way.id])], {
      modeId: 'subway',
    });
    const shuttle = aService(
      'red-line-shuttle',
      [aPattern('red-line-shuttle-path', [way], [way.id])],
      { modeId: 'bus' },
    );
    const v16 = aSystem({
      ways: [way],
      lines: [
        {
          id: 'red-line',
          name: 'Red Line',
          color: '#d32f2f',
          serviceIds: [rail.id, shuttle.id],
        },
      ],
      services: [rail, shuttle],
    });

    const result = migrateSchemaV16System(v16);

    expect(result.kind).toBe('migrated');
    if (result.kind !== 'migrated') return;
    expect(result.system.lines).toEqual([
      {
        id: 'red-line',
        name: 'Red Line',
        color: '#d32f2f',
        servicePlanIds: ['red-line-rail', 'red-line-shuttle'],
      },
    ]);
    expect(result.system.servicePlans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'red-line-rail', modeId: 'subway' }),
        expect.objectContaining({ id: 'red-line-shuttle', modeId: 'bus' }),
      ]),
    );
    expect(result.system.servicePlans.every((plan) => !('lineId' in plan))).toBe(true);
    expect(result.system.legacyServiceAliases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          legacyServiceId: 'red-line-rail',
          lineId: 'red-line',
          servicePlanId: 'red-line-rail',
        }),
        expect.objectContaining({
          legacyServiceId: 'red-line-shuttle',
          lineId: 'red-line',
          servicePlanId: 'red-line-shuttle',
        }),
      ]),
    );
  });

  it('keeps authored geometry separate from physical Ways and preserves legacy source markers', () => {
    const way = aRoad(
      'shared-guideway',
      [
        [-115.2, 36.14],
        [-115.16, 36.14],
      ],
      {
        source: '',
        curveControls: [{ pointIndex: 1, radiusM: 45 }],
        profile: {
          lanes: [{ id: 'westbound-track', kindId: 'rail', widthM: 3.5, direction: 'backward' }],
        },
      },
    );
    const service = aService('shared-guideway-service', [
      aPattern('shared-guideway-pattern', [way], [way.id], {
        sections: [
          {
            kind: 'shared',
            legs: [
              {
                wayId: way.id,
                direction: 'withPoints',
                extent: { kind: 'stretch', fromT: 0.2, toT: 0.8 },
                lane: { kind: 'pinned', laneId: 'westbound-track' },
              },
            ],
          },
        ],
      }),
    ]);
    const v16 = aSystem({ ways: [way], services: [service] });
    v16.stops = [
      {
        id: 'guideway-stop',
        coord: [-115.18, 36.14],
        anchors: [{ wayId: way.id, t: 0.5 }],
      },
    ];

    const result = migrateSchemaV16System(v16);

    expect(result.kind).toBe('migrated');
    if (result.kind !== 'migrated') return;
    expect(result.system.alignments).toEqual([
      {
        id: way.id,
        points: way.points,
        geometry: 'straight',
        curveControls: [{ pointIndex: 1, radiusMeters: 45 }],
      },
    ]);
    expect(result.system.ways).toEqual([
      {
        id: way.id,
        alignmentId: way.id,
        typeId: 'road',
        grade: 'atGrade',
        profile: {
          lanes: [
            { id: 'westbound-track', kindId: 'rail', widthMeters: 3.5, direction: 'reverse' },
          ],
        },
      },
    ]);
    expect(result.system.stops[0]?.anchors).toEqual([{ alignmentId: way.id, t: 0.5 }]);
    expect(result.system.legacySourceReferences).toEqual([
      { target: { kind: 'way', id: way.id }, value: '' },
    ]);
    expect(result.system.patterns.map((pattern) => pattern.path)).toEqual([
      {
        kind: 'known',
        legs: [
          {
            kind: 'way',
            wayId: way.id,
            lane: { kind: 'pinned', laneId: 'westbound-track' },
            direction: 'forward',
            extent: { start: 0.2, end: 0.8 },
          },
        ],
      },
      {
        kind: 'known',
        legs: [
          {
            kind: 'way',
            wayId: way.id,
            lane: { kind: 'pinned', laneId: 'westbound-track' },
            direction: 'reverse',
            extent: { start: 0.2, end: 0.8 },
          },
        ],
      },
    ]);
    expect(result.system.patterns.map((pattern) => pattern.stopCalls)).toEqual([
      [
        {
          id: legacyDerivedId('stop-call', service.id, 'outbound', 0, 'guideway-stop'),
          stopId: 'guideway-stop',
        },
      ],
      [
        {
          id: legacyDerivedId('stop-call', service.id, 'inbound', 0, 'guideway-stop'),
          stopId: 'guideway-stop',
        },
      ],
    ]);
  });

  it('gives legacy Group members typed references', () => {
    const way = aRoad('transfer-guideway', [
      [-115.2, 36.14],
      [-115.16, 36.14],
    ]);
    const service = aService('transfer-service', [aPattern('transfer-pattern', [way], [way.id])]);
    const v16 = aSystem({
      ways: [way],
      services: [service],
      lines: [
        {
          id: 'transfer-line',
          name: 'Transfer Line',
          color: '#c62828',
          serviceIds: [service.id],
        },
      ],
      groups: [
        {
          id: 'transfer-complex',
          name: 'Transfer complex',
          memberIds: [way.id, service.id],
        },
      ],
    });

    const result = migrateSchemaV16System(v16);

    expect(result.kind).toBe('migrated');
    if (result.kind !== 'migrated') return;
    expect(result.system.groups).toEqual([
      {
        id: 'transfer-complex',
        name: 'Transfer complex',
        members: [
          { kind: 'way', id: way.id },
          { kind: 'service-plan', id: service.id },
        ],
      },
    ]);
  });

  it('keeps the v16 reader active when Group membership has no typed meaning', () => {
    const service = aService('shared-legacy-id', []);
    const v16 = aSystem({
      services: [service],
      groups: [
        {
          id: 'ambiguous-group',
          memberIds: [service.id],
        },
      ],
    });

    const result = migrateSchemaV16System(v16);

    expect(result).toEqual({
      kind: 'incompatible',
      system: v16,
      issues: [
        {
          code: 'ambiguous-legacy-group-member',
          groupId: 'ambiguous-group',
          memberId: service.id,
          entityKinds: ['line', 'service-plan'],
        },
      ],
    });
  });

  it('keeps the v16 reader active when a Group member no longer exists', () => {
    const v16 = aSystem({
      groups: [
        {
          id: 'stale-group',
          memberIds: ['removed-record'],
        },
      ],
    });

    const result = migrateSchemaV16System(v16);

    expect(result).toEqual({
      kind: 'incompatible',
      system: v16,
      issues: [
        {
          code: 'missing-legacy-group-member',
          groupId: 'stale-group',
          memberId: 'removed-record',
        },
      ],
    });
  });

  it('converts schedule periods into exact calendar and frequency facts', () => {
    const way = aRoad('timed-way', [
      [-115.2, 36.14],
      [-115.16, 36.14],
    ]);
    const service = aService('timed-service', [aPattern('timed-path', [way], [way.id])], {
      frequencyMinutes: 12,
      spanStart: '23:00',
      spanEnd: '01:00',
      schedule: [
        {
          id: 'weekday-peak',
          label: 'Weekday peak',
          days: 'weekday',
          spanStart: '06:00',
          spanEnd: '09:00',
          frequencyMinutes: 10,
        },
      ],
    });
    const v16 = aSystem({ ways: [way], services: [service] });

    const result = migrateSchemaV16System(v16);

    expect(result.kind).toBe('migrated');
    if (result.kind !== 'migrated') return;
    expect(result.system.servicePlans[0]).toMatchObject({
      id: service.id,
      scheduleIds: ['v16:schedule:13:timed-service'],
      planningSummary: {
        peakHeadwaySeconds: 720,
        spanStartSeconds: 82_800,
        spanEndSeconds: 90_000,
      },
    });
    expect(result.system.schedules).toEqual([
      {
        id: 'v16:schedule:13:timed-service',
        tripIds: [],
        frequencyRuleIds: [
          'v16:frequency-rule:13:timed-service:1:0:12:weekday-peak:8:outbound',
          'v16:frequency-rule:13:timed-service:1:0:12:weekday-peak:7:inbound',
        ],
      },
    ]);
    expect(result.system.calendars).toEqual([
      {
        id: 'v16:calendar:13:timed-service:1:0:12:weekday-peak:8:outbound',
        timeZone: { kind: 'unknown' },
        dateRange: { kind: 'unbounded' },
        activeWeekdays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
        exceptions: [],
      },
      {
        id: 'v16:calendar:13:timed-service:1:0:12:weekday-peak:7:inbound',
        timeZone: { kind: 'unknown' },
        dateRange: { kind: 'unbounded' },
        activeWeekdays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
        exceptions: [],
      },
    ]);
    expect(result.system.frequencyRules).toEqual([
      {
        id: 'v16:frequency-rule:13:timed-service:1:0:12:weekday-peak:8:outbound',
        label: 'Weekday peak',
        patternId: 'v16:pattern:13:timed-service:8:outbound',
        calendarId: 'v16:calendar:13:timed-service:1:0:12:weekday-peak:8:outbound',
        startTimeSeconds: 21_600,
        endTimeSeconds: 32_400,
        headwaySeconds: 600,
        precision: 'headway',
        templateStopTimes: [],
      },
      {
        id: 'v16:frequency-rule:13:timed-service:1:0:12:weekday-peak:7:inbound',
        label: 'Weekday peak',
        patternId: 'v16:pattern:13:timed-service:7:inbound',
        calendarId: 'v16:calendar:13:timed-service:1:0:12:weekday-peak:7:inbound',
        startTimeSeconds: 21_600,
        endTimeSeconds: 32_400,
        headwaySeconds: 600,
        precision: 'headway',
        templateStopTimes: [],
      },
    ]);
  });

  it('keeps the v16 reader active when timing or path extents are invalid', () => {
    const way = aRoad('invalid-way', [
      [-115.2, 36.14],
      [-115.16, 36.14],
    ]);
    const service = aService(
      'invalid-service',
      [
        aPattern('invalid-path', [way], [way.id], {
          sections: [
            {
              kind: 'shared',
              legs: [
                {
                  wayId: way.id,
                  direction: 'withPoints',
                  extent: { kind: 'stretch', fromT: 0.5, toT: 0.5 },
                  lane: { kind: 'auto' },
                },
              ],
            },
          ],
        }),
      ],
      { frequencyMinutes: 0, spanStart: 'invalid', spanEnd: '10:00' },
    );

    const result = migrateSchemaV16System(aSystem({ ways: [way], services: [service] }));

    expect(result.kind).toBe('incompatible');
    if (result.kind !== 'incompatible') return;
    expect(result.issues).toEqual(
      expect.arrayContaining([
        { code: 'invalid-legacy-leg-extent', serviceId: service.id, wayId: way.id },
        { code: 'invalid-legacy-headway', serviceId: service.id },
        { code: 'invalid-legacy-service-time', serviceId: service.id },
      ]),
    );
  });

  it('collapses every shared stop at a boundary without removing later visits', () => {
    const first = aRoad('first', [
      [-115.2, 36.14],
      [-115.18, 36.14],
    ]);
    const second = aRoad('second', [
      [-115.18, 36.14],
      [-115.16, 36.14],
    ]);
    const service = aService('boundary-service', [
      aPattern('boundary-path', [first, second], [first.id, second.id], {
        sections: [
          {
            kind: 'shared',
            legs: [
              {
                wayId: first.id,
                direction: 'withPoints',
                extent: { kind: 'whole' },
                lane: { kind: 'auto' },
              },
              {
                wayId: second.id,
                direction: 'withPoints',
                extent: { kind: 'whole' },
                lane: { kind: 'auto' },
              },
            ],
          },
        ],
      }),
    ]);
    const v16 = aSystem({ ways: [first, second], services: [service] });
    v16.stops = [
      {
        id: 'first-boundary-stop',
        coord: [-115.18, 36.14],
        anchors: [
          { wayId: first.id, t: 1 },
          { wayId: second.id, t: 0 },
        ],
      },
      {
        id: 'second-boundary-stop',
        coord: [-115.18, 36.14],
        anchors: [
          { wayId: first.id, t: 1 },
          { wayId: second.id, t: 0 },
        ],
      },
    ];

    const result = migrateSchemaV16System(v16);

    expect(result.kind).toBe('migrated');
    if (result.kind !== 'migrated') return;
    expect(
      result.system.patterns.map((pattern) => pattern.stopCalls.map((call) => call.stopId)),
    ).toEqual([
      ['first-boundary-stop', 'second-boundary-stop'],
      ['first-boundary-stop', 'second-boundary-stop'],
    ]);
  });

  it('keeps an empty legacy path explicit without inventing a return Pattern', () => {
    const service = aService('unmapped-service', []);

    const result = migrateSchemaV16System(aSystem({ services: [service] }));

    expect(result.kind).toBe('migrated');
    if (result.kind !== 'migrated') return;
    expect(result.system.servicePlans[0]?.patternIds).toEqual([
      legacyDerivedId('pattern', service.id, 'outbound'),
    ]);
    expect(result.system.patterns).toEqual([
      {
        id: legacyDerivedId('pattern', service.id, 'outbound'),
        direction: { key: 'outbound' },
        path: { kind: 'unknown' },
        stopCalls: [],
      },
    ]);
    expect(result.system.legacyServiceAliases[0]?.patternIds).toEqual({
      outbound: legacyDerivedId('pattern', service.id, 'outbound'),
    });
  });
});
