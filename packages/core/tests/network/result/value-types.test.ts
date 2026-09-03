import { describe, expect, expectTypeOf, it } from 'vitest';
import { sameTransitCarrier } from '../../../src/transit/value-types';
import type {
  Applicability,
  CrossSection,
  CurveControl,
  Grade,
  KnownOrUnknown,
  LaneDirection,
  LegDirection,
  LegExtent,
  LegLane,
  LineGeometry,
  LocalizedAdvisoryText,
  OperationalScope,
  PatternDirection,
  TransitCarrierRef,
} from '../../../src/transit/value-types';

describe('target transit values', () => {
  it('uses target lane and geometry vocabulary instead of schema-v16 spellings', () => {
    expectTypeOf<Grade>().toEqualTypeOf<'underground' | 'atGrade' | 'elevated'>();
    expectTypeOf<LegDirection>().toEqualTypeOf<'forward' | 'reverse'>();
    expectTypeOf<LaneDirection>().toEqualTypeOf<'forward' | 'reverse' | 'both' | 'none'>();
    expectTypeOf<LineGeometry>().toEqualTypeOf<'straight' | 'curved' | 'freeform'>();
    expectTypeOf<CurveControl>().toHaveProperty('radiusMeters').toEqualTypeOf<number>();
    expectTypeOf<CurveControl>().not.toHaveProperty('radiusM');
    expectTypeOf<CrossSection['lanes'][number]>()
      .toHaveProperty('widthMeters')
      .toEqualTypeOf<number>();
    expectTypeOf<CrossSection['lanes'][number]>().not.toHaveProperty('widthM');
  });

  it('keeps unknown, applicability, lane, and carrier states explicit', () => {
    const values = {
      known: { kind: 'known', value: 'bus' } satisfies KnownOrUnknown<string>,
      unknown: { kind: 'unknown' } satisfies KnownOrUnknown<string>,
      all: { kind: 'all' } satisfies Applicability<string>,
      only: { kind: 'only', values: ['bus'] } satisfies Applicability<string>,
      unknownApplicability: { kind: 'unknown' } satisfies Applicability<string>,
      automaticLane: { kind: 'auto' } satisfies LegLane,
      pinnedLane: { kind: 'pinned', laneId: 'eastbound' } satisfies LegLane,
      extent: { start: 0.25, end: 0.75 } satisfies LegExtent,
      alignment: { kind: 'alignment', id: 'alignment-1' } satisfies TransitCarrierRef,
      way: { kind: 'way', id: 'way-1', laneId: 'eastbound' } satisfies TransitCarrierRef,
    };

    expect(values.known.kind).toBe('known');
    expect(values.unknown.kind).toBe('unknown');
    expect(values.all.kind).toBe('all');
    expect(values.only.kind).toBe('only');
    expect(values.unknownApplicability.kind).toBe('unknown');
    expect(values.automaticLane.kind).toBe('auto');
    expect(values.pinnedLane.kind).toBe('pinned');
    expect(values.extent).toEqual({ start: 0.25, end: 0.75 });
    expect(values.alignment.kind).toBe('alignment');
    expect(values.way.kind).toBe('way');
  });

  it('compares transit carriers by physical carrier and lane identity', () => {
    expect(
      sameTransitCarrier(
        { kind: 'alignment', id: 'alignment' },
        { kind: 'alignment', id: 'alignment' },
      ),
    ).toBe(true);
    expect(
      sameTransitCarrier(
        { kind: 'way', id: 'way', laneId: 'eastbound' },
        { kind: 'way', id: 'way', laneId: 'westbound' },
      ),
    ).toBe(false);
    expect(sameTransitCarrier({ kind: 'way', id: 'way' }, { kind: 'alignment', id: 'way' })).toBe(
      false,
    );
  });

  it('represents Pattern labels, advisory text, and every operational scope', () => {
    const direction: PatternDirection = { key: 'eastbound', label: 'Eastbound' };
    const text: LocalizedAdvisoryText = {
      language: 'en',
      header: 'Shuttle service',
      description: 'Use the replacement shuttle.',
    };
    const scopes: OperationalScope[] = [
      { kind: 'service-dates', serviceDates: ['2026-08-29'] },
      {
        kind: 'absolute',
        activePeriods: [{ start: '2026-08-29T07:00:00Z', end: '2026-08-29T09:00:00Z' }],
      },
      {
        kind: 'service-dates-and-absolute',
        serviceDates: ['2026-08-29'],
        activePeriods: [{ start: '2026-08-29T07:00:00Z', end: '2026-08-29T09:00:00Z' }],
      },
    ];

    expect(direction).toEqual({ key: 'eastbound', label: 'Eastbound' });
    expect(text.description).toBe('Use the replacement shuttle.');
    expect(scopes.map(({ kind }) => kind)).toEqual([
      'service-dates',
      'absolute',
      'service-dates-and-absolute',
    ]);
  });
});
