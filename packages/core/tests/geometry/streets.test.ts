import { describe, expect, it } from 'vitest';
import { wayLaneGeometry } from '../../src/geometry/streets';
import { aRoad } from '../support/fixtures.test';

describe('physical lane surfaces', () => {
  it('builds closed lane polygons from shared cross-section boundaries', () => {
    const road = aRoad('surface-road', [
      [-115.207, 36.14],
      [-115.207, 36.16],
    ]);

    const geometry = wayLaneGeometry(road);

    expect(geometry.laneSurfaces).toHaveLength(road.profile.lanes.length);
    const [first, second] = geometry.laneSurfaces;
    expect(first.rightBoundary).toBe(second.leftBoundary);
    expect(first.ring[0]).toEqual(first.ring.at(-1));
    expect(first.ring).toHaveLength(first.leftBoundary.length + first.rightBoundary.length + 1);
  });
});
