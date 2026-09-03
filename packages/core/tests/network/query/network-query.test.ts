import { describe, expect, it } from 'vitest';
import type {
  DetailBand,
  ModeSelection,
  NetworkQuery,
  ViewFilterValue,
  ViewQuery,
} from '../../../src/network/query';

describe('transit content queries', () => {
  it('keeps live and fixed service time separate from presentation', () => {
    const queries = [
      { serviceTime: { kind: 'live' }, modes: { kind: 'all' }, filters: {} },
      {
        serviceTime: { kind: 'instant', value: '2026-08-28T12:00:00-07:00' },
        modes: { kind: 'only', ids: ['bus', 'rail'] },
        filters: { accessible: true, frequency: 'frequent', operators: ['rtc'] },
      },
    ] as const satisfies readonly ViewQuery[];

    expect(queries.map((query) => query.serviceTime.kind)).toEqual(['live', 'instant']);
  });

  it('treats an empty explicit mode selection as disabling every mode', () => {
    const selections = [
      { kind: 'all' },
      { kind: 'only', ids: [] },
      { kind: 'only', ids: ['bus'] },
    ] as const satisfies readonly ModeSelection[];

    expect(selections[1]).toEqual({ kind: 'only', ids: [] });
  });

  it('supports each filter value and detail band in a bounded network request', () => {
    const filterValues = [
      true,
      'frequent',
      ['rtc', 'mbta'],
    ] as const satisfies readonly ViewFilterValue[];
    const detailBands = ['overview', 'district', 'street'] as const satisfies readonly DetailBand[];
    const query = {
      serviceTime: { kind: 'instant', value: '2026-08-28T19:00:00Z' },
      modes: { kind: 'all' },
      filters: {
        accessible: filterValues[0],
        frequency: filterValues[1],
        operators: filterValues[2],
      },
      bounds: { kind: 'ordinary', west: -115.4, south: 35.9, east: -114.9, north: 36.4 },
      detailBand: detailBands[1],
      cursor: 'next-page',
    } as const satisfies NetworkQuery;

    expect(query.filters).toEqual({
      accessible: true,
      frequency: 'frequent',
      operators: ['rtc', 'mbta'],
    });
    expect(detailBands).toHaveLength(3);
  });
});
