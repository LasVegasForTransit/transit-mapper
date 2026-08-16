import { describe, expect, it, beforeEach } from 'vitest';
import {
  deriveLegDirections,
  haversineMeters,
  legIsWhole,
  legRange,
  oneSection,
  patternLegs,
  patternPath,
  patternSegments,
  pathLengthMeters,
  wholeLegs,
} from '@transitmapper/core/model/geo';
import { wayIntersectsBounds } from '@transitmapper/core/geometry/streets';
import { anchorOnWay } from '@transitmapper/core/model/routeGraph';
import { MODES } from '@transitmapper/core/model/catalog';
import type { LngLat, PatternLeg, Way } from '@transitmapper/core/model/system';
import { createEditorStore } from '../../src/editor/store';
import { required } from '../support/required.test';
import { buildFeatures } from '../support/testRenderPresentation.test';

/** A leg's covered stretch, for assertions that used to read fromT/toT. */
const legFrom = (l: PatternLeg): number => legRange(l)[0];
const legTo = (l: PatternLeg): number => legRange(l)[1];

/** Throw-guard for a lookup this test's own setup guarantees succeeds — turns
 *  a silent `undefined`/`null` into a clear failure at the point of use
 *  instead of a confusing crash further down the assertion. */
function mustFind<T>(v: T | null | undefined, what: string): T {
  if (v === null || v === undefined) throw new Error(`expected ${what}`);
  return v;
}

/** The `offset` GeoJSON feature property is always a number for a service
 *  line feature; narrow it once here instead of at every call site. */
const offsetOf = (f: { properties?: Record<string, unknown> | null }): number | undefined =>
  f.properties?.offset as number | undefined;

// A through-line keeps ONE offset across a shared stretch (no sideways jog
// where the shared segment begins/ends).
describe('continuity-aware bundle offsets', () => {
  let store: ReturnType<typeof createEditorStore>;
  let A: string;
  let aId: string;
  let waysBefore: number;
  let bId: string;

  beforeEach(() => {
    store = createEditorStore();
    store.commands.tools.setDraftMode('lightRail');
    A = required(store.commands.ways.beginWay('lightRail', 'straight'));
    store.commands.ways.addWayPoint(A, [-115.3, 36.1]);
    store.commands.ways.addWayPoint(A, [-115.2, 36.1]);
    store.commands.ways.addWayPoint(A, [-115.1, 36.1]);
    store.commands.ways.finishWay();
    aId = store.getState().system.services[0].id;
    // Route a second service along A's MIDDLE. The way is left alone — the new
    // service's leg just names the stretch it uses — so the through-line still
    // rides one way end to end and the joiner draws only over the shared middle.
    waysBefore = store.getState().system.ways.length;
    const w = mustFind(
      store.getState().system.ways.find((x) => x.id === A),
      'way',
    );
    store.commands.routing.startRouteDraft(mustFind(anchorOnWay(w, [-115.27, 36.1]), 'anchor'));
    store.commands.routing.extendRouteDraft(mustFind(anchorOnWay(w, [-115.13, 36.1]), 'anchor'));
    bId = mustFind(store.commands.routing.commitRouteDraft(), 'bId');
  });

  it('a service terminating mid-way leaves the way whole — no split, no fragment', () => {
    expect(store.getState().system.ways.length).toBe(waysBefore);
  });

  it('the joining service names the stretch it uses instead of owning a way', () => {
    const bSvc = mustFind(
      store.getState().system.services.find((sv) => sv.id === bId),
      'service',
    );
    const bLeg = patternLegs(bSvc.path)[0];
    expect(patternLegs(bSvc.path).length).toBe(1);
    expect(bLeg.wayId).toBe(A);
    expect(legIsWhole(bLeg)).toBe(false);
    expect(legFrom(bLeg)).toBeGreaterThan(0);
    expect(legTo(bLeg)).toBeLessThan(1);
  });

  describe('rendering the shared stretch', () => {
    const filters = {
      visibleModes: new Set(Object.keys(MODES)),
      visibleWayTypes: new Set(['lightRail', 'road']),
    };

    it('the through-line is drawn as one unbroken run over the whole way', () => {
      const net = buildFeatures(store.getState().system, null, [], {
        viewMode: 'network',
        ...filters,
      });
      const aFeats = net.services.features.filter(
        (f) => f.properties?.serviceId === aId && !f.properties.hitTarget,
      );
      expect(aFeats.length).toBe(1);
    });

    it('a through-line keeps ONE constant offset across all its ways (no jog)', () => {
      const net = buildFeatures(store.getState().system, null, [], {
        viewMode: 'network',
        ...filters,
      });
      const aFeats = net.services.features.filter(
        (f) => f.properties?.serviceId === aId && !f.properties.hitTarget,
      );
      const aOffsets = new Set(aFeats.map(offsetOf));
      expect(aOffsets.size).toBe(1);
    });

    it('the joining service takes a different offset where they share', () => {
      const net = buildFeatures(store.getState().system, null, [], {
        viewMode: 'network',
        ...filters,
      });
      const aFeats = net.services.features.filter(
        (f) => f.properties?.serviceId === aId && !f.properties.hitTarget,
      );
      const bFeats = net.services.features.filter(
        (f) => f.properties?.serviceId === bId && !f.properties.hitTarget,
      );
      const aOffsets = new Set(aFeats.map(offsetOf));
      expect(bFeats.length).toBeGreaterThanOrEqual(1);
      expect(aOffsets.has(offsetOf(bFeats[0]))).toBe(false);
    });

    it('the joining service is drawn only over the stretch it runs, not the whole way', () => {
      const net = buildFeatures(store.getState().system, null, [], {
        viewMode: 'network',
        ...filters,
      });
      const aFeats = net.services.features.filter(
        (f) => f.properties?.serviceId === aId && !f.properties.hitTarget,
      );
      const bFeats = net.services.features.filter(
        (f) => f.properties?.serviceId === bId && !f.properties.hitTarget,
      );
      expect(bFeats.length).toBe(1);
      expect(pathLengthMeters(bFeats[0].geometry.coordinates as LngLat[])).toBeLessThan(
        pathLengthMeters(aFeats[0].geometry.coordinates as LngLat[]) * 0.95,
      );
    });

    // A station out at the end of the way is on the through-line only. Riding a
    // way is no longer the same as reaching every point on it, so "which lines
    // serve this stop" has to ask where the line actually goes — otherwise the
    // stop wrongly reads as an interchange.
    it('a stop past where a line terminates is not counted as served by it', () => {
      store.commands.stops.addStop([-115.295, 36.1]);
      const withStop = buildFeatures(store.getState().system, null, [], {
        viewMode: 'network',
        ...filters,
      });
      const endStop = withStop.stops.features[0];
      expect(endStop.properties?.interchange).toBe(false);
    });

    // …and one inside the shared stretch still is.
    it('a stop inside the shared stretch is served by both lines', () => {
      store.commands.stops.addStop([-115.295, 36.1]);
      const withStop = buildFeatures(store.getState().system, null, [], {
        viewMode: 'network',
        ...filters,
      });
      const endStop = withStop.stops.features[0];
      store.commands.stops.addStop([-115.2, 36.1]);
      const shared = mustFind(
        buildFeatures(store.getState().system, null, [], {
          viewMode: 'network',
          ...filters,
        }).stops.features.find((f) => f.properties?.id !== endStop.properties?.id),
        'station feature',
      );
      expect(shared.properties?.interchange).toBe(true);
    });
  });
});

// wayIntersectsBounds is segment-aware, so lane detail isn't culled when you
// zoom into the MIDDLE of a long way (both its vertices off-screen).
describe('wayIntersectsBounds is segment-aware', () => {
  let store: ReturnType<typeof createEditorStore>;
  let way: Way;

  beforeEach(() => {
    store = createEditorStore();
    const w = required(store.commands.ways.beginWay('road', 'straight'));
    store.commands.ways.addWayPoint(w, [-115.3, 36.1]);
    store.commands.ways.addWayPoint(w, [-115.0, 36.1]);
    store.commands.ways.finishWay();
    way = mustFind(
      store.getState().system.ways.find((x) => x.id === w),
      'way',
    );
  });

  it('segment crossing a mid-way viewport counts (both vertices outside)', () => {
    // A tiny viewport in the MIDDLE of the way — both endpoints far outside it.
    expect(
      wayIntersectsBounds(
        way,
        [
          [-115.151, 36.099],
          [-115.149, 36.101],
        ],
        0,
      ),
    ).toBe(true);
  });

  it('a viewport off the alignment does not count', () => {
    // A viewport nowhere near the alignment does not.
    expect(
      wayIntersectsBounds(
        way,
        [
          [-115.151, 36.5],
          [-115.149, 36.502],
        ],
        0,
      ),
    ).toBe(false);
  });
});

// A leg stores which direction it travels its way; deriveLegDirections is what
// supplies that for a caller holding only geometry (the v9→v10 migration, route
// materialization). serviceLaneOnWay then resolves the curb/track lane, and
// buildFeatures draws the service on that lane in lane detail, on the
// centerline in Network.
describe('lane-accurate service rendering (Infrastructure view)', () => {
  const P0: LngLat = [-115.2, 36.1];
  const P1: LngLat = [-115.15, 36.1];
  const P2: LngLat = [-115.1, 36.1];
  const mkWay = (id: string, pts: LngLat[]): Way => ({
    id,
    typeId: 'road',
    points: pts,
    geometry: 'straight',
    grade: 'atGrade',
    profile: { lanes: [] },
  });

  it("deriveLegDirections: exit at the way's last point → forward", () => {
    // wayA [P0,P1] exits into wayB [P1,P2] at wayA's LAST point → forward.
    const fwd = new Map<string, Way>([
      ['a', mkWay('a', [P0, P1])],
      ['b', mkWay('b', [P1, P2])],
    ]);
    expect(deriveLegDirections(fwd, ['a', 'b'])[0]).toBe(true);
  });

  it("deriveLegDirections: exit at the way's first point → backward", () => {
    // wayA points [P1,P0] → it exits into wayB at wayA's FIRST point → backward.
    const bwd = new Map<string, Way>([
      ['a', mkWay('a', [P1, P0])],
      ['b', mkWay('b', [P1, P2])],
    ]);
    expect(deriveLegDirections(bwd, ['a', 'b'])[0]).toBe(false);
  });

  it('deriveLegDirections: a single way has no continuity to read and stays forward', () => {
    const fwd = new Map<string, Way>([
      ['a', mkWay('a', [P0, P1])],
      ['b', mkWay('b', [P1, P2])],
    ]);
    expect(deriveLegDirections(fwd, ['a'])[0]).toBe(true);
  });

  // The case that used to break: two ways meeting LAST-point-to-LAST-point.
  // Stitching them in stored order walks A forward to P1 and then jumps back
  // out to P2 via P1 again, dropping the second way's real extent — the
  // rendered line teleported. routeBetween emits spans in both directions, so
  // this shape is reachable from ordinary routing, not just hand-built
  // fixtures.
  describe('two ways meeting last-point-to-last-point', () => {
    const meetAtLast = new Map<string, Way>([
      ['a', mkWay('a', [P0, P1])],
      ['b', mkWay('b', [P2, P1])],
    ]);
    const lastToLastPattern = {
      id: 'p',
      sections: oneSection(wholeLegs(meetAtLast, ['a', 'b'])),
    };

    it('a way entered at its last point is traversed backward', () => {
      const lastToLast = patternSegments(meetAtLast, lastToLastPattern);
      expect(lastToLast.length).toBe(2);
      expect(lastToLast[0].forward).toBe(true);
      expect(lastToLast[1].forward).toBe(false);
    });

    it('patternPath: ways meeting last-to-last stitch without a teleport', () => {
      const lastToLastPath = patternPath([...meetAtLast.values()], lastToLastPattern);
      expect(
        Math.abs(
          pathLengthMeters(lastToLastPath) - (haversineMeters(P0, P1) + haversineMeters(P1, P2)),
        ),
      ).toBeLessThan(1e-6);
    });

    it('patternPath: the stitched path ends at the far end of the last way', () => {
      const lastToLastPath = patternPath([...meetAtLast.values()], lastToLastPattern);
      expect(lastToLastPath[lastToLastPath.length - 1][0]).toBe(P2[0]);
    });
  });

  // The first way is oriented by where the SECOND way meets it. Deriving it
  // from stored order alone (the old geometry/vehicleLane.ts rule) got this
  // one backward and picked the opposite lane from serviceLane.ts for the
  // same service.
  it('deriveLegDirections: the first way is oriented by where the second one meets it', () => {
    const enterAtLast = new Map<string, Way>([
      ['a', mkWay('a', [P1, P0])],
      ['b', mkWay('b', [P1, P2])],
    ]);
    expect(deriveLegDirections(enterAtLast, ['a', 'b'])[0]).toBe(false);
  });
});
