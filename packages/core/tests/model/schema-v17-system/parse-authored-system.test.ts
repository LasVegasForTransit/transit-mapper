import { describe, expect, it } from 'vitest';
import type { TransitSystem } from '../../../src/transit/authored-system';
import { parseAuthoredSystem } from '../../../src/model/schema-v17-system/parse-authored-system';
import { migrateSchemaV16System } from '../../../src/model/schema-v17-system/migrate-v16';
import { aPattern, aRoad, aService, aStop, aSystem } from '../../support/fixtures.test';

const DIGEST = 'a'.repeat(64);

function authoredSystem(): TransitSystem {
  const way = aRoad('route-way', [
    [-115.2, 36.14],
    [-115.16, 36.14],
  ]);
  const service = aService('route-plan', [aPattern('route-pattern', [way], [way.id])]);
  const result = migrateSchemaV16System(
    aSystem({
      ways: [way],
      stops: [aStop('route-stop', [-115.18, 36.14], { wayId: way.id, t: 0.5 })],
      services: [service],
    }),
  );
  if (result.kind !== 'migrated') throw new Error('Authored fixture did not migrate.');

  const system = result.system;
  const pattern = system.patterns[0];
  const plan = system.servicePlans[0];
  pattern.stopCalls = [{ id: 'route-call', stopId: 'route-stop' }];
  system.calendars = [
    {
      id: 'weekday-calendar',
      timeZone: { kind: 'iana', value: 'America/Los_Angeles' },
      dateRange: { kind: 'bounded', startDate: '2026-08-01', endDate: '2026-08-31' },
      activeWeekdays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      exceptions: [{ serviceDate: '2026-08-15', action: 'remove' }],
    },
  ];
  system.trips = [
    {
      id: 'late-trip',
      patternId: pattern.id,
      calendarId: 'weekday-calendar',
      stopTimes: [
        {
          stopCallId: 'route-call',
          arrivalSeconds: 90_000,
          precision: 'exact',
          pickup: 'regular',
          dropOff: 'regular',
        },
      ],
    },
  ];
  system.frequencyRules = [
    {
      id: 'late-frequency',
      label: 'Late service',
      patternId: pattern.id,
      calendarId: 'weekday-calendar',
      startTimeSeconds: 86_400,
      endTimeSeconds: 93_600,
      headwaySeconds: 1_800,
      precision: 'headway',
      templateStopTimes: [
        {
          stopCallId: 'route-call',
          departureSeconds: 90_000,
          precision: 'estimated',
          pickup: 'request',
          dropOff: 'regular',
        },
      ],
    },
  ];
  system.schedules = [
    {
      id: 'route-schedule',
      tripIds: ['late-trip'],
      frequencyRuleIds: ['late-frequency'],
    },
  ];
  plan.scheduleIds = ['route-schedule'];
  system.sourceCitations = [
    {
      sourceId: 'rtc',
      name: 'RTC Southern Nevada',
      publisher: { id: 'rtc', name: 'RTC', url: 'https://www.rtcsnv.com/' },
      attribution: { text: 'RTC Southern Nevada', url: 'https://www.rtcsnv.com/' },
      license: { id: 'provider-terms', name: 'Provider terms', url: 'https://www.rtcsnv.com/' },
    },
  ];
  system.sourceBindings = [
    {
      external: { sourceId: 'rtc', kind: 'route', id: 'route-plan' },
      target: { kind: 'service-plan', id: plan.id },
      lastAppliedRevisionId: 'rtc-2026-08-31',
      baseline: {
        sourceHash: DIGEST,
        targetHash: DIGEST,
        schemaVersion: '17',
        normalizerVersion: 'reviewed-import-v1',
      },
    },
  ];
  system.legacySourceReferences = [{ target: { kind: 'way', id: way.id }, value: '' }];
  system.importHistory = [
    {
      id: 'upload-1',
      importedAt: '2026-08-31T12:00:00.000Z',
      origin: {
        kind: 'one-time-upload',
        artifactDigest: { algorithm: 'sha-256', value: DIGEST },
        mediaType: 'application/zip',
        label: 'August service',
        attribution: { text: 'RTC Southern Nevada' },
      },
    },
  ];
  return system;
}

describe('schema-v17 authored parser', () => {
  it('reconstructs a complete authored document without changing stored order or values', () => {
    const system = authoredSystem();

    expect(parseAuthoredSystem(structuredClone(system))).toEqual(system);
    expect(parseAuthoredSystem(structuredClone(system)).legacySourceReferences[0].value).toBe('');
  });

  it('accepts an explicit unknown Pattern path', () => {
    const system = authoredSystem();
    system.patterns[0].path = { kind: 'unknown' };

    expect(parseAuthoredSystem(system).patterns[0].path).toEqual({ kind: 'unknown' });
  });

  it('accepts service-day times after midnight and independent arrival or departure values', () => {
    const parsed = parseAuthoredSystem(authoredSystem());

    expect(parsed.trips[0].stopTimes[0]).toMatchObject({ arrivalSeconds: 90_000 });
    expect(parsed.frequencyRules[0].templateStopTimes[0]).toMatchObject({
      departureSeconds: 90_000,
    });
  });

  it('rejects unknown fields instead of silently hashing a different document', () => {
    const system = { ...authoredSystem(), runtimeCacheKey: 'host-only' };

    expect(() => parseAuthoredSystem(system)).toThrow();
  });

  it('rejects blank identity and nonfinite geographic values', () => {
    const blank = authoredSystem();
    blank.lines[0].id = '   ';
    expect(() => parseAuthoredSystem(blank)).toThrow();

    const nonfinite = authoredSystem();
    nonfinite.alignments[0].points[0][0] = Number.POSITIVE_INFINITY;
    expect(() => parseAuthoredSystem(nonfinite)).toThrow();
  });

  it('rejects equal-ended extents and empty known Pattern paths', () => {
    const equalExtent = authoredSystem();
    const path = equalExtent.patterns[0].path;
    if (path.kind !== 'known') throw new Error('Authored fixture path is unknown.');
    path.legs[0].extent = { start: 0.5, end: 0.5 };
    expect(() => parseAuthoredSystem(equalExtent)).toThrow();

    const emptyPath = authoredSystem();
    emptyPath.patterns[0].path = { kind: 'known', legs: [] };
    expect(() => parseAuthoredSystem(emptyPath)).toThrow();
  });

  it('rejects invalid Calendar timezone and service dates', () => {
    const invalidZone = authoredSystem();
    invalidZone.calendars[0].timeZone = { kind: 'iana', value: 'Las Vegas' };
    expect(() => parseAuthoredSystem(invalidZone)).toThrow();

    const invalidDate = authoredSystem();
    invalidDate.calendars[0].exceptions[0].serviceDate = '2026-02-30';
    expect(() => parseAuthoredSystem(invalidDate)).toThrow();
  });

  it('rejects structurally valid documents with dangling authored ownership', () => {
    const system = authoredSystem();
    system.lines[0].servicePlanIds = ['missing-plan'];

    expect(() => parseAuthoredSystem(system)).toThrow();
  });
});
