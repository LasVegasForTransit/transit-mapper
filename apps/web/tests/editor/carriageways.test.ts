// Splitting a two-way road into carriageways, combining them back, and the
// lane-keyed data (medians, turn restrictions) that has to survive both.
import { beforeEach, describe, expect, it } from 'vitest';
import { createEditorStore } from '../../src/editor/store';
import { getComponent, laneRefKey } from '@transitmapper/core/model/components';
import { directionalLanes, isOneWay } from '@transitmapper/core/model/profile';
import { primaryAnchor } from '@transitmapper/core/model/geo';
import { osmElementsToNetwork, type OsmWayElement } from '@transitmapper/core/model/import';
import { mustFind, required } from '../support/required.test';

// beginWay(typeId, ...) without an explicit setDraftMode(...) call attaches a
// service using the store's default draftModeId ('lightRail', which is
// compatible with the 'road' way type) — see
// src/editor/store/internal-operations/way-creation.ts's compatibleModeId.
// Cases below that don't set the mode explicitly are implicitly exercising
// lightRail, not a specific documented choice.

/**
 * Draws a straight two-point way and applies a cross-section preset to it,
 * returning the way's id. Also defined in namedWayIdentity.test.ts, which
 * needs the same setup for its own profile-preset suite; this file's
 * separate/combine-carriageway suite needs a way already under a named
 * preset before its own beforeEach steps take over.
 */
function beginStraightWayWithPreset(
  store: ReturnType<typeof createEditorStore>,
  presetId: string,
): string {
  const wayId = required(store.commands.ways.beginWay('road', 'straight'));
  store.commands.ways.addWayPoint(wayId, [-115.2, 36.1]);
  store.commands.ways.addWayPoint(wayId, [-115.1, 36.1]);
  store.commands.ways.finishWay();
  store.commands.ways.applyProfilePreset(wayId, presetId);
  return wayId;
}

describe('store: separating a road into carriageways, and combining them back', () => {
  let store: ReturnType<typeof createEditorStore>;
  let r: string;

  beforeEach(() => {
    store = createEditorStore();
    r = beginStraightWayWithPreset(store, 'roadArterial4');
  });

  it('separateCarriageways returns the new carriageway', () => {
    const newId = store.commands.network.separateCarriageways(r);
    expect(newId).toBeTruthy();
    expect(store.getState().system.ways.length).toBe(2);
  });

  it('original way becomes the one-way forward carriageway', () => {
    store.commands.network.separateCarriageways(r);
    const fwd = mustFind(
      store.getState().system.ways.find((w) => w.id === r),
      'forward carriageway',
    );
    expect(isOneWay(fwd.profile)).toBe(true);
    expect(directionalLanes(fwd.profile).every((l) => l.direction === 'forward')).toBe(true);
  });

  it('new way is the one-way backward carriageway', () => {
    const newId = mustFind(store.commands.network.separateCarriageways(r), 'new carriageway id');
    const back = mustFind(
      store.getState().system.ways.find((w) => w.id === newId),
      'backward carriageway',
    );
    expect(directionalLanes(back.profile).every((l) => l.direction === 'backward')).toBe(true);
  });

  it('the carriageways are physically offset', () => {
    const newId = mustFind(store.commands.network.separateCarriageways(r), 'new carriageway id');
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
    const newId = mustFind(store.commands.network.separateCarriageways(r), 'new carriageway id');
    const nw = store.getState().system.namedWays.find((n) => n.wayIds.includes(r));
    expect(nw).toBeDefined();
    expect(mustFind(nw, 'named way').wayIds.includes(newId)).toBe(true);
  });

  it('a one-way way refuses to separate', () => {
    store.commands.network.separateCarriageways(r);
    expect(store.commands.network.separateCarriageways(r)).toBeNull();
  });

  it('separateCarriageways captures a Median component keyed by the NamedWay', () => {
    store.commands.network.separateCarriageways(r);
    const nw = mustFind(
      store.getState().system.namedWays.find((n) => n.wayIds.includes(r)),
      'named way',
    );
    const median = getComponent(store.getState().system.medians, nw.id);
    expect(median).toBeDefined();
    expect(mustFind(median, 'median').widthM).toBeGreaterThan(0);
  });

  it('setMedianWidth overrides the captured width', () => {
    store.commands.network.separateCarriageways(r);
    const nw = mustFind(
      store.getState().system.namedWays.find((n) => n.wayIds.includes(r)),
      'named way',
    );
    store.commands.network.setMedianWidth(nw.id, 6);
    expect(getComponent(store.getState().system.medians, nw.id)?.widthM).toBe(6);
  });

  it('combineCarriageways restores a single way', () => {
    store.commands.network.separateCarriageways(r);
    const nw = mustFind(
      store.getState().system.namedWays.find((n) => n.wayIds.includes(r)),
      'named way',
    );
    store.commands.network.combineCarriageways(nw.id);
    const combined = store.getState().system;
    expect(combined.ways.length).toBe(1);
    expect(combined.ways[0].id).toBe(r);
  });

  it('combined way is two-way again', () => {
    store.commands.network.separateCarriageways(r);
    const nw = mustFind(
      store.getState().system.namedWays.find((n) => n.wayIds.includes(r)),
      'named way',
    );
    store.commands.network.combineCarriageways(nw.id);
    expect(isOneWay(store.getState().system.ways[0].profile)).toBe(false);
  });

  it('combined profile gained a median between carriageways', () => {
    store.commands.network.separateCarriageways(r);
    const nw = mustFind(
      store.getState().system.namedWays.find((n) => n.wayIds.includes(r)),
      'named way',
    );
    store.commands.network.combineCarriageways(nw.id);
    expect(store.getState().system.ways[0].profile.lanes.some((l) => l.kindId === 'median')).toBe(
      true,
    );
  });

  it('combining restores the edited median width, not a generic default', () => {
    store.commands.network.separateCarriageways(r);
    const nw = mustFind(
      store.getState().system.namedWays.find((n) => n.wayIds.includes(r)),
      'named way',
    );
    store.commands.network.setMedianWidth(nw.id, 6);
    store.commands.network.combineCarriageways(nw.id);
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
    store.commands.imports.importWays(osmElementsToNetwork(divided));
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
      stId = required(
        store.commands.stops.addStop(discarded.points[0], { wayId: discarded.id, t: 0 }),
      );
      store.commands.network.combineCarriageways(nw.id);
      survivorId = mustFind(
        store.getState().system.ways.find((w) => w.id !== crossId),
        'surviving carriageway',
      ).id;
    });

    it('combining leaves one carriageway', () => {
      const after = store.getState().system;
      expect(after.ways.filter((w) => w.id !== crossId).length).toBe(1);
    });

    it('combining keeps a stop anchored to the discarded carriageway', () => {
      expect(store.getState().system.stops.length).toBe(1);
    });

    it('and re-anchors it onto the surviving centerline', () => {
      const after = store.getState().system;
      const stop = mustFind(
        after.stops.find((st) => st.id === stId),
        'stop',
      );
      expect(primaryAnchor(stop)?.wayId).toBe(survivorId);
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
      w = required(store.commands.ways.beginWay('road', 'straight'));
      store.commands.ways.addWayPoint(w, [-115.2, 36.1]);
      store.commands.ways.addWayPoint(w, [-115.1, 36.1]);
      store.commands.ways.finishWay();
      const way = mustFind(
        store.getState().system.ways.find((x) => x.id === w),
        'way',
      );
      const laneId = mustFind(
        way.profile.lanes.find((l) => l.kindId === 'drive'),
        'drive lane',
      ).id;
      store.commands.network.setTurnRestriction(w, laneId, []);
    });

    it('a turn restriction is stored against the lane', () => {
      expect(Object.keys(store.getState().system.turnRestrictions).length).toBe(1);
    });

    it('deleting the way drops its turn restrictions', () => {
      store.commands.ways.deleteWay(w);
      expect(Object.keys(store.getState().system.turnRestrictions).length).toBe(0);
    });
  });

  describe('replacing the cross-section mints fresh lane ids, so the old key is dead', () => {
    let store: ReturnType<typeof createEditorStore>;
    let v: string;
    let vLane: string;

    beforeEach(() => {
      store = createEditorStore();
      v = required(store.commands.ways.beginWay('road', 'straight'));
      store.commands.ways.addWayPoint(v, [-115.2, 36.1]);
      store.commands.ways.addWayPoint(v, [-115.1, 36.1]);
      store.commands.ways.finishWay();
      const way = mustFind(
        store.getState().system.ways.find((x) => x.id === v),
        'way',
      );
      vLane = mustFind(
        way.profile.lanes.find((l) => l.kindId === 'drive'),
        'drive lane',
      ).id;
      store.commands.network.setTurnRestriction(v, vLane, []);
    });

    it('applying a preset drops restrictions on the lanes it replaced', () => {
      store.commands.ways.applyProfilePreset(v, 'roadArterial4');
      expect(Object.keys(store.getState().system.turnRestrictions)).not.toContain(
        laneRefKey(v, vLane),
      );
    });

    // A live restriction is left alone.
    it('an unrelated edit leaves a live restriction alone', () => {
      store.commands.ways.applyProfilePreset(v, 'roadArterial4');
      const liveWay = mustFind(
        store.getState().system.ways.find((x) => x.id === v),
        'way',
      );
      const liveLane = mustFind(
        liveWay.profile.lanes.find((l) => l.kindId === 'drive'),
        'drive lane',
      ).id;
      store.commands.network.setTurnRestriction(v, liveLane, []);
      store.commands.ways.setWayGrade(v, 'elevated');
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
      const r = required(store.commands.ways.beginWay('road', 'straight'));
      store.commands.ways.addWayPoint(r, [-115.2, 36.1]);
      store.commands.ways.addWayPoint(r, [-115.15, 36.1]);
      store.commands.ways.addWayPoint(r, [-115.1, 36.1]);
      store.commands.ways.finishWay();
      store.commands.ways.applyProfilePreset(r, 'roadArterial4');
      other = mustFind(store.commands.network.separateCarriageways(r), 'new carriageway id');
      nwId = mustFind(
        store.getState().system.namedWays.find((n) => n.wayIds.includes(r)),
        'named way',
      ).id;
    });

    it('separating captures a median', () => {
      expect(getComponent(store.getState().system.medians, nwId)).not.toBeUndefined();
    });

    it('a split takes the identity past two members', () => {
      store.commands.ways.splitWayAt(other, 1);
      expect(
        mustFind(
          store.getState().system.namedWays.find((n) => n.id === nwId),
          'named way',
        ).wayIds.length,
      ).toBeGreaterThan(2);
    });

    it('but the captured median is still there to edit', () => {
      store.commands.ways.splitWayAt(other, 1);
      expect(getComponent(store.getState().system.medians, nwId)).not.toBeUndefined();
    });

    it('and it is still editable', () => {
      store.commands.ways.splitWayAt(other, 1);
      store.commands.network.setMedianWidth(nwId, 7);
      expect(getComponent(store.getState().system.medians, nwId)?.widthM).toBe(7);
    });
  });

  // combineCarriageways refuses two two-way ways under one identity, so the
  // UI's disabled state and the action agree.
  it('combining refuses two two-way ways sharing an identity', () => {
    const store = createEditorStore();
    const a = required(store.commands.ways.beginWay('road', 'straight'));
    store.commands.ways.addWayPoint(a, [-115.2, 36.1]);
    store.commands.ways.addWayPoint(a, [-115.1, 36.1]);
    store.commands.ways.finishWay();
    const b = required(store.commands.ways.beginWay('road', 'straight'));
    store.commands.ways.addWayPoint(b, [-115.2, 36.11]);
    store.commands.ways.addWayPoint(b, [-115.1, 36.11]);
    store.commands.ways.finishWay();
    store.commands.ways.nameWay(a, 'Twin Street');
    store.commands.ways.nameWay(b, 'Twin Street');
    const twin = mustFind(
      store.getState().system.namedWays.find((n) => n.name === 'Twin Street'),
      'named way',
    );
    const waysBefore = store.getState().system.ways.length;
    store.commands.network.combineCarriageways(twin.id);
    expect(store.getState().system.ways.length).toBe(waysBefore);
  });
});
