// Converted from apps/web/tests/verify.test.ts lines 7011-7460 (part 1 of 2:
// vehicle-catalog store actions, profile presets, NamedWay identity through
// split/merge, and the junction-preserving behavior of separating
// carriageways). See carriagewaysAndLaneKeyedComponents.test.ts for the
// other half.
import { beforeEach, describe, expect, it } from 'vitest';
import { createEditorStore } from '../../src/editor/store';
import { patternLegs } from '@transitmapper/core/model/geo';

/** Throw-guard for a lookup this test's own setup guarantees succeeds — turns
 *  a silent `undefined`/`null` into a clear failure at the point of use
 *  instead of a confusing crash further down the assertion. */
function mustFind<T>(v: T | null | undefined, what: string): T {
  if (v === null || v === undefined) throw new Error(`expected ${what}`);
  return v;
}

/**
 * Draws a straight two-point way and applies a cross-section preset to it,
 * returning the way's id. Shared by the profile-preset suite below and the
 * separate/combine-carriageway suite in the sibling file, which both need a
 * way already under a named preset before their own beforeEach steps take
 * over. Duplicated in that file since the two suites no longer share a
 * module.
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
    serviceId = mustFind(store.getState().addServiceToWay(wayId), 'service id');
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
    r = beginStraightWayWithPreset(store, 'roadBoulevard');
  });

  it("applyProfilePreset installs the preset's lanes", () => {
    const way = mustFind(
      store.getState().system.ways.find((w) => w.id === r),
      'way',
    );
    expect(way.profile.lanes.some((l) => l.kindId === 'median')).toBe(true);
    expect(way.profile.lanes.some((l) => l.kindId === 'bike')).toBe(true);
  });

  it("applyProfilePreset takes the preset's class", () => {
    const way = mustFind(
      store.getState().system.ways.find((w) => w.id === r),
      'way',
    );
    expect(way.classId).toBe('arterial');
  });

  it('setWayProfile replaces the cross-section', () => {
    const way = mustFind(
      store.getState().system.ways.find((w) => w.id === r),
      'way',
    );
    const custom = {
      lanes: way.profile.lanes.map((l) => (l.kindId === 'drive' ? { ...l, widthM: 3.05 } : l)),
    };
    store.getState().setWayProfile(r, custom);
    expect(
      mustFind(
        store.getState().system.ways.find((w) => w.id === r),
        'way',
      ).profile.lanes.every((l) => l.kindId !== 'drive' || l.widthM === 3.05),
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
    const backId = mustFind(
      store.getState().separateCarriageways(trunk),
      'backward carriageway id',
    );
    const sys = store.getState().system;
    expect(
      sys.nodes.some((n) => {
        const wayIds = new Set(n.refs.map((ref) => ref.wayId));
        return wayIds.has(backId) && [...wayIds].some((id) => id !== trunk && id !== backId);
      }),
    ).toBe(true);
  });
});
