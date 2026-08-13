import { describe, expect, it } from 'vitest';
import { railTrackGeometry, wayLaneGeometry } from '../../src/geometry/streets';
import { defaultProfileFor } from '../../src/model/profile';
import { haversineMeters } from '../../src/model/geo';
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

  it('derives two rails and regularly spaced ties from a track centerline', () => {
    const railway = aRoad(
      'railway',
      [
        [-115.207, 36.14],
        [-115.207, 36.16],
      ],
      { typeId: 'lightRail', profile: defaultProfileFor('lightRail') },
    );
    const track = wayLaneGeometry(railway).lanes[0];
    const detail = railTrackGeometry(track);

    expect(detail.rails).toHaveLength(2);
    expect(detail.ties.length).toBeGreaterThan(10);
    expect(haversineMeters(detail.rails[0][0], detail.rails[1][0])).toBeCloseTo(1.435, 1);
    expect(detail.ties.every((tie) => tie.length === 2)).toBe(true);
  });
});
