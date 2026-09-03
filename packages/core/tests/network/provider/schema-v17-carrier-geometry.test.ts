import { describe, expect, it } from 'vitest';
import type { Alignment, TransitSystem } from '../../../src/transit/authored-system';
import { migrateSchemaV16System } from '../../../src/model/schema-v17-system/migrate-v16';
import {
  alignmentGeometrySource,
  alignmentIndex,
  alignmentPath,
  wayGeometrySource,
} from '../../../src/network/schema-v17-system/carrier-geometry';
import { aRoad, aSystem } from '../../support/fixtures.test';

function v17System(): TransitSystem {
  const way = aRoad('geo-way', [
    [-115.2, 36.14],
    [-115.18, 36.15],
    [-115.16, 36.14],
  ]);
  const result = migrateSchemaV16System(aSystem({ ways: [way] }));
  if (result.kind !== 'migrated') throw new Error('Geometry fixture did not migrate.');
  return result.system;
}

function curved(points: readonly [number, number][]): Alignment {
  return {
    id: 'curved-alignment',
    points: [...points],
    geometry: 'curved',
    curveControls: [{ pointIndex: 1, radiusMeters: 40 }],
  };
}

describe('schema-v17 carrier geometry', () => {
  it('builds a way source that names the Alignment rather than the Way', () => {
    const system = v17System();
    const source = wayGeometrySource(system.ways[0], alignmentIndex(system));

    expect(source).toBeDefined();
    expect(source?.carrier).toEqual({ kind: 'way', id: system.ways[0].id });
    expect(source?.alignmentId).toBe(system.ways[0].alignmentId);
    expect(source?.alignmentExtent).toEqual([0, 1]);
    expect(source?.points.length).toBeGreaterThanOrEqual(2);
  });

  it('carries a lane through to the carrier reference', () => {
    const system = v17System();
    const source = wayGeometrySource(system.ways[0], alignmentIndex(system), 'lane-1');

    expect(source?.carrier).toEqual({ kind: 'way', id: system.ways[0].id, laneId: 'lane-1' });
  });

  it('returns nothing for a Way whose Alignment is absent', () => {
    const system = v17System();
    const orphan = { ...system.ways[0], alignmentId: 'absent-alignment' };

    expect(wayGeometrySource(orphan, alignmentIndex(system))).toBeUndefined();
  });

  // The v16 radius is `radiusM` and the v17 one is `radiusMeters`. An unmapped
  // control leaves the radius undefined, and a curve then resolves to its
  // straight chord — visible on a map, silent in every type and test that does
  // not compare the point count.
  it('honours the authored curve radius rather than ignoring it', () => {
    const points: readonly [number, number][] = [
      [-115.2, 36.14],
      [-115.18, 36.15],
      [-115.16, 36.14],
    ];
    const withControl = alignmentPath(curved(points));
    const withoutControl = alignmentPath({
      id: 'uncontrolled-alignment',
      points: [...points],
      geometry: 'curved',
    });

    // Both tessellate, so a point count cannot tell them apart. The authored
    // 40 m radius has to change the path itself.
    expect(withControl).not.toEqual(withoutControl);
  });

  it('leaves a straight alignment at its authored control points', () => {
    const straight: Alignment = {
      id: 'straight-alignment',
      points: [
        [-115.2, 36.14],
        [-115.16, 36.14],
      ],
      geometry: 'straight',
    };

    expect(alignmentPath(straight)).toHaveLength(2);
    expect(alignmentGeometrySource(straight).carrier).toEqual({
      kind: 'alignment',
      id: 'straight-alignment',
    });
  });
});
