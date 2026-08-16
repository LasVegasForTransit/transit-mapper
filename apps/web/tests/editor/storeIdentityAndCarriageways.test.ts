// Converted from apps/web/tests/verify.test.ts lines 7011-7460 (10 sections).
import { beforeEach, describe, expect, it } from 'vitest';
import { createEditorStore } from '../../src/editor/store';
import { getComponent, laneRefKey } from '@transitmapper/core/model/components';
import { directionalLanes, isOneWay } from '@transitmapper/core/model/profile';
import { patternLegs, primaryAnchor } from '@transitmapper/core/model/geo';
import { osmElementsToNetwork, type OsmWayElement } from '@transitmapper/core/model/import';

describe('vehicle catalogs: store actions', () => {
  let store: ReturnType<typeof createEditorStore>;
  let wayId: string;
  let serviceId: string;

  beforeEach(() => {
    store = createEditorStore();
    wayId = store.getState().beginWay('road', 'straight');
    store.getState().addWayPoint(wayId, [-115.2, 36.1]);
    store.getState().addWayPoint(wayId, [-115.19, 36.1]);
    store.getState().finishWay();
    store.getState().setDraftMode('bus');
    serviceId = store.getState().addServiceToWay(wayId)!;
  });

  it("setVehicleKinds replaces the system's whole list", () => {
    store
      .getState()
      .setVehicleKinds([{ id: 'vk1', modeId: 'bus', label: 'Test bus', widthM: 2.6, lengthM: 12 }]);
    expect(store.getState().system.vehicleKinds.length).toBe(1);
  });

  it('setServiceVehicleKind assigns a kind to a service', () => {
    store
      .getState()
      .setVehicleKinds([{ id: 'vk1', modeId: 'bus', label: 'Test bus', widthM: 2.6, lengthM: 12 }]);
    store.getState().setServiceVehicleKind(serviceId, 'vk1');
    expect(store.getState().system.services.find((s) => s.id === serviceId)?.vehicleKindId).toBe(
      'vk1',
    );
  });

  it('setServiceVehicleKind(undefined) clears the assignment', () => {
    store
      .getState()
      .setVehicleKinds([{ id: 'vk1', modeId: 'bus', label: 'Test bus', widthM: 2.6, lengthM: 12 }]);
    store.getState().setServiceVehicleKind(serviceId, 'vk1');
    store.getState().setServiceVehicleKind(serviceId, undefined);
    expect(
      store.getState().system.services.find((s) => s.id === serviceId)?.vehicleKindId,
    ).toBeUndefined();
  });
});

describe('store: profile editing, presets', () => {
  let store: ReturnType<typeof createEditorStore>;
  let r: string;

  beforeEach(() => {
    store = createEditorStore();
    r = store.getState().beginWay('road', 'straight');
    store.getState().addWayPoint(r, [-115.2, 36.1]);
    store.getState().addWayPoint(r, [-115.1, 36.1]);
    store.getState().finishWay();
    store.getState().applyProfilePreset(r, 'roadBoulevard');
  });

  it("applyProfilePreset installs the preset's lanes", () => {
    const way = store.getState().system.ways.find((w) => w.id === r)!;
    expect(way.profile.lanes.some((l) => l.kindId === 'median')).toBe(true);
    expect(way.profile.lanes.some((l) => l.kindId === 'bike')).toBe(true);
  });

  it("applyProfilePreset takes the preset's class", () => {
    const way = store.getState().system.ways.find((w) => w.id === r)!;
    expect(way.classId).toBe('arterial');
  });

  it('setWayProfile replaces the cross-section', () => {
    const way = store.getState().system.ways.find((w) => w.id === r)!;
    const custom = {
      lanes: way.profile.lanes.map((l) => (l.kindId === 'drive' ? { ...l, widthM: 3.05 } : l)),
    };
    store.getState().setWayProfile(r, custom);
    expect(
      store
        .getState()
        .system.ways.find((w) => w.id === r)!
        .profile.lanes.every((l) => l.kindId !== 'drive' || l.widthM === 3.05),
    ).toBe(true);
  });
});

describe('store: shared identity (NamedWay)', () => {
  let store: ReturnType<typeof createEditorStore>;
  let a: string;
  let b: string;

  beforeEach(() => {
    store = createEditorStore();
    a = store.getState().beginWay('road', 'straight');
    store.getState().addWayPoint(a, [-115.2, 36.1]);
    store.getState().addWayPoint(a, [-115.1, 36.1]);
    store.getState().finishWay();
    b = store.getState().beginWay('road', 'straight');
    store.getState().addWayPoint(b, [-115.2, 36.11]);
    store.getState().addWayPoint(b, [-115.1, 36.11]);
    store.getState().finishWay();
  });

  it('naming a way creates a shared identity', () => {
    store.getState().nameWay(a, 'Decatur Avenue');
    expect(
      store
        .getState()
        .system.namedWays.some((n) => n.name === 'Decatur Avenue' && n.wayIds.includes(a)),
    ).toBe(true);
  });

  it('naming a second way with the same name joins the identity', () => {
    store.getState().nameWay(a, 'Decatur Avenue');
    store.getState().nameWay(b, 'Decatur Avenue');
    expect(
      store.getState().system.namedWays.filter((n) => n.name === 'Decatur Avenue').length,
    ).toBe(1);
    expect(store.getState().system.namedWays[0].wayIds.length).toBe(2);
  });

  it('renaming through one member renames the shared identity', () => {
    store.getState().nameWay(a, 'Decatur Avenue');
    store.getState().nameWay(b, 'Decatur Avenue');
    store.getState().nameWay(a, 'Decatur Ave');
    expect(store.getState().system.namedWays[0].name).toBe('Decatur Ave');
    expect(store.getState().system.namedWays[0].wayIds.length).toBe(2);
  });

  it('an empty name removes the way from its identity', () => {
    store.getState().nameWay(a, 'Decatur Avenue');
    store.getState().nameWay(b, 'Decatur Avenue');
    store.getState().nameWay(a, 'Decatur Ave');
    store.getState().nameWay(b, '');
    expect(store.getState().system.namedWays[0]?.wayIds.includes(b)).toBe(false);
  });

  it('deleting the last member deletes the identity', () => {
    store.getState().nameWay(a, 'Decatur Avenue');
    store.getState().nameWay(b, 'Decatur Avenue');
    store.getState().nameWay(a, 'Decatur Ave');
    store.getState().nameWay(b, '');
    store.getState().deleteWay(a);
    expect(store.getState().system.namedWays.length).toBe(0);
  });
});

describe('store: identity survives splitting (a street cut by an intersection)', () => {
  it('both split halves stay under the one identity', () => {
    const store = createEditorStore();
    const a = store.getState().beginWay('road', 'straight');
    store.getState().addWayPoint(a, [-115.2, 36.1]);
    store.getState().addWayPoint(a, [-115.15, 36.1]);
    store.getState().addWayPoint(a, [-115.1, 36.1]);
    store.getState().finishWay();
    store.getState().nameWay(a, 'Charleston Blvd');
    store.getState().splitWayAt(a, 1);
    const nw = store.getState().system.namedWays[0];
    expect(nw.wayIds.length).toBe(2);
    expect(store.getState().system.ways.every((w) => nw.wayIds.includes(w.id))).toBe(true);
  });
});

describe('store: mergeWays (inverse of split)', () => {
  describe('merging two split halves', () => {
    let store: ReturnType<typeof createEditorStore>;
    let a: string;

    beforeEach(() => {
      store = createEditorStore();
      a = store.getState().beginWay('road', 'straight');
      store.getState().addWayPoint(a, [-115.2, 36.1]);
      store.getState().addWayPoint(a, [-115.15, 36.1]);
      store.getState().addWayPoint(a, [-115.1, 36.1]);
      store.getState().finishWay();
      store.getState().splitWayAt(a, 1);
    });

    it('split made two ways', () => {
      expect(store.getState().system.ways.length).toBe(2);
    });

    it('mergeWays restores one way', () => {
      const halves = store.getState().system.ways.map((w) => w.id);
      store.getState().mergeWays(halves[0], halves[1]);
      const merged = store.getState().system;
      expect(merged.ways.length).toBe(1);
      expect(merged.ways[0].id).toBe(halves[0]);
    });

    it('merged way has the full point run', () => {
      const halves = store.getState().system.ways.map((w) => w.id);
      store.getState().mergeWays(halves[0], halves[1]);
      expect(store.getState().system.ways[0].points.length).toBe(3);
    });

    it('the seam node dissolves (no third way met there)', () => {
      const halves = store.getState().system.ways.map((w) => w.id);
      store.getState().mergeWays(halves[0], halves[1]);
      expect(store.getState().system.nodes.length).toBe(0);
    });

    it('the riding service runs over just the merged way', () => {
      const halves = store.getState().system.ways.map((w) => w.id);
      store.getState().mergeWays(halves[0], halves[1]);
      const merged = store.getState().system;
      expect(
        merged.services.every((sv) =>
          sv.patterns.every(
            (p) => patternLegs(p).length === 1 && patternLegs(p)[0].wayId === halves[0],
          ),
        ),
      ).toBe(true);
    });
  });

  it("mergeWays refuses ways that don't share an endpoint", () => {
    const store = createEditorStore();
    const x = store.getState().beginWay('road', 'straight');
    store.getState().addWayPoint(x, [-115.2, 36.1]);
    store.getState().addWayPoint(x, [-115.18, 36.1]);
    store.getState().finishWay();
    const y = store.getState().beginWay('road', 'straight');
    store.getState().addWayPoint(y, [-115.1, 36.2]);
    store.getState().addWayPoint(y, [-115.08, 36.2]);
    store.getState().finishWay();
    store.getState().mergeWays(x, y);
    expect(store.getState().system.ways.length).toBe(2);
  });
});

describe('store: separate/combine carriageways', () => {
  let store: ReturnType<typeof createEditorStore>;
  let r: string;

  beforeEach(() => {
    store = createEditorStore();
    r = store.getState().beginWay('road', 'straight');
    store.getState().addWayPoint(r, [-115.2, 36.1]);
    store.getState().addWayPoint(r, [-115.1, 36.1]);
    store.getState().finishWay();
    store.getState().applyProfilePreset(r, 'roadArterial4');
  });

  it('separateCarriageways returns the new carriageway', () => {
    const newId = store.getState().separateCarriageways(r);
    expect(newId).toBeTruthy();
    expect(store.getState().system.ways.length).toBe(2);
  });

  it('original way becomes the one-way forward carriageway', () => {
    store.getState().separateCarriageways(r);
    const fwd = store.getState().system.ways.find((w) => w.id === r)!;
    expect(isOneWay(fwd.profile)).toBe(true);
    expect(directionalLanes(fwd.profile).every((l) => l.direction === 'forward')).toBe(true);
  });

  it('new way is the one-way backward carriageway', () => {
    const newId = store.getState().separateCarriageways(r)!;
    const back = store.getState().system.ways.find((w) => w.id === newId)!;
    expect(directionalLanes(back.profile).every((l) => l.direction === 'backward')).toBe(true);
  });

  it('the carriageways are physically offset', () => {
    const newId = store.getState().separateCarriageways(r)!;
    const fwd = store.getState().system.ways.find((w) => w.id === r)!;
    const back = store.getState().system.ways.find((w) => w.id === newId)!;
    expect(Math.abs(back.points[0][1] - fwd.points[0][1])).toBeGreaterThan(1e-6);
  });

  it('both carriageways share one identity', () => {
    const newId = store.getState().separateCarriageways(r)!;
    const nw = store.getState().system.namedWays.find((n) => n.wayIds.includes(r));
    expect(nw).toBeDefined();
    expect(nw!.wayIds.includes(newId)).toBe(true);
  });

  it('a one-way way refuses to separate', () => {
    store.getState().separateCarriageways(r);
    expect(store.getState().separateCarriageways(r)).toBeNull();
  });

  it('separateCarriageways captures a Median component keyed by the NamedWay', () => {
    store.getState().separateCarriageways(r);
    const nw = store.getState().system.namedWays.find((n) => n.wayIds.includes(r))!;
    const median = getComponent(store.getState().system.medians, nw.id);
    expect(median).toBeDefined();
    expect(median!.widthM).toBeGreaterThan(0);
  });

  it('setMedianWidth overrides the captured width', () => {
    store.getState().separateCarriageways(r);
    const nw = store.getState().system.namedWays.find((n) => n.wayIds.includes(r))!;
    store.getState().setMedianWidth(nw.id, 6);
    expect(getComponent(store.getState().system.medians, nw.id)?.widthM).toBe(6);
  });

  it('combineCarriageways restores a single way', () => {
    store.getState().separateCarriageways(r);
    const nw = store.getState().system.namedWays.find((n) => n.wayIds.includes(r))!;
    store.getState().combineCarriageways(nw.id);
    const combined = store.getState().system;
    expect(combined.ways.length).toBe(1);
    expect(combined.ways[0].id).toBe(r);
  });

  it('combined way is two-way again', () => {
    store.getState().separateCarriageways(r);
    const nw = store.getState().system.namedWays.find((n) => n.wayIds.includes(r))!;
    store.getState().combineCarriageways(nw.id);
    expect(isOneWay(store.getState().system.ways[0].profile)).toBe(false);
  });

  it('combined profile gained a median between carriageways', () => {
    store.getState().separateCarriageways(r);
    const nw = store.getState().system.namedWays.find((n) => n.wayIds.includes(r))!;
    store.getState().combineCarriageways(nw.id);
    expect(store.getState().system.ways[0].profile.lanes.some((l) => l.kindId === 'median')).toBe(
      true,
    );
  });

  it('combining restores the edited median width, not a generic default', () => {
    store.getState().separateCarriageways(r);
    const nw = store.getState().system.namedWays.find((n) => n.wayIds.includes(r))!;
    store.getState().setMedianWidth(nw.id, 6);
    store.getState().combineCarriageways(nw.id);
    expect(
      store.getState().system.ways[0].profile.lanes.find((l) => l.kindId === 'median')?.widthM,
    ).toBe(6);
  });
});

describe('separating carriageways must not sever the network', () => {
  // The new offset backward carriageway starts with zero junction refs, so it
  // has to be re-run through the same crossing-junction pass a finished draw
  // gets.
  let store: ReturnType<typeof createEditorStore>;
  let trunk: string;
  let cross: string;

  beforeEach(() => {
    store = createEditorStore();
    trunk = store.getState().beginWay('road', 'straight');
    store.getState().addWayPoint(trunk, [-115.2, 36.1]);
    store.getState().addWayPoint(trunk, [-115.1, 36.1]);
    store.getState().finishWay();
    store.getState().applyProfilePreset(trunk, 'roadArterial4');
    cross = store.getState().beginWay('road', 'straight');
    store.getState().addWayPoint(cross, [-115.15, 36.15]);
    store.getState().addWayPoint(cross, [-115.15, 36.05]);
    store.getState().finishWay();
  });

  it('the trunk and cross street share a junction before separating', () => {
    expect(
      store.getState().system.nodes.some((n) => {
        const wayIds = new Set(n.refs.map((ref) => ref.wayId));
        return wayIds.has(trunk) && wayIds.has(cross);
      }),
    ).toBe(true);
  });

  it('separating carriageways preserves junctions with crossing streets', () => {
    const backId = store.getState().separateCarriageways(trunk)!;
    const sys = store.getState().system;
    expect(
      sys.nodes.some((n) => {
        const wayIds = new Set(n.refs.map((ref) => ref.wayId));
        return wayIds.has(backId) && [...wayIds].some((id) => id !== trunk && id !== backId);
      }),
    ).toBe(true);
  });
});

describe("combining carriageways carries the discarded half's anchors across", () => {
  // The realistic shape: a divided street imported from OSM as two one-way
  // carriageways under one name, with a cross street meeting one of them.
  // (Drawing a crossing instead would split the carriageway, which is its own
  // bug — see the identity-member checks below.)
  const divided: OsmWayElement[] = [
    {
      type: 'way',
      id: 1,
      tags: { highway: 'primary', name: 'Grand Boulevard', oneway: 'yes', lanes: '2' },
      nodes: [10, 11, 12],
      geometry: [
        { lat: 36.1, lon: -115.2 },
        { lat: 36.1, lon: -115.15 },
        { lat: 36.1, lon: -115.1 },
      ],
    },
    {
      type: 'way',
      id: 2,
      tags: { highway: 'primary', name: 'Grand Boulevard', oneway: '-1', lanes: '2' },
      nodes: [20, 21, 22],
      geometry: [
        { lat: 36.1002, lon: -115.2 },
        { lat: 36.1002, lon: -115.15 },
        { lat: 36.1002, lon: -115.1 },
      ],
    },
    {
      type: 'way',
      id: 3,
      tags: { highway: 'residential', name: 'Cross Street' },
      nodes: [21, 30],
      geometry: [
        { lat: 36.1002, lon: -115.15 },
        { lat: 36.11, lon: -115.15 },
      ],
    },
  ];

  let store: ReturnType<typeof createEditorStore>;

  beforeEach(() => {
    store = createEditorStore();
    store.getState().importWays(osmElementsToNetwork(divided));
  });

  it('the divided street imports as one identity of two carriageways', () => {
    const nw = store.getState().system.namedWays.find((n) => n.name === 'Grand Boulevard')!;
    expect(nw.wayIds.length).toBe(2);
  });

  it('both carriageways import one-way', () => {
    const sys = store.getState().system;
    const carriageways = sys.ways.filter((w) => w.source === 'osm:1' || w.source === 'osm:2');
    expect(carriageways.every((w) => isOneWay(w.profile))).toBe(true);
  });

  it('the cross street shares a junction with one carriageway', () => {
    expect(store.getState().system.nodes.length).toBe(1);
  });

  describe('after combining', () => {
    let stId: string;
    let survivorId: string;
    let nodesBefore: number;
    let discardedId: string;
    let crossId: string;

    beforeEach(() => {
      const sys = store.getState().system;
      const carriageways = sys.ways.filter((w) => w.source === 'osm:1' || w.source === 'osm:2');
      const cross = sys.ways.find((w) => w.source === 'osm:3')!;
      crossId = cross.id;
      const nw = sys.namedWays.find((n) => n.name === 'Grand Boulevard')!;
      nodesBefore = sys.nodes.length;
      const discarded = carriageways.find(
        (w) =>
          !isOneWay(w.profile) ||
          directionalLanes(w.profile).every((l) => l.direction === 'backward'),
      )!;
      discardedId = discarded.id;
      stId = store.getState().addStation(discarded.points[0], { wayId: discarded.id, t: 0 });
      store.getState().combineCarriageways(nw.id);
      survivorId = store.getState().system.ways.find((w) => w.id !== crossId)!.id;
    });

    it('combining leaves one carriageway', () => {
      const after = store.getState().system;
      expect(after.ways.filter((w) => w.id !== crossId).length).toBe(1);
    });

    it('combining keeps a station anchored to the discarded carriageway', () => {
      expect(store.getState().system.stations.length).toBe(1);
    });

    it('and re-anchors it onto the surviving centerline', () => {
      const after = store.getState().system;
      expect(primaryAnchor(after.stations.find((st) => st.id === stId)!)?.wayId).toBe(survivorId);
    });

    it('combining keeps the junction the cross street made', () => {
      expect(store.getState().system.nodes.length).toBe(nodesBefore);
    });

    it('and re-points its ref onto the surviving way', () => {
      const after = store.getState().system;
      expect(after.nodes.every((n) => n.refs.every((ref) => ref.wayId !== discardedId))).toBe(true);
    });

    it('so the cross street is still joined to the street', () => {
      const after = store.getState().system;
      expect(after.nodes.some((n) => n.refs.some((ref) => ref.wayId === crossId))).toBe(true);
    });

    it('the survivor is two-way again', () => {
      const after = store.getState().system;
      const survivor = after.ways.find((w) => w.id === survivorId)!;
      expect(isOneWay(survivor.profile)).toBe(false);
    });
  });
});

describe("lane-keyed components don't outlive their lanes", () => {
  describe('turn restrictions are dropped when their way is deleted', () => {
    let store: ReturnType<typeof createEditorStore>;
    let w: string;

    beforeEach(() => {
      store = createEditorStore();
      w = store.getState().beginWay('road', 'straight');
      store.getState().addWayPoint(w, [-115.2, 36.1]);
      store.getState().addWayPoint(w, [-115.1, 36.1]);
      store.getState().finishWay();
      const laneId = store
        .getState()
        .system.ways.find((x) => x.id === w)!
        .profile.lanes.find((l) => l.kindId === 'drive')!.id;
      store.getState().setTurnRestriction(w, laneId, []);
    });

    it('a turn restriction is stored against the lane', () => {
      expect(Object.keys(store.getState().system.turnRestrictions).length).toBe(1);
    });

    it('deleting the way drops its turn restrictions', () => {
      store.getState().deleteWay(w);
      expect(Object.keys(store.getState().system.turnRestrictions).length).toBe(0);
    });
  });

  describe('replacing the cross-section mints fresh lane ids, so the old key is dead', () => {
    let store: ReturnType<typeof createEditorStore>;
    let v: string;
    let vLane: string;

    beforeEach(() => {
      store = createEditorStore();
      v = store.getState().beginWay('road', 'straight');
      store.getState().addWayPoint(v, [-115.2, 36.1]);
      store.getState().addWayPoint(v, [-115.1, 36.1]);
      store.getState().finishWay();
      vLane = store
        .getState()
        .system.ways.find((x) => x.id === v)!
        .profile.lanes.find((l) => l.kindId === 'drive')!.id;
      store.getState().setTurnRestriction(v, vLane, []);
    });

    it('applying a preset drops restrictions on the lanes it replaced', () => {
      store.getState().applyProfilePreset(v, 'roadArterial4');
      expect(Object.keys(store.getState().system.turnRestrictions)).not.toContain(
        laneRefKey(v, vLane),
      );
    });

    // A live restriction is left alone.
    it('an unrelated edit leaves a live restriction alone', () => {
      store.getState().applyProfilePreset(v, 'roadArterial4');
      const liveLane = store
        .getState()
        .system.ways.find((x) => x.id === v)!
        .profile.lanes.find((l) => l.kindId === 'drive')!.id;
      store.getState().setTurnRestriction(v, liveLane, []);
      store.getState().setWayGrade(v, 'elevated');
      expect(Object.keys(store.getState().system.turnRestrictions).length).toBe(1);
    });
  });
});

describe('the carriageway affordances survive an ordinary edit', () => {
  describe('splitting one carriageway after separating', () => {
    // Splitting one carriageway is an ordinary edit — a cross street does it
    // automatically. The identity grows past two members, which used to hide
    // both the Combine button and the median field for good.
    let store: ReturnType<typeof createEditorStore>;
    let other: string;
    let nwId: string;

    beforeEach(() => {
      store = createEditorStore();
      const r = store.getState().beginWay('road', 'straight');
      store.getState().addWayPoint(r, [-115.2, 36.1]);
      store.getState().addWayPoint(r, [-115.15, 36.1]);
      store.getState().addWayPoint(r, [-115.1, 36.1]);
      store.getState().finishWay();
      store.getState().applyProfilePreset(r, 'roadArterial4');
      other = store.getState().separateCarriageways(r)!;
      nwId = store.getState().system.namedWays.find((n) => n.wayIds.includes(r))!.id;
    });

    it('separating captures a median', () => {
      expect(getComponent(store.getState().system.medians, nwId)).not.toBeUndefined();
    });

    it('a split takes the identity past two members', () => {
      store.getState().splitWayAt(other, 1);
      expect(
        store.getState().system.namedWays.find((n) => n.id === nwId)!.wayIds.length,
      ).toBeGreaterThan(2);
    });

    it('but the captured median is still there to edit', () => {
      store.getState().splitWayAt(other, 1);
      expect(getComponent(store.getState().system.medians, nwId)).not.toBeUndefined();
    });

    it('and it is still editable', () => {
      store.getState().splitWayAt(other, 1);
      store.getState().setMedianWidth(nwId, 7);
      expect(getComponent(store.getState().system.medians, nwId)?.widthM).toBe(7);
    });
  });

  // combineCarriageways refuses two two-way ways under one identity, so the
  // UI's disabled state and the action agree.
  it('combining refuses two two-way ways sharing an identity', () => {
    const store = createEditorStore();
    const a = store.getState().beginWay('road', 'straight');
    store.getState().addWayPoint(a, [-115.2, 36.1]);
    store.getState().addWayPoint(a, [-115.1, 36.1]);
    store.getState().finishWay();
    const b = store.getState().beginWay('road', 'straight');
    store.getState().addWayPoint(b, [-115.2, 36.11]);
    store.getState().addWayPoint(b, [-115.1, 36.11]);
    store.getState().finishWay();
    store.getState().nameWay(a, 'Twin Street');
    store.getState().nameWay(b, 'Twin Street');
    const twin = store.getState().system.namedWays.find((n) => n.name === 'Twin Street')!;
    const waysBefore = store.getState().system.ways.length;
    store.getState().combineCarriageways(twin.id);
    expect(store.getState().system.ways.length).toBe(waysBefore);
  });
});
