import { describe, expect, it } from 'vitest';
import { bearingDegrees, formatBearing, servedWayIds, snap } from '@transitmapper/core/model/geo';
import { defaultProfileFor } from '@transitmapper/core/model/profile';
import type { LngLat, Way } from '@transitmapper/core/model/system';

describe('bearingDegrees / formatBearing', () => {
  it('due east is 90°', () => {
    expect(Math.abs(bearingDegrees([-115.2, 36.1], [-115.1, 36.1]) - 90)).toBeLessThan(0.5);
  });

  it('due north is 0°', () => {
    expect(bearingDegrees([-115.2, 36.1], [-115.2, 36.2])).toBeLessThan(0.5);
  });

  it('due south wraps to ~180°', () => {
    expect(Math.abs(bearingDegrees([-115.2, 36.2], [-115.2, 36.1]) - 180)).toBeLessThan(0.5);
  });

  it('formatBearing labels the nearest compass point', () => {
    expect(formatBearing(91)).toBe('91° E');
  });

  it('formatBearing rounds degrees', () => {
    expect(formatBearing(44.6)).toBe('45° NE');
  });
});

describe('servedWayIds: spatial-grid index stays correct across cell/segment boundaries', () => {
  // A long way (many points, spanning several of the index's ~300m grid
  // cells) — a station near its FAR end must still be found. A naive index
  // that only registered a segment in the cell of its first point would
  // miss this (the exact bug shape a per-way bounding box or a
  // single-cell-per-segment index could hide).
  const longWay: Way = {
    id: 'long',
    typeId: 'road',
    points: Array.from({ length: 40 }, (_, i) => [-115.2 + i * 0.002, 36.1] as LngLat),
    geometry: 'straight',
    grade: 'atGrade',
    profile: defaultProfileFor('road'),
  };
  const farWay: Way = {
    id: 'far',
    typeId: 'road',
    points: [
      [-114.0, 37.0],
      [-114.0, 37.01],
    ],
    geometry: 'straight',
    grade: 'atGrade',
    profile: defaultProfileFor('road'),
  };
  const nearFarEnd: LngLat = [longWay.points[39][0], 36.1];
  const served = servedWayIds(nearFarEnd, [longWay, farWay], 50);

  it("a station near a long way's far end is still found", () => {
    expect(served).toContain('long');
  });

  it('a way many degrees away is correctly excluded', () => {
    expect(served).not.toContain('far');
  });

  it('a coordinate with nothing nearby returns no matches', () => {
    expect(servedWayIds([-110, 40], [longWay, farWay], 50).length).toBe(0);
  });
});

describe("determinism: index answers don't depend on bucket iteration order", () => {
  // Both of these read the segment grid by walking cell buckets, so their
  // answers used to depend on the order segments happened to be inserted.
  // That is observable today (servedWayIds' first entry colors the station
  // in buildFeatures) and it becomes a hard blocker for maintaining the
  // grid INCREMENTALLY, since updating one way in place necessarily
  // reorders buckets. Passing the same ways in a different array order is
  // the cheap stand-in for that reordering: a different array is a
  // different grid, built in a different order, and the answer must not
  // move.
  const detRoad = (id: string, pts: LngLat[]): Way => ({
    id,
    typeId: 'road',
    points: pts,
    geometry: 'straight',
    grade: 'atGrade',
    profile: defaultProfileFor('road'),
  });
  // Two ways lying exactly on top of each other — reachable with conflated
  // or duplicated GTFS shapes, and precisely the case distance alone can't
  // settle.
  const twinA = detRoad('a-twin', [
    [-115.2, 36.1],
    [-115.1, 36.1],
  ]);
  const twinB = detRoad('b-twin', [
    [-115.2, 36.1],
    [-115.1, 36.1],
  ]);
  const onLine: LngLat = [-115.15, 36.1];

  it('snap resolves exactly-equidistant ways the same way whichever order they were indexed in', () => {
    expect(snap([twinA, twinB], onLine, 50)?.wayId).toBe('a-twin');
    expect(snap([twinB, twinA], onLine, 50)?.wayId).toBe('a-twin');
  });

  it('servedWayIds orders coincident ways the same whichever order they were indexed in', () => {
    expect(servedWayIds(onLine, [twinA, twinB], 50)).toEqual(
      servedWayIds(onLine, [twinB, twinA], 50),
    );
  });

  it("servedWayIds lists the nearest way first, so it decides a station's color", () => {
    // Named so that sorting by id alone would put the FAR way first — this
    // only passes if the ordering is genuinely by distance.
    const nearWay = detRoad('z-near', [
      [-115.2, 36.1],
      [-115.1, 36.1],
    ]);
    const farWay = detRoad('a-far', [
      [-115.2, 36.1004],
      [-115.1, 36.1004],
    ]); // ~44m north
    const ranked = servedWayIds(onLine, [farWay, nearWay], 90);
    expect(ranked.length).toBe(2);
    expect(ranked[0]).toBe('z-near');
  });
});

describe("snap: shares servedWayIds' spatial grid — same boundary-correctness requirement, since a naive per-way-bbox or single-cell index would miss a coordinate near a long way's far end", () => {
  const longWay: Way = {
    id: 'long',
    typeId: 'road',
    points: Array.from({ length: 40 }, (_, i) => [-115.2 + i * 0.002, 36.1] as LngLat),
    geometry: 'straight',
    grade: 'atGrade',
    profile: defaultProfileFor('road'),
  };
  const farWay: Way = {
    id: 'far',
    typeId: 'road',
    points: [
      [-114.0, 37.0],
      [-114.0, 37.01],
    ],
    geometry: 'straight',
    grade: 'atGrade',
    profile: defaultProfileFor('road'),
  };
  const nearFarEnd: LngLat = [longWay.points[39][0], 36.1];
  const hit = snap([longWay, farWay], nearFarEnd, 50);

  it('snap finds the long way from a coordinate near its far end', () => {
    expect(hit?.wayId).toBe('long');
  });

  it("snap's t lands at the far end of the path, not the near end", () => {
    expect(hit?.t ?? 0).toBeGreaterThan(0.9);
  });

  it('snap finds nothing for a coordinate with no way nearby', () => {
    expect(snap([longWay, farWay], [-110, 40], 50)).toBeNull();
  });
});
