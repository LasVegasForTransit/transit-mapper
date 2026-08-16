import { describe, expect, it, beforeEach } from 'vitest';
import {
  legPinnedLane,
  patternLegs,
  patternWayIds,
  serviceWayIds,
} from '@transitmapper/core/model/geo';
import { parseSystem } from '@transitmapper/core/model/serialize';
import { MODES, modesForWayType } from '@transitmapper/core/model/catalog';
import { mapSectionLegs } from '@transitmapper/core/model/patternEdits';
import {
  buildProfile,
  defaultLaneFor,
  defaultProfileFor,
  directionalLanes,
  makeOneWay,
  travelLanes,
} from '@transitmapper/core/model/profile';
import { anchorOnWay } from '@transitmapper/core/model/routeGraph';
import { createEditorStore } from '../../src/editor/store';

/** Throw-guard for a lookup this test's own setup guarantees succeeds — turns
 *  a silent `undefined`/`null` into a clear failure at the point of use
 *  instead of a confusing crash further down the assertion. */
function mustFind<T>(v: T | null | undefined, what: string): T {
  if (v === null || v === undefined) throw new Error(`expected ${what}`);
  return v;
}

describe('drawing a way creates a way + one service', () => {
  let store: ReturnType<typeof createEditorStore>;
  let a: string;

  beforeEach(() => {
    store = createEditorStore();
    a = store.getState().beginWay('lightRail', 'straight');
    store.getState().addWayPoint(a, [-115.24, 36.1]);
    store.getState().addWayPoint(a, [-115.17, 36.16]);
    store.getState().addWayPoint(a, [-115.1, 36.1]);
    store.getState().finishWay();
  });

  it('way defined by 3 control points', () => {
    const sys = store.getState().system;
    expect(
      mustFind(
        sys.ways.find((w) => w.id === a),
        'way',
      ).points.length,
    ).toBe(3);
  });

  it('drawing a way creates exactly one service', () => {
    expect(store.getState().system.services.length).toBe(1);
  });

  it('the service runs over that way', () => {
    const sys = store.getState().system;
    expect(patternWayIds(sys.services[0].patterns[0])[0]).toBe(a);
  });

  describe('multiple services share one way (the service/infra split)', () => {
    const servicesOnWay = (store: ReturnType<typeof createEditorStore>, wid: string) =>
      store.getState().system.services.filter((s) => serviceWayIds(s).includes(wid));

    it('a way can carry multiple services', () => {
      store.getState().addServiceToWay(a);
      expect(servicesOnWay(store, a).length).toBe(2);
    });

    it('added service is distinct', () => {
      const svc2 = store.getState().addServiceToWay(a);
      expect(svc2).not.toBe(store.getState().system.services[0].id);
    });
  });
});

describe('bare infrastructure: bike ways carry no service (catalog-driven, no default mode)', () => {
  let store: ReturnType<typeof createEditorStore>;

  beforeEach(() => {
    store = createEditorStore();
  });

  it('bike way type has no compatible service modes', () => {
    expect(modesForWayType('bike').length).toBe(0);
  });

  it('drawing a bike way creates no service', () => {
    const bikeWay = store.getState().beginWay('bike', 'straight');
    store.getState().addWayPoint(bikeWay, [-115.2, 36.1]);
    store.getState().addWayPoint(bikeWay, [-115.1, 36.1]);
    store.getState().finishWay();
    expect(store.getState().system.services.length).toBe(0);
  });

  it('addServiceToWay on a bike way returns null', () => {
    const bikeWay = store.getState().beginWay('bike', 'straight');
    store.getState().addWayPoint(bikeWay, [-115.2, 36.1]);
    store.getState().addWayPoint(bikeWay, [-115.1, 36.1]);
    store.getState().finishWay();
    expect(store.getState().addServiceToWay(bikeWay)).toBeNull();
  });
});

describe('roads draw exactly like every other way (this is the fix: roads used to not drag)', () => {
  let store: ReturnType<typeof createEditorStore>;
  let road: string;

  beforeEach(() => {
    store = createEditorStore();
    road = store.getState().beginWay('road', 'straight');
    store.getState().addWayPoint(road, [-115.2, 36.1]);
    store.getState().addWayPoint(road, [-115.1, 36.2]);
    store.getState().finishWay();
  });

  it('road way created with 2 points via the same beginWay/addWayPoint path', () => {
    expect(store.getState().system.ways[0].points.length).toBe(2);
  });

  // With the draft's service toggle on (the default, and always the case in
  // Network view's mode-first drawing) a road still gets its line; the
  // Infrastructure view's Way tool turns the toggle OFF for roads so streets
  // draw as bare context — see the "bare infrastructure toggle" block below.
  it('drawing a road with service enabled creates a default service (bus/BRT)', () => {
    const servicesOnWay = store
      .getState()
      .system.services.filter((s) => serviceWayIds(s).includes(road));
    expect(servicesOnWay.length).toBe(1);
  });

  // Not 'arterial' (major): a fresh sketch road shouldn't force a viaduct the
  // moment a rail line crosses it — see autoElevateAcrossMajorRoad's own
  // caller in formCrossingJunctions and catalog.ts's road.defaultClassId.
  it('road defaults to the collector class, not a major one', () => {
    expect(store.getState().system.ways[0].classId).toBe('collector');
  });
});

describe('heavy rail and light rail are physically incompatible track standards', () => {
  const heavy = modesForWayType('heavyRail').map((m) => m.id);
  const light = modesForWayType('lightRail').map((m) => m.id);

  it('subway/commuter rail ride heavy rail only', () => {
    expect(heavy.includes('subway')).toBe(true);
    expect(heavy.includes('commuterRail')).toBe(true);
  });

  it('heavy rail never carries light-rail-standard modes', () => {
    expect(heavy.includes('lightRail')).toBe(false);
    expect(heavy.includes('tram')).toBe(false);
  });

  it('light rail/tram never rides heavy rail', () => {
    expect(light.includes('subway')).toBe(false);
    expect(light.includes('commuterRail')).toBe(false);
  });

  it('monorail is a third, separate standard', () => {
    expect(modesForWayType('monorail').every((m) => m.id === 'monorail')).toBe(true);
  });
});

describe('a tram can street-run on a road way or use dedicated light-rail track', () => {
  it('tram is compatible with both dedicated light rail and street-running road', () => {
    const tramWayTypes = new Set(MODES.tram.wayTypeIds);
    expect(tramWayTypes.has('lightRail')).toBe(true);
    expect(tramWayTypes.has('road')).toBe(true);
  });
});

describe("defaultLaneFor: a service's default lane on a way (curb / bus lane / track)", () => {
  it('defaultLaneFor forward = rightmost (last) forward directional lane', () => {
    const twoWay = defaultProfileFor('road', 2);
    const dir = directionalLanes(twoWay);
    const lastFwd = [...dir]
      .reverse()
      .find((l) => l.direction === 'forward' || l.direction === 'both');
    const fwd = defaultLaneFor(twoWay, 'forward');
    expect(fwd).toBe(lastFwd?.id);
  });

  it('defaultLaneFor backward = rightmost (first) backward directional lane', () => {
    const twoWay = defaultProfileFor('road', 2);
    const dir = directionalLanes(twoWay);
    const firstBwd = dir.find((l) => l.direction === 'backward' || l.direction === 'both');
    const bwd = defaultLaneFor(twoWay, 'backward');
    expect(bwd).toBe(firstBwd?.id);
  });

  it('forward and backward defaults differ on a two-way road', () => {
    const twoWay = defaultProfileFor('road', 2);
    const fwd = defaultLaneFor(twoWay, 'forward');
    const bwd = defaultLaneFor(twoWay, 'backward');
    expect(fwd).toBeTruthy();
    expect(fwd).not.toBe(bwd);
  });

  it('one-way carriageway resolves its forward lane', () => {
    const oneWay = makeOneWay(defaultProfileFor('road', 2), 'forward');
    expect(!!defaultLaneFor(oneWay, 'forward')).toBe(true);
  });

  it("defaultLaneFor prefers a bus lane for buses (preferKindIds=['bus','drive'])", () => {
    const withBus = buildProfile([
      { kindId: 'drive', direction: 'forward' },
      { kindId: 'bus', direction: 'forward' },
    ]);
    const busId = mustFind(
      withBus.lanes.find((l) => l.kindId === 'bus'),
      'bus lane',
    ).id;
    expect(defaultLaneFor(withBus, 'forward', ['bus', 'drive'])).toBe(busId);
  });

  it('without a bus preference it takes the rightmost drive lane', () => {
    const withBus = buildProfile([
      { kindId: 'drive', direction: 'forward' },
      { kindId: 'bus', direction: 'forward' },
    ]);
    const driveId = mustFind(
      withBus.lanes.find((l) => l.kindId === 'drive'),
      'drive lane',
    ).id;
    expect(defaultLaneFor(withBus, 'forward', ['drive'])).toBe(driveId);
  });

  it('rail forward/backward resolve to different tracks', () => {
    const rail = defaultProfileFor('heavyRail', 2);
    const railFwd = defaultLaneFor(rail, 'forward', ['track']);
    const railBwd = defaultLaneFor(rail, 'backward', ['track']);
    expect(railFwd).toBeTruthy();
    expect(railBwd).toBeTruthy();
    expect(railFwd).not.toBe(railBwd);
  });

  it('rail default lane is a track', () => {
    const rail = defaultProfileFor('heavyRail', 2);
    const railFwd = defaultLaneFor(rail, 'forward', ['track']);
    expect(travelLanes(rail).find((l) => l.id === railFwd)?.kindId).toBe('track');
  });
});

describe('Pattern.lanes round-trips through serialize/parse', () => {
  let store: ReturnType<typeof createEditorStore>;
  let w: string;
  let laneId: string;

  beforeEach(() => {
    store = createEditorStore();
    w = store.getState().beginWay('road', 'straight');
    store.getState().addWayPoint(w, [-115.2, 36.12]);
    store.getState().addWayPoint(w, [-115.1, 36.12]);
    store.getState().finishWay();
    laneId = mustFind(
      defaultLaneFor(store.getState().system.ways[0].profile, 'forward'),
      'lane id',
    );
  });

  it("a leg's lane pin survives a serialize/parse round-trip", () => {
    const svc = store.getState().system.services[0];
    // Hand-build a leg lane pin and round-trip the whole system.
    const withLanes = {
      ...store.getState().system,
      services: [
        {
          ...svc,
          patterns: svc.patterns.map((p) => ({
            ...p,
            sections: mapSectionLegs(p.sections, (legs) =>
              legs.map((l) =>
                l.wayId === w ? { ...l, lane: { kind: 'pinned' as const, laneId } } : l,
              ),
            ),
          })),
        },
      ],
    };
    const reparsed = parseSystem(JSON.parse(JSON.stringify(withLanes)));
    expect(legPinnedLane(patternLegs(reparsed.services[0].patterns[0])[0])).toBe(laneId);
  });

  // v9 kept lane pins in a wayId-keyed map on the pattern; they migrate onto
  // the leg for the way they named, and a pin naming a way the pattern doesn't
  // run over has nowhere to land and is dropped.
  // Shared by both v9-migration cases below: builds the v9-shaped pattern
  // (lane map keyed by wayId, including a way the pattern doesn't run over)
  // and round-trips it through parseSystem.
  function migrateV9LaneMap(
    store: ReturnType<typeof createEditorStore>,
    w: string,
    laneId: string,
  ) {
    const svc = store.getState().system.services[0];
    const v9Shape = {
      ...store.getState().system,
      version: 9,
      services: [
        {
          ...svc,
          patterns: svc.patterns.map((p) => ({
            id: p.id,
            wayIds: patternLegs(p).map((l) => l.wayId),
            lanes: { [w]: laneId, 'ghost-way': laneId },
          })),
        },
      ],
    };
    return parseSystem(JSON.parse(JSON.stringify(v9Shape)));
  }

  it("a v9 pattern's lane map migrates onto the leg for that way", () => {
    const fromV9 = migrateV9LaneMap(store, w, laneId);
    expect(legPinnedLane(patternLegs(fromV9.services[0].patterns[0])[0])).toBe(laneId);
  });

  it('a v9 lane pin naming a way the pattern never runs over is dropped', () => {
    const fromV9 = migrateV9LaneMap(store, w, laneId);
    expect(patternLegs(fromV9.services[0].patterns[0]).every((l) => l.wayId !== 'ghost-way')).toBe(
      true,
    );
  });
});

// The Network Way tool routes a new service over a nearby corridor instead of
// laying a parallel way (Phase A share-by-default). Exercised here through the
// same route-draft actions the pointer layer calls (startRouteDraft →
// extendRouteDraft → commitRouteDraft).
describe('drawing a service along an existing way SHARES that infrastructure', () => {
  let store: ReturnType<typeof createEditorStore>;

  beforeEach(() => {
    store = createEditorStore();
    store.getState().setDraftMode('bus');
  });

  // Shared by all three cases below: draws a road and resolves the pair of
  // interior anchors (mid-corridor, as a real click would land) so the route
  // genuinely traverses the existing way rather than a degenerate end sliver.
  function drawRoadWithAnchors(store: ReturnType<typeof createEditorStore>) {
    const road = store.getState().beginWay('road', 'straight');
    store.getState().addWayPoint(road, [-115.3, 36.1]);
    store.getState().addWayPoint(road, [-115.2, 36.1]);
    store.getState().addWayPoint(road, [-115.1, 36.1]);
    store.getState().finishWay();
    const w = mustFind(
      store.getState().system.ways.find((x) => x.id === road),
      'way',
    );
    const from = mustFind(anchorOnWay(w, [-115.28, 36.1]), 'anchor');
    const to = mustFind(anchorOnWay(w, [-115.12, 36.1]), 'anchor');
    return { road, w, from, to };
  }

  it('route-draft extends along the existing way', () => {
    const { from, to } = drawRoadWithAnchors(store);
    store.getState().startRouteDraft(from);
    const extended = store.getState().extendRouteDraft(to);
    expect(extended).toBe(true);
  });

  it('committing a routed draft adds a second service', () => {
    const { from, to } = drawRoadWithAnchors(store);
    store.getState().startRouteDraft(from);
    store.getState().extendRouteDraft(to);
    const newId = store.getState().commitRouteDraft();
    expect(newId).not.toBeNull();
    expect(store.getState().system.services.length).toBe(2);
  });

  it('a service drawn along an existing corridor SHARES its infrastructure', () => {
    const { from, to } = drawRoadWithAnchors(store);
    const s1Id = store.getState().system.services[0].id;
    store.getState().startRouteDraft(from);
    store.getState().extendRouteDraft(to);
    const newId = store.getState().commitRouteDraft();
    // Re-fetch BOTH services from the post-commit store — materialization may
    // have split the shared road and rebound the original service's way ids.
    const s1 = mustFind(
      store.getState().system.services.find((sv) => sv.id === s1Id),
      'service',
    );
    const s2 = mustFind(
      store.getState().system.services.find((sv) => sv.id === newId),
      'service',
    );
    const shared = serviceWayIds(s1).some((wid) => serviceWayIds(s2).includes(wid));
    expect(shared).toBe(true);
  });
});
