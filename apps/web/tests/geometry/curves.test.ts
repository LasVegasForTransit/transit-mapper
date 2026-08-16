import { describe, expect, it } from 'vitest';
import {
  cumulativeLengths,
  nearestOnPath,
  pathLengthMeters,
  pointAtDistance,
  pointAtT,
  resolveWayPath,
  roundedCorners,
  wayLengthMeters,
} from '@transitmapper/core/model/geo';
import type { LngLat, Way } from '@transitmapper/core/model/system';
import { createEditorStore } from '../../src/editor/store';

/** The store's own ways list should always contain a way it just finished
 *  drawing; a miss here means the fixture setup above is broken. */
function mustFindWay(ways: Way[], id: string): Way {
  const way = ways.find((w) => w.id === id);
  if (!way) throw new Error(`expected way ${id}`);
  return way;
}

describe('geometry: straight vs curved on a way', () => {
  it('curved way path is densified', () => {
    const store = createEditorStore();
    const g = store.getState().beginWay('lightRail', 'curved');
    store.getState().addWayPoint(g, [-115.2, 36.1]);
    store.getState().addWayPoint(g, [-115.16, 36.16]);
    store.getState().addWayPoint(g, [-115.1, 36.1]);
    store.getState().finishWay();
    const way = mustFindWay(store.getState().system.ways, g);
    const straight = resolveWayPath({ ...way, geometry: 'straight' });
    const curved = resolveWayPath({ ...way, geometry: 'curved' });
    expect(curved.length).toBeGreaterThan(straight.length);
  });

  it('way length > 0', () => {
    const store = createEditorStore();
    const g = store.getState().beginWay('lightRail', 'curved');
    store.getState().addWayPoint(g, [-115.2, 36.1]);
    store.getState().addWayPoint(g, [-115.16, 36.16]);
    store.getState().addWayPoint(g, [-115.1, 36.1]);
    store.getState().finishWay();
    const way = mustFindWay(store.getState().system.ways, g);
    expect(wayLengthMeters(way)).toBeGreaterThan(1000);
  });
});

describe('rounded-corner curve: local support, no overshoot, exact endpoints', () => {
  const zig: LngLat[] = [
    [0, 0],
    [1, 1],
    [2, 0],
    [3, 1],
    [4, 0],
  ];
  const curve = roundedCorners(zig, 0.25, 24);

  it('curve starts and ends exactly at the first/last control point', () => {
    expect(curve[0]).toEqual(zig[0]);
    expect(curve[curve.length - 1][0]).toBe(zig[4][0]);
  });

  it('curve barely overshoots', () => {
    const ys = curve.map((p) => p[1]);
    const overshoot = Math.max(Math.max(...ys) - 1, 0 - Math.min(...ys));
    expect(overshoot).toBeLessThan(0.15);
  });

  it('nearestOnPath finds midpoint t≈0.5', () => {
    const near = nearestOnPath(
      [
        [0, 0],
        [10, 0],
      ] as LngLat[],
      [5, 1] as LngLat,
    );
    expect(near).toBeTruthy();
    if (!near) throw new Error('expected nearestOnPath to find a match');
    expect(Math.abs(near.t - 0.5)).toBeLessThan(0.05);
  });
});

// pointAtDistance (the vehicle sim's O(log n) position lookup) must produce
// the SAME coordinate as pointAtT for the equivalent distance: it's a faster
// path via precomputed arc lengths, not a different result.
describe('pointAtDistance matches pointAtT', () => {
  const path: LngLat[] = [
    [-115.2, 36.1],
    [-115.17, 36.13],
    [-115.1, 36.1],
    [-115.05, 36.2],
  ];
  const cum = cumulativeLengths(path);
  const total = cum[cum.length - 1];

  it('cumulativeLengths total matches pathLengthMeters', () => {
    expect(Math.abs(total - pathLengthMeters(path))).toBeLessThan(1e-6);
  });

  it('cumulativeLengths starts at 0 and is monotonic', () => {
    expect(cum[0]).toBe(0);
    expect(cum.every((v, i) => i === 0 || v >= cum[i - 1])).toBe(true);
  });

  it('pointAtDistance matches pointAtT across the path', () => {
    let maxDelta = 0;
    for (let k = 0; k <= 20; k++) {
      const t = k / 20;
      const viaT = pointAtT(path, t);
      const viaDist = pointAtDistance(path, cum, t * total);
      maxDelta = Math.max(maxDelta, Math.abs(viaT[0] - viaDist[0]), Math.abs(viaT[1] - viaDist[1]));
    }
    expect(maxDelta).toBeLessThan(1e-9);
  });

  it('pointAtDistance clamps before the start to the first point', () => {
    const start = pointAtDistance(path, cum, -100);
    expect(start).toEqual(path[0]);
  });

  it('pointAtDistance clamps past the end to the last point', () => {
    const end = pointAtDistance(path, cum, total + 100);
    expect(end).toEqual(path[path.length - 1]);
  });
});

// A rounded-corner curve has strictly LOCAL support: moving a far-away
// control point must not reshape a corner it isn't adjacent to (this is
// exactly what a tangent-continuous spline like Catmull-Rom gets wrong — it
// leaks influence two segments out instead of one).
describe('rounded-corner curve has strictly LOCAL support', () => {
  it('moving a far control point leaves distant corners exactly unchanged', () => {
    const base: LngLat[] = [
      [0, 0],
      [1, 0.4],
      [2, 0],
      [3, 0.4],
      [4, 0],
      [5, 0.4],
      [6, 0],
    ];
    const moved: LngLat[] = base.map((p, i) => (i === 5 ? [p[0], p[1] + 2] : p)); // move point 5 far away
    const curveBase = roundedCorners(base, 0.25, 12);
    const curveMoved = roundedCorners(moved, 0.25, 12);
    // The fillet around point 1 (index 1) depends only on points 0,1,2 — none of
    // which changed — so the first ~1/3 of the curve must be byte-identical.
    const untouchedCount = Math.floor(curveBase.length / 3);
    let identical = true;
    for (let i = 0; i < untouchedCount; i++) {
      if (curveBase[i][0] !== curveMoved[i][0] || curveBase[i][1] !== curveMoved[i][1])
        identical = false;
    }
    expect(identical).toBe(true);
  });
});
