import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  CalendarSummary,
  EntityDetailItem,
  EntityDetailsProvider,
  EntityDetailsQuery,
  EntityDetailsResult,
  FrequencySummary,
  StopCallSummary,
} from '../../../src/network/entity-details-provider';
import type { ResolvedContentRef } from '../../../src/network/resolved-content-reference';
import type { ResolvedNetworkChunk } from '../../../src/network/resolved-network-chunk';
import { waitForProviderAbort } from '../../support/provider-abort.test';

const content: ResolvedContentRef = {
  kind: 'transit-dataset',
  id: 'southern-nevada',
  datasetRevisionId: 'revision-7',
  operational: { kind: 'snapshot', operationalSnapshotId: 'snapshot-42' },
};

const query: EntityDetailsQuery = {
  entity: { kind: 'line', id: 'line-220' },
  serviceTime: { kind: 'instant', value: '2026-08-29T08:00:00Z' },
  window: { start: '2026-08-29T07:00:00Z', end: '2026-08-29T09:00:00Z' },
  limit: 50,
};

const source = {
  sourceIds: ['rtc-realtime'] as const,
  sourceRevisionIds: ['rtc-realtime-42'] as const,
};

const items: EntityDetailItem[] = [
  {
    kind: 'calendar',
    value: {
      id: 'calendar-weekday',
      timeZone: { kind: 'iana', value: 'America/Los_Angeles' },
      dateRange: { kind: 'bounded', startDate: '2026-08-01', endDate: '2026-12-31' },
    },
  },
  {
    kind: 'trip',
    value: {
      id: 'trip-eastbound-0800',
      patternId: 'pattern-eastbound',
      calendarId: 'calendar-weekday',
      serviceDate: '2026-08-29',
      startTimeSeconds: 28_800,
    },
  },
  {
    kind: 'frequency',
    value: {
      id: 'frequency-eastbound',
      patternId: 'pattern-eastbound',
      calendarId: 'calendar-weekday',
      startTimeSeconds: 21_600,
      endTimeSeconds: 86_400,
      headwaySeconds: 900,
      precision: 'headway',
    },
  },
  {
    kind: 'stop-call',
    value: {
      id: 'call-centennial',
      tripId: 'trip-eastbound-0800',
      patternId: 'pattern-eastbound',
      stopId: 'stop-centennial',
      sequence: 7,
      arrivalSeconds: 30_600,
      departureSeconds: 30_660,
      precision: 'estimated',
      pickup: 'request',
      dropOff: 'regular',
      service: 'served',
    },
  },
  {
    kind: 'service-plan-status',
    value: {
      lineId: 'line-220',
      servicePlanId: 'plan-weekday',
      activity: 'inactive',
      scope: { kind: 'service-dates', serviceDates: ['2026-08-29'] },
      replacements: [
        {
          id: 'replacement-link',
          replacement: { kind: 'service-plan', id: 'plan-shuttle' },
          target: { kind: 'service-plan', id: 'plan-weekday' },
        },
      ],
      source,
    },
  },
  {
    kind: 'operational-change',
    value: {
      id: 'change-shuttle',
      kind: 'shuttle',
      label: 'Replacement shuttle',
      affected: [{ kind: 'service-plan', id: 'plan-weekday' }],
      scope: { kind: 'service-dates', serviceDates: ['2026-08-29'] },
      replacements: [],
      source,
    },
  },
  {
    kind: 'advisory',
    value: {
      id: 'advisory-shuttle',
      affected: [{ kind: 'line', id: 'line-220' }],
      text: [{ description: 'Use the replacement shuttle.' }],
      source,
    },
  },
];

const result: EntityDetailsResult = {
  entity: query.entity,
  label: '220 Ann / Tropical',
  items,
  nextCursor: 'details-page-2',
};

describe('entity details provider port', () => {
  it('preserves target calendar, frequency, and boarding states', () => {
    expectTypeOf<CalendarSummary['timeZone']>().toEqualTypeOf<
      { kind: 'iana'; value: string } | { kind: 'unknown' }
    >();
    expectTypeOf<CalendarSummary['dateRange']>().toEqualTypeOf<
      | { kind: 'bounded'; startDate: string; endDate: string }
      | { kind: 'from'; startDate: string }
      | { kind: 'through'; endDate: string }
      | { kind: 'unbounded' }
    >();
    expectTypeOf<FrequencySummary['precision']>().toEqualTypeOf<'exact' | 'headway' | 'unknown'>();
    expectTypeOf<StopCallSummary['precision']>().toEqualTypeOf<'exact' | 'estimated' | 'unknown'>();
    expectTypeOf<StopCallSummary['pickup']>().toEqualTypeOf<
      'regular' | 'none' | 'request' | 'coordinate' | 'unknown'
    >();
    expectTypeOf<ResolvedNetworkChunk['entities']>().not.toHaveProperty('schedules');
    expectTypeOf<ResolvedNetworkChunk>().not.toHaveProperty('servicePlanStatuses');
  });

  it('pages one ordered item stream without flattening schedule semantics', () => {
    expect(result.items.map(({ kind }) => kind)).toEqual([
      'calendar',
      'trip',
      'frequency',
      'stop-call',
      'service-plan-status',
      'operational-change',
      'advisory',
    ]);
    const stopCall = result.items.find(({ kind }) => kind === 'stop-call');
    expect(stopCall?.value).toMatchObject({
      precision: 'estimated',
      pickup: 'request',
      dropOff: 'regular',
    });
  });

  it('passes cancellation into details work', async () => {
    const provider: EntityDetailsProvider = {
      details: (_content, _query, options) =>
        waitForProviderAbort('Details request aborted.', options),
    };
    const controller = new AbortController();
    const details = provider.details(content, query, { signal: controller.signal });

    controller.abort();

    await expect(details).rejects.toThrow('Details request aborted.');
  });
});
