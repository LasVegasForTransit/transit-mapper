import { describe, expect, it } from 'vitest';
import { oneSection, stretchLeg, wholeLeg } from '../../src/model/geo';
import { trimPatternSectionsTo } from '../../src/model/pattern-section-trimming';
import { aRoad } from '../support/fixtures.test';

const SOUTH_WEST: [number, number] = [-115.2, 36.1];
const NORTH_WEST: [number, number] = [-115.2, 36.2];
const SOUTH_EAST: [number, number] = [-115.19, 36.1];
const NORTH_EAST: [number, number] = [-115.19, 36.2];

describe('pattern section trimming', () => {
  it('preserves sections when a cut is already at the terminus', () => {
    const road = aRoad('road', [SOUTH_WEST, NORTH_WEST]);
    const sections = oneSection([wholeLeg(road.id)]);

    expect(trimPatternSectionsTo([road], sections, { wayId: road.id, t: 1, side: 'end' })).toBe(
      sections,
    );
  });

  it('cuts a shared path at the matching occurrence nearest the edited end', () => {
    const road = aRoad('road', [SOUTH_WEST, NORTH_WEST]);
    const sections = oneSection([wholeLeg(road.id), wholeLeg(road.id, 'againstPoints')]);

    const trimmed = trimPatternSectionsTo([road], sections, {
      wayId: road.id,
      t: 0.75,
      side: 'end',
    });

    expect(trimmed).toEqual(
      oneSection([wholeLeg(road.id), stretchLeg(wholeLeg(road.id, 'againstPoints'), 0.75, 1)]),
    );
  });

  it('projects a couplet cut onto its return path', () => {
    const outbound = aRoad('outbound', [SOUTH_WEST, NORTH_WEST]);
    const inbound = aRoad('inbound', [NORTH_EAST, SOUTH_EAST]);
    const sections = [
      {
        kind: 'split' as const,
        outbound: [wholeLeg(outbound.id)],
        inbound: [wholeLeg(inbound.id)],
      },
    ];

    const trimmed = trimPatternSectionsTo([outbound, inbound], sections, {
      wayId: outbound.id,
      t: 0.5,
      side: 'end',
    });

    expect(trimmed?.[0]).toMatchObject({
      kind: 'split',
      outbound: [stretchLeg(wholeLeg(outbound.id), 0, 0.5)],
    });
    const split = trimmed?.[0];
    expect(split?.kind).toBe('split');
    if (split?.kind !== 'split') throw new Error('Expected the couplet to remain split');
    expect(split.inbound[0]).toMatchObject({
      wayId: inbound.id,
      direction: 'withPoints',
      lane: { kind: 'auto' },
    });
    expect(split.inbound[0].extent.kind).toBe('stretch');
    if (split.inbound[0].extent.kind !== 'stretch') {
      throw new Error('Expected the return path to be trimmed');
    }
    expect(split.inbound[0].extent.fromT).toBeCloseTo(0.5);
    expect(split.inbound[0].extent.toT).toBe(1);
  });

  it('returns null when no section holds the requested way', () => {
    const road = aRoad('road', [SOUTH_WEST, NORTH_WEST]);
    const sections = oneSection([wholeLeg(road.id)]);

    expect(
      trimPatternSectionsTo([road], sections, { wayId: 'missing', t: 0.5, side: 'end' }),
    ).toBeNull();
  });
});
