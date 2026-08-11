import { describe, expect, it, vi } from 'vitest';
import { separateCarriageways, withMedianWidth } from '../../src/model/carriageway-edits';
import { mergeWaysIntoCorridor } from '../../src/model/corridor-merge-edits';
import { formCrossingJunctions } from '../../src/model/crossing-edits';
import { offsetMeters, patternWayIds } from '../../src/model/geo';
import type { LngLat } from '../../src/model/system';
import { aPattern, aRoad, aService, aSystem } from '../support/fixtures.test';

describe('related network transform coverage', () => {
  it('does not mint carriageway ids when separation is impossible', () => {
    const createId = vi.fn(() => 'unused');
    const system = aSystem();

    expect(separateCarriageways(system, 'missing', createId)).toBeNull();
    expect(createId).not.toHaveBeenCalled();
  });

  it('adds, preserves, updates, and removes median width without timestamp policy', () => {
    const system = aSystem({ updatedAt: 123 });

    const added = withMedianWidth(system, 'main-street', 4);
    expect(added.medians).toEqual({ 'main-street': { widthM: 4, kindId: 'median' } });
    expect(added.updatedAt).toBe(123);
    expect(withMedianWidth(added, 'main-street', 4)).toBe(added);

    const updated = withMedianWidth(added, 'main-street', 6);
    expect(updated.medians).toEqual({ 'main-street': { widthM: 6, kindId: 'median' } });

    const removed = withMedianWidth(updated, 'main-street', undefined);
    expect(removed.medians).toEqual({});
    expect(withMedianWidth(removed, 'main-street', undefined)).toBe(removed);
  });

  it('preserves the system and id source when no crossing can be formed', () => {
    const road = aRoad('road', [
      [0, 0],
      [0.001, 0],
    ]);
    const parallel = aRoad('parallel', [
      [0, 0.001],
      [0.001, 0.001],
    ]);
    const createId = vi.fn(() => 'unused');
    const system = aSystem({ ways: [road, parallel] });

    expect(formCrossingJunctions(system, 'missing', undefined, createId)).toBe(system);
    expect(formCrossingJunctions(system, road.id, undefined, createId)).toBe(system);
    expect(createId).not.toHaveBeenCalled();
  });

  it('merges explicitly selected parallel service ways into one corridor', () => {
    const origin: LngLat = [-115.2, 36.1];
    const trunk = aRoad('trunk', [offsetMeters(origin, 0, 0), offsetMeters(origin, 400, 0)]);
    const shuttle = aRoad('shuttle', [offsetMeters(origin, 100, 3), offsetMeters(origin, 300, 3)]);
    const trunkService = aService('trunk-service', [
      aPattern('trunk-pattern', [trunk], [trunk.id]),
    ]);
    const shuttleService = aService('shuttle-service', [
      aPattern('shuttle-pattern', [shuttle], [shuttle.id]),
    ]);
    const system = aSystem({
      updatedAt: 456,
      ways: [trunk, shuttle],
      services: [trunkService, shuttleService],
    });

    const result = mergeWaysIntoCorridor(system, [trunk.id, shuttle.id]);

    expect(result.absorbed).toBe(1);
    expect(result.system.ways).toEqual([trunk]);
    expect(patternWayIds(result.system.services[1].path)).toEqual([trunk.id]);
    expect(result.system.services[0]).toBe(trunkService);
    expect(result.system.updatedAt).toBe(456);
  });
});
