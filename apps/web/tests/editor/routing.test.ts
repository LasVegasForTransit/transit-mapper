import { beforeEach, describe, expect, it } from 'vitest';
import { createEditorStore } from '../../src/editor/store';
import {
  anchorOnWay,
  routeBetween,
  routePath,
  type RouteAnchor,
} from '@transitmapper/core/model/routeGraph';
import {
  haversineMeters,
  patternLegs,
  patternWayIds,
  legIsWhole,
  pathLengthMeters,
  patternPath,
  snap,
} from '@transitmapper/core/model/geo';
import { primaryAnchor } from '@transitmapper/core/model/geo';
import type { LngLat, TransitSystem } from '@transitmapper/core/model/system';

/** Narrows an optional lookup result without a non-null assertion: every call
 * site here knows from the fixture it just built that the value exists. */
function must<T>(value: T | null | undefined, label = 'value'): T {
  if (value == null) throw new Error(`expected ${label} to be defined`);
  return value;
}

describe('bare infrastructure toggle: draw roads WITHOUT auto-creating a line', () => {
  let store: ReturnType<typeof createEditorStore>;

  beforeEach(() => {
    store = createEditorStore();
    store.getState().setDraftWayType('road');
    store.getState().setDraftServiceEnabled(false);
    const r = store.getState().beginWay();
    store.getState().addWayPoint(r, [-115.2, 36.1]);
    store.getState().addWayPoint(r, [-115.1, 36.1]);
    store.getState().finishWay();
  });

  it('service toggle off: drawing a road creates NO service', () => {
    expect(store.getState().system.services.length).toBe(0);
  });

  it('the bare road itself exists and is selected-style bare infra', () => {
    expect(store.getState().system.ways.length).toBe(1);
  });

  // Picking a mode is an explicit "draw a line" — it re-enables services.
  it('choosing a mode re-enables service creation', () => {
    store.getState().setDraftMode('bus');
    expect(store.getState().draftServiceEnabled).toBe(true);
  });

  it('after re-enabling, drawing creates the service again', () => {
    store.getState().setDraftMode('bus');
    const r2 = store.getState().beginWay();
    store.getState().addWayPoint(r2, [-115.2, 36.2]);
    store.getState().addWayPoint(r2, [-115.1, 36.2]);
    store.getState().finishWay();
    expect(store.getState().system.services.length).toBe(1);
  });
});

// ===========================================================================
// Routing over existing infrastructure (model/routeGraph.ts + store actions)
// ===========================================================================

// Builds a small street grid: two east-west roads crossed by one north-south
// road → auto-junctions split everything into arms. Reimplemented locally
// (source: verify.test.ts:8571-8593) parameterized on the test's own store —
// its internal fresh() call is dropped since each test already gets a fresh
// store via beforeEach.
function buildGrid(store: ReturnType<typeof createEditorStore>) {
  const draw = (pts: LngLat[]) => {
    const w = store.getState().beginWay('road', 'straight');
    for (const p of pts) store.getState().addWayPoint(w, p);
    store.getState().finishWay();
    return w;
  };
  store.getState().setDraftServiceEnabled(false); // bare streets
  draw([
    [-115.3, 36.2],
    [-115.1, 36.2],
  ]); // top EW
  draw([
    [-115.3, 36.1],
    [-115.1, 36.1],
  ]); // bottom EW
  draw([
    [-115.2, 36.05],
    [-115.2, 36.25],
  ]); // NS, crossing both
  store.getState().setDraftServiceEnabled(true);
}

describe('routeBetween: shortest path through junctions, mid-way anchors', () => {
  let store: ReturnType<typeof createEditorStore>;
  let sys: TransitSystem;
  let from: RouteAnchor;
  let to: RouteAnchor;

  beforeEach(() => {
    store = createEditorStore();
    buildGrid(store);
    sys = store.getState().system;
    const wayAtCoord = (c: LngLat) => {
      const s = must(snap(sys.ways, c, 50), 'snap result');
      return must(
        sys.ways.find((w) => w.id === s.wayId),
        'snapped way',
      );
    };
    from = must(anchorOnWay(wayAtCoord([-115.28, 36.2]), [-115.28, 36.2]), 'from anchor');
    to = must(anchorOnWay(wayAtCoord([-115.12, 36.1]), [-115.12, 36.1]), 'to anchor');
  });

  function routeTopToBottom() {
    return must(routeBetween(sys, from, to, { allowedTypeIds: new Set(['road']) }), 'route');
  }

  it('grid built bare (no services) with junction-split arms', () => {
    expect(sys.services.length).toBe(0);
    expect(sys.ways.length).toBe(7);
    expect(sys.nodes.length).toBe(2);
  });

  it('routeBetween finds a path across two junctions', () => {
    expect(routeTopToBottom().spans.length).toBe(3);
  });

  it('route length ≈ manhattan distance (~29km)', () => {
    const res = routeTopToBottom();
    expect(res.lengthM).toBeGreaterThan(25000);
    expect(res.lengthM).toBeLessThan(33000);
  });

  it('routePath starts and ends at the anchors', () => {
    const path = routePath(sys, routeTopToBottom().spans);
    expect(haversineMeters(path[0], from.coord)).toBeLessThan(5);
    expect(haversineMeters(path[path.length - 1], to.coord)).toBeLessThan(5);
  });

  it('route path is continuous (no jumps between spans)', () => {
    const path = routePath(sys, routeTopToBottom().spans);
    expect(path.every((p, i) => i === 0 || haversineMeters(path[i - 1], p) < 15000)).toBe(true);
  });

  it('routeBetween respects mode compatibility (no rail path over roads)', () => {
    const none = routeBetween(sys, from, to, { allowedTypeIds: new Set(['heavyRail']) });
    expect(none).toBeNull();
  });
});

describe('createRoutedService: materializes splits, service rides existing ways', () => {
  let store: ReturnType<typeof createEditorStore>;

  beforeEach(() => {
    store = createEditorStore();
    buildGrid(store);
  });

  function route() {
    const sys = store.getState().system;
    const s1 = must(snap(sys.ways, [-115.28, 36.2], 50), 'snap 1');
    const s2 = must(snap(sys.ways, [-115.12, 36.1], 50), 'snap 2');
    const from = must(anchorOnWay(must(sys.ways.find((w) => w.id === s1.wayId)), s1.coord));
    const to = must(anchorOnWay(must(sys.ways.find((w) => w.id === s2.wayId)), s2.coord));
    return must(routeBetween(sys, from, to, { allowedTypeIds: new Set(['road']) }), 'route');
  }

  it('createRoutedService creates the service', () => {
    const res = route();
    const svcId = store.getState().createRoutedService(res.spans, 'bus');
    const after = store.getState().system;
    expect(!!svcId).toBe(true);
    expect(after.services.length).toBe(1);
  });

  it('the routed service rides one pattern of existing ways', () => {
    const res = route();
    store.getState().createRoutedService(res.spans, 'bus');
    const svc = store.getState().system.services[0];
    expect(svc.patterns.length).toBe(1);
    expect(patternLegs(svc.patterns[0]).length).toBe(res.spans.length);
  });

  it('routing over existing streets adds no infrastructure at all', () => {
    const res = route();
    const waysBefore = store.getState().system.ways.length;
    store.getState().createRoutedService(res.spans, 'bus');
    expect(store.getState().system.ways.length).toBe(waysBefore);
  });

  it('no new parallel geometry was drawn (every ridden way pre-existed)', () => {
    const res = route();
    store.getState().createRoutedService(res.spans, 'bus');
    const after = store.getState().system;
    const svc = after.services[0];
    expect(
      patternWayIds(svc.patterns[0]).every((wid) =>
        after.ways.some((w) => w.id === wid && w.typeId === 'road'),
      ),
    ).toBe(true);
  });

  it('the mid-way anchors became leg extents rather than splits', () => {
    const res = route();
    store.getState().createRoutedService(res.spans, 'bus');
    const svc = store.getState().system.services[0];
    expect(patternLegs(svc.patterns[0]).some((l) => !legIsWhole(l))).toBe(true);
  });

  // The route length is now measured off what the legs actually cover, not by
  // summing whole ways — which is the point: the ways are longer than the ride.
  it('the drawn line covers the route length', () => {
    const res = route();
    store.getState().createRoutedService(res.spans, 'bus');
    const after = store.getState().system;
    const svc = after.services[0];
    expect(
      Math.abs(pathLengthMeters(patternPath(after.ways, svc.patterns[0])) - res.lengthM),
    ).toBeLessThan(500);
  });
});

describe("route draft state machine (the drawing gesture's backend)", () => {
  let store: ReturnType<typeof createEditorStore>;
  let from: RouteAnchor;
  let to: RouteAnchor;

  beforeEach(() => {
    store = createEditorStore();
    buildGrid(store);
    const sys = store.getState().system;
    const s1 = must(snap(sys.ways, [-115.28, 36.2], 50), 'snap 1');
    const s2 = must(snap(sys.ways, [-115.12, 36.1], 50), 'snap 2');
    from = must(anchorOnWay(must(sys.ways.find((w) => w.id === s1.wayId)), s1.coord));
    to = must(anchorOnWay(must(sys.ways.find((w) => w.id === s2.wayId)), s2.coord));
  });

  it('startRouteDraft opens an empty draft', () => {
    store.getState().startRouteDraft(from);
    expect(store.getState().routeDraft?.spans.length).toBe(0);
  });

  it('extendRouteDraft appends routed spans', () => {
    store.getState().startRouteDraft(from);
    const ok = store.getState().extendRouteDraft(to);
    expect(ok).toBe(true);
    expect(must(store.getState().routeDraft, 'route draft').spans.length).toBe(3);
  });

  it('commitRouteDraft creates the service and clears the draft', () => {
    store.getState().startRouteDraft(from);
    store.getState().extendRouteDraft(to);
    const svcId = store.getState().commitRouteDraft();
    expect(!!svcId).toBe(true);
    expect(store.getState().routeDraft).toBeNull();
    expect(store.getState().system.services.length).toBe(1);
  });

  it('cancelRouteDraft clears without creating anything', () => {
    store.getState().startRouteDraft(from);
    store.getState().cancelRouteDraft();
    expect(store.getState().routeDraft).toBeNull();
    expect(store.getState().system.services.length).toBe(0);
  });
});

describe('routing along a SINGLE way (the first-gesture case that hit the degenerate same-segment path in the browser)', () => {
  let store: ReturnType<typeof createEditorStore>;
  let from: RouteAnchor;
  let to: RouteAnchor;

  beforeEach(() => {
    store = createEditorStore();
    store.getState().setDraftServiceEnabled(false);
    const r = store.getState().beginWay('road', 'straight');
    store.getState().addWayPoint(r, [-115.3, 36.1]);
    store.getState().addWayPoint(r, [-115.1, 36.1]);
    store.getState().finishWay();
    store.getState().setDraftServiceEnabled(true);
    const way = store.getState().system.ways[0];
    from = must(anchorOnWay(way, [-115.27, 36.1]));
    to = must(anchorOnWay(way, [-115.14, 36.1]));
  });

  function route() {
    return must(
      routeBetween(store.getState().system, from, to, { allowedTypeIds: new Set(['road']) }),
      'route',
    );
  }

  it('same-way route resolves (same-segment direct span)', () => {
    const res = route();
    expect(res.spans.length).toBe(1);
    expect(res.spans[0].noInterior).toBe(true);
  });

  it('same-way route length matches the click distance (~11.7km)', () => {
    const res = route();
    expect(res.lengthM).toBeGreaterThan(11000);
    expect(res.lengthM).toBeLessThan(12500);
  });

  it('same-way route path runs between the two clicks', () => {
    const path = routePath(store.getState().system, route().spans);
    expect(path.length).toBe(2);
    expect(Math.abs(path[0][0] - -115.27)).toBeLessThan(1e-6);
    expect(Math.abs(path[1][0] - -115.14)).toBeLessThan(1e-6);
  });

  it('extend along the same way succeeds', () => {
    store.getState().startRouteDraft(from);
    expect(store.getState().extendRouteDraft(to)).toBe(true);
  });

  it('committing a same-way route creates the service', () => {
    store.getState().startRouteDraft(from);
    store.getState().extendRouteDraft(to);
    const svcId = store.getState().commitRouteDraft();
    const sys = store.getState().system;
    expect(!!svcId).toBe(true);
    expect(sys.services.length).toBe(1);
  });

  it('the road stays one way', () => {
    store.getState().startRouteDraft(from);
    store.getState().extendRouteDraft(to);
    store.getState().commitRouteDraft();
    expect(store.getState().system.ways.length).toBe(1);
  });

  it('the line rides a stretch of it', () => {
    const way = store.getState().system.ways[0];
    store.getState().startRouteDraft(from);
    store.getState().extendRouteDraft(to);
    store.getState().commitRouteDraft();
    const sys = store.getState().system;
    const ridden = patternWayIds(sys.services[0].patterns[0]);
    expect(ridden.length).toBe(1);
    expect(ridden[0]).toBe(way.id);
  });

  // The clicks were at -115.27 and -115.14 on a road running -115.3 to -115.1.
  it('the drawn line spans exactly the clicked stretch', () => {
    store.getState().startRouteDraft(from);
    store.getState().extendRouteDraft(to);
    store.getState().commitRouteDraft();
    const sys = store.getState().system;
    const drawn = patternPath(sys.ways, sys.services[0].patterns[0]);
    expect(Math.abs(drawn[0][0] - -115.27)).toBeLessThan(1e-6);
    expect(Math.abs(drawn[drawn.length - 1][0] - -115.14)).toBeLessThan(1e-6);
  });
});

describe('adoptExistingInfrastructure: sketched line re-binds onto the grid', () => {
  let store: ReturnType<typeof createEditorStore>;

  beforeEach(() => {
    store = createEditorStore();
    buildGrid(store);
  });

  // Sketch a bus line roughly along the top road, offset ~200m north — the
  // Network-view sketch flow (service enabled) creating parallel geometry.
  function sketchLine() {
    const sketch = store.getState().beginWay('road', 'straight');
    store.getState().addWayPoint(sketch, [-115.28, 36.202]);
    store.getState().addWayPoint(sketch, [-115.12, 36.202]);
    store.getState().finishWay();
    return store.getState().system.services[0];
  }

  it('sketch created its own service + parallel geometry', () => {
    sketchLine();
    const before = store.getState().system;
    expect(!!before.services[0]).toBe(true);
    expect(before.ways.length).toBeGreaterThan(7);
  });

  it('adoptExistingInfrastructure rebinds the pattern', () => {
    const svc = sketchLine();
    const rebound = store.getState().adoptExistingInfrastructure(svc.id);
    expect(rebound).toBe(1);
  });

  it('the adopted pattern rides real grid ways (top road arms)', () => {
    const svc = sketchLine();
    store.getState().adoptExistingInfrastructure(svc.id);
    const after = store.getState().system;
    const adopted = must(
      after.services.find((sv) => sv.id === svc.id),
      'adopted service',
    );
    expect(patternLegs(adopted.patterns[0]).length).toBeGreaterThanOrEqual(1);
    expect(
      patternWayIds(adopted.patterns[0]).every((wid) => after.ways.some((w) => w.id === wid)),
    ).toBe(true);
  });

  it('adopted ways lie on the grid, not the sketch offset', () => {
    const svc = sketchLine();
    store.getState().adoptExistingInfrastructure(svc.id);
    const after = store.getState().system;
    const adopted = must(
      after.services.find((sv) => sv.id === svc.id),
      'adopted service',
    );
    const onGrid = (wid: string) => {
      const w = must(
        after.ways.find((x) => x.id === wid),
        'adopted way',
      );
      return w.points.every((p) => Math.abs(p[1] - 36.2) < 0.0005);
    };
    expect(patternWayIds(adopted.patterns[0]).every(onGrid)).toBe(true);
  });

  it('orphaned sketch geometry was removed', () => {
    const svc = sketchLine();
    const sketchWayIds = new Set(patternWayIds(svc.patterns[0]));
    store.getState().adoptExistingInfrastructure(svc.id);
    const after = store.getState().system;
    expect(after.ways.every((w) => !sketchWayIds.has(w.id))).toBe(true);
  });

  it('the station followed onto an adopted way', () => {
    const svc = sketchLine();
    // A station riding the sketch, to prove it follows the adoption.
    const st1 = store
      .getState()
      .addStation([-115.25, 36.202], { wayId: patternWayIds(svc.patterns[0])[0], t: 0.2 });
    store.getState().adoptExistingInfrastructure(svc.id);
    const after = store.getState().system;
    const adopted = must(
      after.services.find((sv) => sv.id === svc.id),
      'adopted service',
    );
    const station = must(
      after.stations.find((s2) => s2.id === st1),
      'station',
    );
    const anchor = must(primaryAnchor(station), 'station anchor');
    expect(patternWayIds(adopted.patterns[0])).toContain(anchor.wayId);
  });
});
