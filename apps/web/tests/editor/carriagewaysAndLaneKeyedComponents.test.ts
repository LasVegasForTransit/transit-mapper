// Converted from apps/web/tests/verify.test.ts lines 7011-7460 (part 2 of 2:
// carriageway separation/combination, lane-keyed components, and the
// affordances that must survive an ordinary edit). See
// vehicleCatalogAndNamedWayIdentity.test.ts for the other half.
import { beforeEach, describe, expect, it } from 'vitest';
import { createEditorStore } from '../../src/editor/store';
import { getComponent, laneRefKey } from '@transitmapper/core/model/components';
import { directionalLanes, isOneWay } from '@transitmapper/core/model/profile';
import { primaryAnchor } from '@transitmapper/core/model/geo';
import { osmElementsToNetwork, type OsmWayElement } from '@transitmapper/core/model/import';

/** Throw-guard for a lookup this test's own setup guarantees succeeds — turns
 *  a silent `undefined`/`null` into a clear failure at the point of use
 *  instead of a confusing crash further down the assertion. */
function mustFind<T>(v: T | null | undefined, what: string): T {
  if (v === null || v === undefined) throw new Error(`expected ${what}`);
  return v;
}

/**
 * Draws a straight two-point way and applies a cross-section preset to it,
 * returning the way's id. Duplicated from the sibling file
 * (vehicleCatalogAndNamedWayIdentity.test.ts), which needs it for its own
 * profile-preset suite — this file's separate/combine-carriageway suite
 * needs a way already under a named preset before its own beforeEach steps
 * take over.
 */
function beginStraightWayWithPreset(
  store: ReturnType<typeof createEditorStore>,
  presetId: string,
): string {
  const wayId = store.getState().beginWay('road', 'straight');
  store.getState().addWayPoint(wayId, [-115.2, 36.1]);
  store.getState().addWayPoint(wayId, [-115.1, 36.1]);
  store.getState().finishWay();
  store.getState().applyProfilePreset(wayId, presetId);
  return wayId;
}

describe('store: separate/combine carriageways', () => {
  let store: ReturnType<typeof createEditorStore>;
  let r: string;

  beforeEach(() => {
    store = createEditorStore();
    r = beginStraightWayWithPreset(store, 'roadArterial4');
  });

  it('separateCarriageways returns the new carriageway', () => {
    const newId = store.getState().separateCarriageways(r);
    expect(newId).toBeTruthy();
    expect(store.getState().system.ways.length).toBe(2);
  });

  it('original way becomes the one-way forward carriageway', () => {
    store.getState().separateCarriageways(r);
    const fwd = mustFind(
      store.getState().system.ways.find((w) => w.id === r),
      'forward carriageway',
    );
    expect(isOneWay(fwd.profile)).toBe(true);
    expect(directionalLanes(fwd.profile).every((l) => l.direction === 'forward')).toBe(true);
  });

  it('new way is the one-way backward carriageway', () => {
    const newId = mustFind(store.getState().separateCarriageways(r), 'new carriageway id');
    const back = mustFind(
      store.getState().system.ways.find((w) => w.id === newId),
      'backward carriageway',
    );
    expect(directionalLanes(back.profile).every((l) => l.direction === 'backward')).toBe(true);
  });

  it('the carriageways are physically offset', () => {
    const newId = mustFind(store.getState().separateCarriageways(r), 'new carriageway id');
    const fwd = mustFind(
      store.getState().system.ways.find((w) => w.id === r),
      'forward carriageway',
    );
    const back = mustFind(
      store.getState().system.ways.find((w) => w.id === newId),
      'backward carriageway',
    );
    expect(Math.abs(back.points[0][1] - fwd.points[0][1])).toBeGreaterThan(1e-6);
  });

  it('both carriageways share one identity', () => {
    const newId = mustFind(store.getState().separateCarriageways(r), 'new carriageway id');
    const nw = store.getState().system.namedWays.find((n) => n.wayIds.includes(r));
    expect(nw).toBeDefined();
    expect(mustFind(nw, 'named way').wayIds.includes(newId)).toBe(true);
  });

  it('a one-way way refuses to separate', () => {
    store.getState().separateCarriageways(r);
    expect(store.getState().separateCarriageways(r)).toBeNull();
  });

  it('separateCarriageways captures a Median component keyed by the NamedWay', () => {
    store.getState().separateCarriageways(r);
    const nw = mustFind(
      store.getState().system.namedWays.find((n) => n.wayIds.includes(r)),
      'named way',
    );
    const median = getComponent(store.getState().system.medians, nw.id);
    expect(median).toBeDefined();
    expect(mustFind(median, 'median').widthM).toBeGreaterThan(0);
  });

  it('setMedianWidth overrides the captured width', () => {
    store.getState().separateCarriageways(r);
    const nw = mustFind(
      store.getState().system.namedWays.find((n) => n.wayIds.includes(r)),
      'named way',
    );
    store.getState().setMedianWidth(nw.id, 6);
    expect(getComponent(store.getState().system.medians, nw.id)?.widthM).toBe(6);
  });

  it('combineCarriageways restores a single way', () => {
    store.getState().separateCarriageways(r);
    const nw = mustFind(
      store.getState().system.namedWays.find((n) => n.wayIds.includes(r)),
      'named way',
    );
    store.getState().combineCarriageways(nw.id);
    const combined = store.getState().system;
    expect(combined.ways.length).toBe(1);
    expect(combined.ways[0].id).toBe(r);
  });

  it('combined way is two-way again', () => {
    store.getState().separateCarriageways(r);
    const nw = mustFind(
      store.getState().system.namedWays.find((n) => n.wayIds.includes(r)),
      'named way',
    );
    store.getState().combineCarriageways(nw.id);
    expect(isOneWay(store.getState().system.ways[0].profile)).toBe(false);
  });

  it('combined profile gained a median between carriageways', () => {
    store.getState().separateCarriageways(r);
    const nw = mustFind(
      store.getState().system.namedWays.find((n) => n.wayIds.includes(r)),
      'named way',
    );
    store.getState().combineCarriageways(nw.id);
    expect(store.getState().system.ways[0].profile.lanes.some((l) => l.kindId === 'median')).toBe(
      true,
    );
  });

  it('combining restores the edited median width, not a generic default', () => {
    store.getState().separateCarriageways(r);
    const nw = mustFind(
      store.getState().system.namedWays.find((n) => n.wayIds.includes(r)),
      'named way',
    );
    store.getState().setMedianWidth(nw.id, 6);
    store.getState().combineCarriageways(nw.id);
    expect(
      store.getState().system.ways[0].profile.lanes.find((l) => l.kindId === 'median')?.widthM,
    ).toBe(6);
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
    const nw = mustFind(
      store.getState().system.namedWays.find((n) => n.name === 'Grand Boulevard'),
      'named way',
    );
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
      const cross = mustFind(
        sys.ways.find((w) => w.source === 'osm:3'),
        'cross street',
      );
      crossId = cross.id;
      const nw = mustFind(
        sys.namedWays.find((n) => n.name === 'Grand Boulevard'),
        'named way',
      );
      nodesBefore = sys.nodes.length;
      const discarded = mustFind(
        carriageways.find(
          (w) =>
            !isOneWay(w.profile) ||
            directionalLanes(w.profile).every((l) => l.direction === 'backward'),
        ),
        'discarded carriageway',
      );
      discardedId = discarded.id;
      stId = store.getState().addStation(discarded.points[0], { wayId: discarded.id, t: 0 });
      store.getState().combineCarriageways(nw.id);
      survivorId = mustFind(
        store.getState().system.ways.find((w) => w.id !== crossId),
        'surviving carriageway',
      ).id;
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
      const station = mustFind(
        after.stations.find((st) => st.id === stId),
        'station',
      );
      expect(primaryAnchor(station)?.wayId).toBe(survivorId);
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
      const survivor = mustFind(
        after.ways.find((w) => w.id === survivorId),
        'survivor',
      );
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
      const way = mustFind(
        store.getState().system.ways.find((x) => x.id === w),
        'way',
      );
      const laneId = mustFind(
        way.profile.lanes.find((l) => l.kindId === 'drive'),
        'drive lane',
      ).id;
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
      const way = mustFind(
        store.getState().system.ways.find((x) => x.id === v),
        'way',
      );
      vLane = mustFind(
        way.profile.lanes.find((l) => l.kindId === 'drive'),
        'drive lane',
      ).id;
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
      const liveWay = mustFind(
        store.getState().system.ways.find((x) => x.id === v),
        'way',
      );
      const liveLane = mustFind(
        liveWay.profile.lanes.find((l) => l.kindId === 'drive'),
        'drive lane',
      ).id;
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
      other = mustFind(store.getState().separateCarriageways(r), 'new carriageway id');
      nwId = mustFind(
        store.getState().system.namedWays.find((n) => n.wayIds.includes(r)),
        'named way',
      ).id;
    });

    it('separating captures a median', () => {
      expect(getComponent(store.getState().system.medians, nwId)).not.toBeUndefined();
    });

    it('a split takes the identity past two members', () => {
      store.getState().splitWayAt(other, 1);
      expect(
        mustFind(
          store.getState().system.namedWays.find((n) => n.id === nwId),
          'named way',
        ).wayIds.length,
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
    const twin = mustFind(
      store.getState().system.namedWays.find((n) => n.name === 'Twin Street'),
      'named way',
    );
    const waysBefore = store.getState().system.ways.length;
    store.getState().combineCarriageways(twin.id);
    expect(store.getState().system.ways.length).toBe(waysBefore);
  });
});
