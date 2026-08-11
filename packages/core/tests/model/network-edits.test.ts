import { describe, expect, it, vi } from 'vitest';
import {
  combineCarriageways,
  separateCarriageways,
  withMedianWidth,
} from '../../src/model/carriageway-edits';
import { mergeWaysIntoCorridor } from '../../src/model/corridor-merge-edits';
import { formCrossingJunctions } from '../../src/model/crossing-edits';
import { patternWayIds } from '../../src/model/geo';
import { mergeWaysEndToEnd } from '../../src/model/way-merge-edits';
import { removeWayFromSystem } from '../../src/model/way-removal';
import { deleteWayStretch } from '../../src/model/way-stretch-edits';
import { aPattern, aRoad, aService, aStation, aSystem } from '../support/fixtures.test';

describe('pure network edits', () => {
  it('merges end-to-end ways and reconciles every dependent entity', () => {
    const west = aRoad('west', [
      [-115.3, 36.1],
      [-115.2, 36.1],
    ]);
    const east = aRoad('east', [
      [-115.2, 36.1],
      [-115.1, 36.1],
    ]);
    const pattern = aPattern('pattern', [west, east], [west.id, east.id]);
    const system = aSystem({
      ways: [west, east],
      services: [aService('line', [pattern])],
      stations: [aStation('stop', [-115.15, 36.1], { wayId: east.id, t: 0.5 })],
      nodes: [
        {
          id: 'seam',
          coord: [-115.2, 36.1],
          refs: [
            { wayId: west.id, pointIndex: 1 },
            { wayId: east.id, pointIndex: 0 },
          ],
        },
      ],
      namedWays: [{ id: 'street', name: 'Main Street', wayIds: [west.id, east.id] }],
    });

    const merged = mergeWaysEndToEnd(system, west.id, east.id);

    expect(merged.ways.map((way) => way.id)).toEqual([west.id]);
    expect(patternWayIds(merged.services[0].path)).toEqual([west.id]);
    expect(merged.stations[0].anchors[0].wayId).toBe(west.id);
    expect(merged.stations[0].anchors[0].t).toBeTypeOf('number');
    expect(merged.nodes).toEqual([]);
    expect(merged.namedWays[0].wayIds).toEqual([west.id]);
    expect(merged.updatedAt).toBe(system.updatedAt);
  });

  it('separates and recombines carriageways without timestamp policy', () => {
    const road = aRoad('road', [
      [-115.2, 36.1],
      [-115.1, 36.1],
    ]);
    const system = aSystem({ ways: [road] });
    const createId = vi
      .fn<() => string>()
      .mockReturnValueOnce('backward')
      .mockReturnValueOnce('street');

    const separated = separateCarriageways(system, road.id, createId);

    expect(separated?.newWayId).toBe('backward');
    expect(separated?.system.ways).toHaveLength(2);
    expect(separated?.system.namedWays[0]).toMatchObject({
      id: 'street',
      wayIds: [road.id, 'backward'],
    });
    expect(separated?.system.updatedAt).toBe(system.updatedAt);
    if (!separated) throw new Error('The two-way road fixture must separate.');

    const combined = combineCarriageways(separated.system, 'street');
    expect(combined.ways.map((way) => way.id)).toEqual([road.id]);
    expect(combined.updatedAt).toBe(system.updatedAt);
  });

  it('forms a real node and four arms where roads cross', () => {
    const horizontal = aRoad('horizontal', [
      [-115.2, 36.1],
      [-115.1, 36.1],
    ]);
    const vertical = aRoad('vertical', [
      [-115.15, 36.05],
      [-115.15, 36.15],
    ]);
    let sequence = 0;
    const system = aSystem({ ways: [horizontal, vertical] });

    const crossed = formCrossingJunctions(
      system,
      horizontal.id,
      undefined,
      () => `generated-${sequence++}`,
    );

    expect(crossed).not.toBe(system);
    expect(crossed.ways).toHaveLength(4);
    expect(crossed.nodes.some((node) => node.refs.length >= 4)).toBe(true);
    expect(crossed.updatedAt).toBe(system.updatedAt);
  });

  it('deletes a middle stretch while preserving both service remnants', () => {
    const road = aRoad('road', [
      [-115.3, 36.1],
      [-115.1, 36.1],
    ]);
    const pattern = aPattern('pattern', [road], [road.id]);
    const system = aSystem({ ways: [road], services: [aService('line', [pattern])] });
    let sequence = 0;

    const deleted = deleteWayStretch(system, {
      wayId: road.id,
      fromT: 0.25,
      toT: 0.75,
      createId: () => `generated-${sequence++}`,
    });

    expect(deleted.affectedPatterns).toBe(1);
    expect(deleted.system.ways).toHaveLength(2);
    expect(deleted.system.services.map((service) => patternWayIds(service.path))).toHaveLength(2);
    expect(deleted.system.lines[0].serviceIds).toEqual(
      deleted.system.services.map((service) => service.id),
    );
    expect(deleted.system.updatedAt).toBe(system.updatedAt);
  });

  it('preserves input identity for invalid and equal edits', () => {
    const system = aSystem();

    expect(removeWayFromSystem(system, 'missing')).toBe(system);
    expect(mergeWaysEndToEnd(system, 'missing', 'other')).toBe(system);
    expect(combineCarriageways(system, 'missing')).toBe(system);
    expect(withMedianWidth(system, 'missing', undefined)).toBe(system);
    expect(deleteWayStretch(system, { wayId: 'missing', fromT: 0, toT: 1 }).system).toBe(system);
    expect(mergeWaysIntoCorridor(system, ['missing']).system).toBe(system);
  });
});
