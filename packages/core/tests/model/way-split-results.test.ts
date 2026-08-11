import { describe, expect, it, vi } from 'vitest';
import {
  splitWayAtIndexWithResult,
  splitWayAtPositionWithResult,
} from '../../src/model/way-split-results';
import { aRoad, aSystem } from '../support/fixtures.test';

describe('way split results', () => {
  it('returns null without minting ids when a requested split is invalid', () => {
    const createId = vi.fn(() => 'unused');
    const system = aSystem();

    expect(splitWayAtIndexWithResult(system, 'missing', 1, createId)).toBeNull();
    expect(splitWayAtPositionWithResult(system, 'missing', 0.5, createId)).toBeNull();
    expect(createId).not.toHaveBeenCalled();
  });

  it('reports the new way id created by an indexed split', () => {
    const road = aRoad('road', [
      [0, 0],
      [0.001, 0],
      [0.002, 0],
    ]);
    const system = aSystem({ ways: [road] });
    const createId = vi
      .fn<() => string>()
      .mockReturnValueOnce('east-half')
      .mockReturnValueOnce('split-node');

    const result = splitWayAtIndexWithResult(system, road.id, 1, createId);

    expect(result?.newWayId).toBe('east-half');
    expect(result?.system.ways.map((way) => way.id)).toEqual([road.id, 'east-half']);
    expect(createId).toHaveBeenCalledTimes(2);
  });

  it('reports the new way id after inserting a positional split point', () => {
    const road = aRoad('road', [
      [0, 0],
      [0.002, 0],
    ]);
    const system = aSystem({ ways: [road] });
    const createId = vi
      .fn<() => string>()
      .mockReturnValueOnce('east-half')
      .mockReturnValueOnce('split-node');

    const result = splitWayAtPositionWithResult(system, road.id, 0.5, createId);

    expect(result?.newWayId).toBe('east-half');
    expect(result?.system.ways[0].points).toHaveLength(2);
    expect(result?.system.ways[1].points).toHaveLength(2);
    expect(createId).toHaveBeenCalledTimes(2);
  });
});
