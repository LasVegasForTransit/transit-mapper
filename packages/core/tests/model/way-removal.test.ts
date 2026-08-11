import { removeWayFromSystem } from '../../src/model/way-removal';
import { aRoad, aSystem } from '../support/fixtures.test';
import { describe, expect, it } from 'vitest';

describe('way removal', () => {
  it('removes every cross-entity reference owned by the way', () => {
    const way = aRoad('way', [
      [0, 0],
      [0.001, 0],
    ]);
    const system = aSystem({
      ways: [way],
      groups: [{ id: 'group', memberIds: ['way'] }],
      namedWays: [{ id: 'named', name: 'Street', wayIds: ['way'] }],
      medians: { named: { kindId: 'median', widthM: 3 } },
      approachControls: { 'way:start': { control: 'stop' } },
    });

    const next = removeWayFromSystem(system, 'way');

    expect(next.ways).toEqual([]);
    expect(next.groups[0].memberIds).toEqual([]);
    expect(next.namedWays).toEqual([]);
    expect(next.medians).toEqual({});
    expect(next.approachControls).toEqual({});
    expect(next.updatedAt).toBe(system.updatedAt);
    expect(removeWayFromSystem(next, 'missing')).toBe(next);
  });
});
