import { describe, expect, it, beforeEach } from 'vitest';
import {
  legIsWhole,
  legPinnedLane,
  legRange,
  legRunsWithPoints,
  oneSection,
  resolveWayPath,
  serviceLaneOnWay,
  snap,
  stretchLeg,
  wayById,
  wholeLeg,
  wholeLegs,
} from '@transitmapper/core/model/geo';
import { mergeLegs, splitLegs } from '@transitmapper/core/model/patternEdits';
import { defaultLaneFor, defaultProfileFor, travelLanes } from '@transitmapper/core/model/profile';
import { serviceLanePath, wayLaneGeometry } from '@transitmapper/core/geometry/streets';
import { MODES } from '@transitmapper/core/model/catalog';
import type { LngLat, PatternLeg, Way } from '@transitmapper/core/model/system';
import { createEditorStore } from '../../src/editor/store';
import { buildFeatures } from '@transitmapper/core/render/buildFeatures';
import { renderPresentationForViewport } from '@transitmapper/core/render/render-presentation';

/** A leg's covered stretch, for assertions that used to read fromT/toT. */
const legFrom = (l: PatternLeg): number => legRange(l)[0];
const legTo = (l: PatternLeg): number => legRange(l)[1];

/** Whole-way legs in stored point order — the shape a hand-built fixture wants
 *  when direction and extent aren't what it's testing. */
const legsOf = (...wayIds: string[]): PatternLeg[] => wayIds.map((wayId) => wholeLeg(wayId));

/** Throw-guard for a lookup this test's own setup guarantees succeeds — turns
 *  a silent `undefined`/`null` into a clear failure at the point of use
 *  instead of a confusing crash further down the assertion. */
function mustFind<T>(v: T | null | undefined, what: string): T {
  if (v === null || v === undefined) throw new Error(`expected ${what}`);
  return v;
}

// buildFeatures now requires a resolved `presentation` (the renderer boundary
// crosses into real screen-space facts). A close street-level camera also
// makes lane-detail eligible — that used to be an explicit `laneDetail`
// view flag, which no longer exists; it's now derived from the presentation
// itself (see `wantsLaneDetail` in buildFeatures.ts).
const STREET_SERVICE_TEST_RENDER_PRESENTATION = renderPresentationForViewport({
  center: [-115.15, 36.12],
  zoom: 20,
  width: 1_440,
  height: 900,
});

// A leg names a stretch of a way as a fraction of that way's length, so
// splitting or merging the way changes what the fraction means. Getting this
// wrong doesn't crash — it silently slides a service to a different piece of
// the corridor — so the arithmetic is checked directly rather than only
// through the store.
describe("a leg's extent survives the way underneath it being reshaped", () => {
  const whole = (wayId: string, forward = true): PatternLeg =>
    wholeLeg(wayId, forward ? 'withPoints' : 'againstPoints');
  const part = (wayId: string, fromT: number, toT: number, forward = true): PatternLeg =>
    stretchLeg(whole(wayId, forward), fromT, toT);
  const half = 0.5;

  describe('splitting a way', () => {
    it('splitting a way under a leg that covered all of it yields both halves, whole', () => {
      const splitWhole = splitLegs([whole('w')], 'w', 'w2', half);
      expect(splitWhole.length).toBe(2);
      expect(splitWhole[0].wayId).toBe('w');
      expect(splitWhole[1].wayId).toBe('w2');
      expect(splitWhole.every(legIsWhole)).toBe(true);
    });

    it('a leg wholly before the split stays on the first half, rescaled to it', () => {
      const beforeSplit = splitLegs([part('w', 0.1, 0.3)], 'w', 'w2', half);
      expect(beforeSplit.length).toBe(1);
      expect(beforeSplit[0].wayId).toBe('w');
      expect(Math.abs(legFrom(beforeSplit[0]) - 0.2)).toBeLessThan(1e-9);
      expect(Math.abs(legTo(beforeSplit[0]) - 0.6)).toBeLessThan(1e-9);
    });

    it('a leg wholly after the split moves to the second half, rescaled to it', () => {
      const afterSplit = splitLegs([part('w', 0.6, 0.9)], 'w', 'w2', half);
      expect(afterSplit.length).toBe(1);
      expect(afterSplit[0].wayId).toBe('w2');
      expect(Math.abs(legFrom(afterSplit[0]) - 0.2)).toBeLessThan(1e-9);
      expect(Math.abs(legTo(afterSplit[0]) - 0.8)).toBeLessThan(1e-9);
    });

    it('a leg spanning the split becomes two, each rescaled to its own half', () => {
      const straddle = splitLegs([part('w', 0.25, 0.75)], 'w', 'w2', half);
      expect(straddle.length).toBe(2);
      expect(Math.abs(legFrom(straddle[0]) - 0.5)).toBeLessThan(1e-9);
      expect(legTo(straddle[0])).toBe(1);
      expect(legFrom(straddle[1])).toBe(0);
      expect(Math.abs(legTo(straddle[1]) - 0.5)).toBeLessThan(1e-9);
    });

    it('a backward leg spanning the split reaches the second half first', () => {
      const straddleBack = splitLegs([part('w', 0.25, 0.75, false)], 'w', 'w2', half);
      expect(straddleBack.length).toBe(2);
      expect(straddleBack[0].wayId).toBe('w2');
      expect(straddleBack[1].wayId).toBe('w');
    });

    it("a split carries the leg's lane pin onto both halves", () => {
      expect(
        splitLegs(
          [{ ...wholeLeg('w'), lane: { kind: 'pinned', laneId: 'lane-1' } }],
          'w',
          'w2',
          half,
        ).every((l) => legPinnedLane(l) === 'lane-1'),
      ).toBe(true);
    });

    it('a split at a way end has no half to rescale against and leaves the legs alone', () => {
      const untouched = [part('w', 0.2, 0.8)];
      expect(splitLegs(untouched, 'w', 'w2', 0)).toBe(untouched);
      expect(splitLegs(untouched, 'w', 'w2', 1)).toBe(untouched);
    });
  });

  // Merging is the inverse: the store measures where each old position lands
  // on the merged way, and mergeLegs collapses the pair back into one leg.
  describe('merging two ways', () => {
    const seam = 0.4;

    it('merging two ways a pattern rode end-to-end collapses them into one whole leg', () => {
      const merged = mergeLegs([whole('keep'), whole('other')], 'keep', 'other', {
        positionOf: (wayId, t) => (wayId === 'keep' ? t * seam : seam + t * (1 - seam)),
        reversed: () => false,
      });
      expect(merged.length).toBe(1);
      expect(merged[0].wayId).toBe('keep');
      expect(legIsWhole(merged[0])).toBe(true);
    });

    it('a leg that covered part of the absorbed way keeps that stretch on the merged one', () => {
      const partialMerge = mergeLegs([part('other', 0.5, 1)], 'keep', 'other', {
        positionOf: (_wayId, t) => seam + t * (1 - seam),
        reversed: () => false,
      });
      expect(partialMerge.length).toBe(1);
      expect(Math.abs(legFrom(partialMerge[0]) - 0.7)).toBeLessThan(1e-9);
      expect(Math.abs(legTo(partialMerge[0]) - 1)).toBeLessThan(1e-9);
    });

    it('a leg on a way the merge reversed now travels the merged way the other way round', () => {
      const flipped = mergeLegs([whole('other')], 'keep', 'other', {
        positionOf: (_wayId, t) => 1 - t,
        reversed: (wayId) => wayId === 'other',
      });
      expect(flipped.length).toBe(1);
      expect(legRunsWithPoints(flipped[0])).toBe(false);
    });
  });
});

describe('serviceLaneOnWay', () => {
  it('serviceLaneOnWay: a bus resolves the forward-curb travel lane', () => {
    const road = defaultProfileFor('road', 2);
    const roadMap = new Map<string, Way>([
      [
        'w',
        {
          id: 'w',
          typeId: 'road',
          points: [
            [-115.2, 36.1],
            [-115.1, 36.1],
          ],
          geometry: 'straight',
          grade: 'atGrade',
          profile: road,
        },
      ],
    ]);
    expect(
      serviceLaneOnWay({ id: 'p', sections: oneSection(legsOf('w')) }, 0, roadMap, 'bus'),
    ).toBe(defaultLaneFor(road, 'forward', ['bus', 'drive']));
  });

  it('serviceLaneOnWay: an explicit pattern.lanes pin overrides the default', () => {
    const road = defaultProfileFor('road', 2);
    const roadMap = new Map<string, Way>([
      [
        'w',
        {
          id: 'w',
          typeId: 'road',
          points: [
            [-115.2, 36.1],
            [-115.1, 36.1],
          ],
          geometry: 'straight',
          grade: 'atGrade',
          profile: road,
        },
      ],
    ]);
    const pinId = road.lanes[0].id;
    expect(
      serviceLaneOnWay(
        {
          id: 'p',
          sections: oneSection([{ ...wholeLeg('w'), lane: { kind: 'pinned', laneId: pinId } }]),
        },
        0,
        roadMap,
        'bus',
      ),
    ).toBe(pinId);
  });

  it('serviceLaneOnWay: rail resolves a track lane', () => {
    const rail = defaultProfileFor('heavyRail', 2);
    const railMap = new Map<string, Way>([
      [
        'r',
        {
          id: 'r',
          typeId: 'heavyRail',
          points: [
            [-115.2, 36.1],
            [-115.1, 36.1],
          ],
          geometry: 'straight',
          grade: 'atGrade',
          profile: rail,
        },
      ],
    ]);
    const railLane = serviceLaneOnWay(
      { id: 'p', sections: oneSection(legsOf('r')) },
      0,
      railMap,
      'subway',
    );
    expect(travelLanes(rail).find((l) => l.id === railLane)?.kindId).toBe('track');
  });
});

describe('lane-detail rendering follows the resolved curb lane, not the centerline', () => {
  let store: ReturnType<typeof createEditorStore>;
  let svcId: string;
  let filters: { visibleModes: Set<string>; visibleWayTypes: Set<string> };
  let onCenterline: (coords: LngLat[]) => boolean;

  beforeEach(() => {
    store = createEditorStore();
    store.commands.tools.setDraftMode('bus');
    const road = mustFind(store.commands.ways.beginWay('road', 'straight'), 'way id');
    store.commands.ways.addWayPoint(road, [-115.2, 36.12]);
    store.commands.ways.addWayPoint(road, [-115.1, 36.12]);
    store.commands.ways.finishWay();
    store.commands.ways.setWayCapacity(road, 2);
    const sys = store.getState().system;
    svcId = sys.services[0].id;
    const center = resolveWayPath(
      mustFind(
        sys.ways.find((w) => w.id === road),
        'way',
      ),
    );
    onCenterline = (coords: LngLat[]) =>
      coords.length === center.length &&
      coords.every((c, i) => c[0] === center[i][0] && c[1] === center[i][1]);
    filters = { visibleModes: new Set(Object.keys(MODES)), visibleWayTypes: new Set(['road']) };
  });

  it('lane detail: the bus service renders', () => {
    const sys = store.getState().system;
    const infra = buildFeatures(sys, null, [], {
      viewMode: 'infrastructure',
      presentation: STREET_SERVICE_TEST_RENDER_PRESENTATION,
      ...filters,
    });
    const infraFeats = infra.services.features.filter(
      (f) => f.properties?.serviceId === svcId && !f.properties.hitTarget,
    );
    expect(infraFeats.length).toBeGreaterThanOrEqual(1);
  });

  it('lane detail: the service carries no paint offset (geometry IS the lane)', () => {
    const sys = store.getState().system;
    const infra = buildFeatures(sys, null, [], {
      viewMode: 'infrastructure',
      presentation: STREET_SERVICE_TEST_RENDER_PRESENTATION,
      ...filters,
    });
    const infraFeats = infra.services.features.filter(
      (f) => f.properties?.serviceId === svcId && !f.properties.hitTarget,
    );
    expect(infraFeats.every((f) => f.properties?.offset === 0)).toBe(true);
  });

  it('lane detail: the service sits on a curb lane, NOT the way centerline', () => {
    const sys = store.getState().system;
    const infra = buildFeatures(sys, null, [], {
      viewMode: 'infrastructure',
      presentation: STREET_SERVICE_TEST_RENDER_PRESENTATION,
      ...filters,
    });
    const infraFeats = infra.services.features.filter(
      (f) => f.properties?.serviceId === svcId && !f.properties.hitTarget,
    );
    expect(infraFeats.some((f) => !onCenterline(f.geometry.coordinates as LngLat[]))).toBe(true);
  });

  it('network view: the service stays on the way centerline (schematic)', () => {
    const sys = store.getState().system;
    const net = buildFeatures(sys, null, [], {
      viewMode: 'network',
      presentation: STREET_SERVICE_TEST_RENDER_PRESENTATION,
      ...filters,
    });
    const netFeats = net.services.features.filter(
      (f) => f.properties?.serviceId === svcId && !f.properties.hitTarget,
    );
    expect(netFeats.length).toBe(1);
    expect(onCenterline(netFeats[0].geometry.coordinates as LngLat[])).toBe(true);
  });
});

describe('patternLanePath: the polyline a vehicle rides in Infrastructure view', () => {
  // The single-way tests below all ride the same 3-point straight road and
  // differ only in what they assert about the resolved lane path, so the
  // fixture is built once and shared rather than repeated per test.
  const singleWayBusPattern = () => {
    const store = createEditorStore();
    store.commands.tools.setDraftMode('bus');
    const w = mustFind(store.commands.ways.beginWay('road', 'straight'), 'way id');
    store.commands.ways.addWayPoint(w, [-115.2, 36.1]);
    store.commands.ways.addWayPoint(w, [-115.15, 36.1]);
    store.commands.ways.addWayPoint(w, [-115.1, 36.1]);
    store.commands.ways.finishWay();
    const sys = store.getState().system;
    const waysById2 = wayById(sys.ways);
    const way = sys.ways[0];
    const pattern = sys.services[0].path;
    const lanePath = serviceLanePath(pattern, waysById2, 'bus');
    return { waysById2, way, pattern, lanePath };
  };

  it('serviceLanePath resolves a path for a single-way bus pattern', () => {
    const { lanePath } = singleWayBusPattern();
    expect(lanePath).not.toBeNull();
    expect(lanePath?.length).toBeGreaterThanOrEqual(2);
  });

  it("serviceLanePath matches the resolved curb lane's own path", () => {
    const { waysById2, way, pattern, lanePath } = singleWayBusPattern();
    const expectedLaneId = mustFind(serviceLaneOnWay(pattern, 0, waysById2, 'bus'), 'lane id');
    const expectedLane = mustFind(
      wayLaneGeometry(way).lanes.find((l) => l.laneId === expectedLaneId),
      'lane geometry',
    );
    expect(JSON.stringify(lanePath)).toBe(JSON.stringify(expectedLane.path));
  });

  it('serviceLanePath is NOT the way centerline', () => {
    const { way, lanePath } = singleWayBusPattern();
    expect(JSON.stringify(lanePath)).not.toBe(JSON.stringify(resolveWayPath(way)));
  });

  it('serviceLanePath returns null for a lane-less profile', () => {
    const { way, pattern } = singleWayBusPattern();
    // A lane-less profile (no lanes at all) can't resolve — null, not a throw.
    const laneless = { ...way, profile: { lanes: [] } };
    const nullPath = serviceLanePath(pattern, new Map([[way.id, laneless]]), 'bus');
    expect(nullPath).toBeNull();
  });

  it('serviceLanePath stitches a multi-way pattern into one continuous path', () => {
    // Multi-way: two ways sharing a lane-detail-eligible profile stitch into one
    // continuous path (no duplicated junction point, matching patternPath's own
    // stitching convention).
    const store = createEditorStore();
    store.commands.tools.setDraftMode('bus');
    const a = mustFind(store.commands.ways.beginWay('road', 'straight'), 'way id');
    store.commands.ways.addWayPoint(a, [-115.3, 36.2]);
    store.commands.ways.addWayPoint(a, [-115.2, 36.2]);
    store.commands.ways.finishWay();
    const b = mustFind(store.commands.ways.beginWay('road', 'straight'), 'way id');
    store.commands.ways.addWayPoint(b, [-115.2, 36.2]);
    store.commands.ways.addWayPoint(b, [-115.1, 36.2]);
    store.commands.ways.finishWay();
    const multiWaysById = wayById(store.getState().system.ways);
    const multiPattern = { id: 'mp', sections: oneSection(wholeLegs(multiWaysById, [a, b])) };
    const multiPath = serviceLanePath(multiPattern, multiWaysById, 'bus');
    expect(multiPath).not.toBeNull();
    expect(multiPath?.length).toBeGreaterThanOrEqual(3);
  });
});

describe('a station snaps onto a way and follows it when reshaped', () => {
  let store: ReturnType<typeof createEditorStore>;
  let h: string;

  beforeEach(() => {
    store = createEditorStore();
    h = mustFind(store.commands.ways.beginWay('road', 'straight'), 'way id');
    store.commands.ways.addWayPoint(h, [-115.24, 36.1]);
    store.commands.ways.addWayPoint(h, [-115.1, 36.1]);
    store.commands.ways.finishWay();
  });

  it('snap finds the nearby way', () => {
    const s1 = snap(store.getState().system.ways, [-115.17, 36.104], 5000);
    expect(s1).not.toBeNull();
    expect(s1?.wayId).toBe(h);
  });

  it('station follows its way when reshaped', () => {
    const s1 = mustFind(snap(store.getState().system.ways, [-115.17, 36.104], 5000), 'snap');
    const stId = mustFind(store.commands.stops.addStop(s1.coord, { wayId: h, t: s1.t }), 'stop id');
    const beforeLat = mustFind(
      store.getState().system.stops.find((s) => s.id === stId),
      'stop',
    ).coord[1];
    store.commands.ways.moveWayPoint(h, 0, [-115.24, 36.16]);
    store.commands.ways.moveWayPoint(h, 1, [-115.1, 36.16]);
    const afterLat = mustFind(
      store.getState().system.stops.find((s) => s.id === stId),
      'stop',
    ).coord[1];
    expect(afterLat).toBeGreaterThan(beforeLat + 0.02);
  });
});

describe('snap picks the NEAREST of several candidate ways', () => {
  it('snap picks the nearer of two candidate ways', () => {
    const store = createEditorStore();
    const near = mustFind(store.commands.ways.beginWay('lightRail', 'straight'), 'way id');
    store.commands.ways.addWayPoint(near, [-115.101, 36.1]);
    store.commands.ways.addWayPoint(near, [-115.101, 36.2]);
    store.commands.ways.finishWay();
    const far = mustFind(store.commands.ways.beginWay('lightRail', 'straight'), 'way id');
    store.commands.ways.addWayPoint(far, [-115.15, 36.1]);
    store.commands.ways.addWayPoint(far, [-115.15, 36.2]);
    store.commands.ways.finishWay();
    const best = snap(store.getState().system.ways, [-115.1, 36.15], 50000);
    expect(best?.wayId).toBe(near);
  });
});
