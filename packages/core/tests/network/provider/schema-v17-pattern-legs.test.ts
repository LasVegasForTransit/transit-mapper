import { describe, expect, it } from 'vitest';
import type { GeographicBounds } from '../../../src/geography/bounds';
import type { Pattern, TransitSystem } from '../../../src/transit/authored-system';
import { migrateSchemaV16System } from '../../../src/model/schema-v17-system/migrate-v16';
import { projectPatternGeometry } from '../../../src/network/schema-v17-system/pattern-legs';
import { aPattern, aRoad, aService, aSystem } from '../../support/fixtures.test';

const WIDE: GeographicBounds = {
  kind: 'ordinary',
  west: -116,
  south: 35.5,
  east: -114,
  north: 36.9,
};
const ELSEWHERE: GeographicBounds = { kind: 'ordinary', west: 10, south: 50, east: 11, north: 51 };

function v17System(): TransitSystem {
  const way = aRoad('leg-way', [
    [-115.2, 36.14],
    [-115.16, 36.14],
  ]);
  const result = migrateSchemaV16System(
    aSystem({
      ways: [way],
      services: [aService('leg-plan', [aPattern('leg-pattern', [way], [way.id])])],
    }),
  );
  if (result.kind !== 'migrated') throw new Error('Leg fixture did not migrate.');
  return result.system;
}

function firstKnownPattern(system: TransitSystem): Pattern {
  const pattern = system.patterns.find((candidate) => candidate.path.kind === 'known');
  if (!pattern) throw new Error('The fixture has no Pattern with known geometry.');
  return pattern;
}

describe('schema-v17 pattern leg projection', () => {
  it('projects a leg into a carrier fragment and a leg fragment that references it', () => {
    const system = v17System();
    const projected = projectPatternGeometry(firstKnownPattern(system), { system, bounds: WIDE });

    expect(projected.patternLegs.length).toBeGreaterThan(0);
    for (const leg of projected.patternLegs) {
      expect(projected.carriers.some((carrier) => carrier.id === leg.carrierFragmentId)).toBe(true);
    }
  });

  it('keeps the logical fragment ID stable while the shard ID follows the viewport', () => {
    const system = v17System();
    const pattern = firstKnownPattern(system);
    const wide = projectPatternGeometry(pattern, { system, bounds: WIDE });
    const narrow = projectPatternGeometry(pattern, {
      system,
      bounds: { kind: 'ordinary', west: -115.19, south: 36.1, east: -115.17, north: 36.2 },
    });

    expect(wide.patternLegs[0].logicalPatternLegFragmentId).toBe(
      narrow.patternLegs[0].logicalPatternLegFragmentId,
    );
    expect(wide.patternLegs[0].id).not.toBe(narrow.patternLegs[0].id);
  });

  it('emits nothing for a viewport the pattern never enters', () => {
    const system = v17System();
    const projected = projectPatternGeometry(firstKnownPattern(system), {
      system,
      bounds: ELSEWHERE,
    });

    expect(projected.patternLegs).toHaveLength(0);
    expect(projected.carriers).toHaveLength(0);
  });

  it('emits nothing for a Pattern whose geometry is unknown', () => {
    const system = v17System();
    const unknown: Pattern = { ...firstKnownPattern(system), path: { kind: 'unknown' } };

    expect(projectPatternGeometry(unknown, { system, bounds: WIDE }).patternLegs).toHaveLength(0);
  });

  it('drops a leg whose carrier is absent rather than emitting a fragment with no geometry', () => {
    const system = v17System();
    const pattern = firstKnownPattern(system);
    if (pattern.path.kind !== 'known') throw new Error('Expected known geometry.');
    const orphaned: Pattern = {
      ...pattern,
      path: {
        kind: 'known',
        legs: pattern.path.legs.map((leg) =>
          leg.kind === 'way' ? { ...leg, wayId: 'absent-way' } : { ...leg, alignmentId: 'absent' },
        ),
      },
    };

    expect(projectPatternGeometry(orphaned, { system, bounds: WIDE }).patternLegs).toHaveLength(0);
  });

  it('projects a leg that follows an Alignment rather than a Way', () => {
    const system = v17System();
    const alignment = system.alignments[0];
    const pattern: Pattern = {
      ...firstKnownPattern(system),
      path: {
        kind: 'known',
        legs: [
          {
            kind: 'alignment',
            alignmentId: alignment.id,
            direction: 'forward',
            extent: { start: 0, end: 1 },
          },
        ],
      },
    };

    const projected = projectPatternGeometry(pattern, { system, bounds: WIDE });

    expect(projected.patternLegs.length).toBeGreaterThan(0);
    expect(projected.carriers[0].carrier).toEqual({ kind: 'alignment', id: alignment.id });
  });

  it('carries the authored leg direction onto every shard', () => {
    const system = v17System();
    const pattern = firstKnownPattern(system);
    if (pattern.path.kind !== 'known') throw new Error('Expected known geometry.');
    const projected = projectPatternGeometry(pattern, { system, bounds: WIDE });

    for (const leg of projected.patternLegs) {
      expect(leg.direction).toBe(pattern.path.legs[leg.legIndex].direction);
    }
  });
});
