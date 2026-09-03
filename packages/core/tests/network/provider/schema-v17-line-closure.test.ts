import { describe, expect, it } from 'vitest';
import type { GeographicBounds } from '../../../src/geography/bounds';
import type { TransitSystem } from '../../../src/transit/authored-system';
import { migrateSchemaV16System } from '../../../src/model/schema-v17-system/migrate-v16';
import { sameLineCarrierClosure } from '../../../src/network/schema-v17-system/line-closure';
import { aPattern, aRoad, aService, aStop, aSystem } from '../../support/fixtures.test';

const WIDE: GeographicBounds = {
  kind: 'ordinary',
  west: -116,
  south: 35.5,
  east: -114,
  north: 36.9,
};
const ELSEWHERE: GeographicBounds = { kind: 'ordinary', west: 10, south: 50, east: 11, north: 51 };
/** Covers the western way only, so the eastern one is out of view. */
const WEST_ONLY: GeographicBounds = {
  kind: 'ordinary',
  west: -115.25,
  south: 36.1,
  east: -115.18,
  north: 36.2,
};

function twoWaySystem(): TransitSystem {
  const west = aRoad('west-way', [
    [-115.24, 36.14],
    [-115.2, 36.14],
  ]);
  const east = aRoad('east-way', [
    [-115.1, 36.14],
    [-115.06, 36.14],
  ]);
  const result = migrateSchemaV16System(
    aSystem({
      ways: [west, east],
      stops: [aStop('closure-stop', [-115.22, 36.14], { wayId: west.id, t: 0.5 })],
      services: [
        aService('closure-plan', [aPattern('closure-pattern', [west, east], [west.id, east.id])]),
      ],
    }),
  );
  if (result.kind !== 'migrated') throw new Error('Closure fixture did not migrate.');
  return result.system;
}

describe('schema-v17 same-Line carrier closure', () => {
  it('reports the visible legs when the whole Line is in view', () => {
    const closure = sameLineCarrierClosure(twoWaySystem(), WIDE);

    expect(closure.visibleLogicalFragmentIds.size).toBeGreaterThan(0);
    expect(closure.patternIds.size).toBeGreaterThan(0);
  });

  it('reports nothing for a viewport the Line never enters', () => {
    const closure = sameLineCarrierClosure(twoWaySystem(), ELSEWHERE);

    expect(closure.visibleLogicalFragmentIds.size).toBe(0);
    expect(closure.closureLogicalFragmentIds.size).toBe(0);
    expect(closure.patternIds.size).toBe(0);
  });

  it('does not drag in a Line leg on a carrier the viewport never saw', () => {
    const closure = sameLineCarrierClosure(twoWaySystem(), WEST_ONLY);

    // The eastern way is a different carrier and was never seeded, so closing
    // over it would pull in unbounded geometry rather than complete a seed.
    expect(closure.visibleLogicalFragmentIds.size).toBeGreaterThan(0);
    for (const id of closure.closureLogicalFragmentIds) {
      expect(closure.visibleLogicalFragmentIds.has(id)).toBe(false);
    }
  });

  it('keeps visible and closure sets disjoint', () => {
    const closure = sameLineCarrierClosure(twoWaySystem(), WEST_ONLY);

    for (const id of closure.closureLogicalFragmentIds) {
      expect(closure.visibleLogicalFragmentIds.has(id)).toBe(false);
    }
  });

  it('completes a seeded carrier with the same Line leg the viewport missed', () => {
    const base = twoWaySystem();
    const way = base.ways.find((candidate) => candidate.id.includes('west'));
    if (!way) throw new Error('The fixture lost its western Way.');
    const plan = base.servicePlans[0];
    // Two Patterns of one Line on one carrier, each covering a different half.
    // A viewport over the first half must still receive the second, or the
    // Line's offset on this carrier would depend on the camera.
    const near = {
      id: 'near-pattern',
      path: {
        kind: 'known' as const,
        legs: [
          {
            kind: 'way' as const,
            wayId: way.id,
            lane: { kind: 'auto' as const },
            direction: 'forward' as const,
            extent: { start: 0, end: 0.3 },
          },
        ],
      },
      stopCalls: [],
    };
    const far = {
      id: 'far-pattern',
      path: {
        kind: 'known' as const,
        legs: [
          {
            kind: 'way' as const,
            wayId: way.id,
            lane: { kind: 'auto' as const },
            direction: 'forward' as const,
            extent: { start: 0.7, end: 1 },
          },
        ],
      },
      stopCalls: [],
    };
    const system: TransitSystem = {
      ...base,
      patterns: [near, far],
      servicePlans: [{ ...plan, patternIds: [near.id, far.id] }],
      lines: base.lines.map((line) => ({ ...line, servicePlanIds: [plan.id] })),
      trips: [],
    };
    // Covers only the first tenth of the way, so `far` is out of view.
    const closure = sameLineCarrierClosure(system, {
      kind: 'ordinary',
      west: -115.245,
      south: 36.13,
      east: -115.238,
      north: 36.15,
    });

    expect(closure.visibleLogicalFragmentIds.size).toBeGreaterThan(0);
    expect(closure.closureLogicalFragmentIds.size).toBeGreaterThan(0);
    expect(closure.patternIds.has(far.id)).toBe(true);
  });

  it('reports every pattern the emitted legs belong to', () => {
    const system = twoWaySystem();
    const closure = sameLineCarrierClosure(system, WIDE);
    const known = new Set(system.patterns.map(({ id }) => id));

    for (const patternId of closure.patternIds) {
      expect(known.has(patternId)).toBe(true);
    }
  });
});
