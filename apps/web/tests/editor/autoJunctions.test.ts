// Converted from apps/web/tests/verify.test.ts lines 7461-7729 (7 sections).
import { beforeEach, describe, expect, it } from 'vitest';
import { createEditorStore } from '../../src/editor/store';
import { patternLegs } from '@transitmapper/core/model/geo';
import { wayCrossings } from '@transitmapper/core/model/validate';
import { effectiveConnectors } from '@transitmapper/core/geometry/junctions';
import { parseSystem } from '@transitmapper/core/model/serialize';
import { required } from '../support/required.test';

/** Throw-guard for a lookup this test's own setup guarantees succeeds — turns
 *  a silent `undefined`/`null` into a clear failure at the point of use
 *  instead of a confusing crash further down the assertion. */
function mustFind<T>(v: T | null | undefined, what: string): T {
  if (v === null || v === undefined) throw new Error(`expected ${what}`);
  return v;
}

// Shared setup for scenarios that only care about the junction once it
// already exists (semantics, connectors, deletion) rather than about the
// crossing-resolution mechanics themselves: two straight roads crossing in a
// plus shape, already resolved into a single junction node.
function createStoreWithCrossingRoads(): ReturnType<typeof createEditorStore> {
  const store = createEditorStore();
  const ew = required(store.commands.ways.beginWay('road', 'straight'));
  store.commands.ways.addWayPoint(ew, [-115.2, 36.1]);
  store.commands.ways.addWayPoint(ew, [-115.1, 36.1]);
  store.commands.ways.finishWay();
  const ns = required(store.commands.ways.beginWay('road', 'straight'));
  store.commands.ways.addWayPoint(ns, [-115.15, 36.05]);
  store.commands.ways.addWayPoint(ns, [-115.15, 36.15]);
  store.commands.ways.finishWay();
  // finishWay auto-formed the junction already; an explicit re-run is a
  // no-op.
  store.commands.network.formCrossingJunctions(ns);
  return store;
}

describe('store: auto-junctions where ways cross (the SimCity moment)', () => {
  describe('two roads crossing at grade', () => {
    let store: ReturnType<typeof createEditorStore>;

    beforeEach(() => {
      store = createStoreWithCrossingRoads();
    });

    it('crossing forms exactly one junction node', () => {
      expect(store.getState().system.nodes.length).toBe(1);
    });

    it('the junction has four arms (both ways split)', () => {
      expect(store.getState().system.ways.length).toBe(4);
    });

    it('all four arms meet at the junction', () => {
      expect(store.getState().system.nodes[0].refs.length).toBe(4);
    });

    it('no unresolved crossings remain', () => {
      const after = store.getState().system;
      expect(
        after.ways.every((a2, i) =>
          after.ways.every((b2, j) => i >= j || wayCrossings(a2, b2).length === 0),
        ),
      ).toBe(true);
    });

    it('services still ride their (now split) ways', () => {
      const after = store.getState().system;
      expect(after.services.every((service) => patternLegs(service.path).length === 2)).toBe(true);
    });
  });

  // Grade separation: an ELEVATED way crossing a surface street is an
  // overpass, never an intersection.
  it('different grades never auto-join (overpass, not intersection)', () => {
    const store = createEditorStore();
    const surface = required(store.commands.ways.beginWay('road', 'straight'));
    store.commands.ways.addWayPoint(surface, [-115.2, 36.1]);
    store.commands.ways.addWayPoint(surface, [-115.1, 36.1]);
    store.commands.ways.finishWay();
    store.commands.tools.setDraftGrade('elevated');
    const freeway = required(store.commands.ways.beginWay('road', 'straight'));
    store.commands.ways.addWayPoint(freeway, [-115.15, 36.05]);
    store.commands.ways.addWayPoint(freeway, [-115.15, 36.15]);
    store.commands.ways.finishWay();
    store.commands.tools.setDraftGrade('atGrade');
    store.commands.network.formCrossingJunctions(freeway);
    expect(store.getState().system.nodes.length).toBe(0);
    expect(store.getState().system.ways.length).toBe(2);
  });
});

describe('store: auto-elevate a guideway crossing a major road', () => {
  let store: ReturnType<typeof createEditorStore>;
  let road: string;

  beforeEach(() => {
    store = createEditorStore();
    road = required(store.commands.ways.beginWay('road', 'straight'));
    store.commands.ways.addWayPoint(road, [-115.15, 36.05]);
    store.commands.ways.addWayPoint(road, [-115.15, 36.15]);
    store.commands.ways.finishWay();
    store.commands.ways.setWayClassId(road, 'arterial'); // major
    const rail = required(store.commands.ways.beginWay('heavyRail', 'straight'));
    store.commands.ways.addWayPoint(rail, [-115.2, 36.1]);
    store.commands.ways.addWayPoint(rail, [-115.1, 36.1]);
    store.commands.ways.finishWay();
  });

  it('the rail line is auto-split into three pieces', () => {
    const railPieces = store.getState().system.ways.filter((w) => w.typeId === 'heavyRail');
    expect(railPieces.length).toBe(3);
  });

  it('exactly one piece is elevated over the road', () => {
    const railPieces = store.getState().system.ways.filter((w) => w.typeId === 'heavyRail');
    expect(railPieces.filter((w) => w.grade === 'elevated').length).toBe(1);
  });

  it('the flanking pieces stay at grade', () => {
    const railPieces = store.getState().system.ways.filter((w) => w.typeId === 'heavyRail');
    expect(railPieces.filter((w) => w.grade === 'atGrade').length).toBe(2);
  });

  it('the crossed road is completely untouched', () => {
    const crossedRoad = mustFind(
      store.getState().system.ways.find((w) => w.id === road),
      'crossed road',
    );
    expect(crossedRoad.points.length).toBe(2);
    expect(crossedRoad.grade).toBe('atGrade');
  });

  // The three pieces stay one continuous physical alignment — splitWay's own
  // seam-node behavior connects each cut, same as splitting a way for any
  // other reason (a profile change, say) already does. What must NOT happen
  // is either seam reaching the road: that's the actual "stays an overpass"
  // guarantee, not an absence of nodes altogether.
  it('splitting into three pieces leaves two internal seam nodes', () => {
    expect(store.getState().system.nodes.length).toBe(2);
  });

  it('neither seam node touches the crossed road', () => {
    expect(store.getState().system.nodes.every((n) => !n.refs.some((r) => r.wayId === road))).toBe(
      true,
    );
  });
});

describe('store: a guideway crossing a NON-major road forms a level crossing, not an auto-elevate', () => {
  let store: ReturnType<typeof createEditorStore>;

  beforeEach(() => {
    store = createEditorStore();
    const road = required(store.commands.ways.beginWay('road', 'straight')); // defaults to collector, not major
    store.commands.ways.addWayPoint(road, [-115.15, 36.05]);
    store.commands.ways.addWayPoint(road, [-115.15, 36.15]);
    store.commands.ways.finishWay();
    const rail = required(store.commands.ways.beginWay('heavyRail', 'straight'));
    store.commands.ways.addWayPoint(rail, [-115.2, 36.1]);
    store.commands.ways.addWayPoint(rail, [-115.1, 36.1]);
    store.commands.ways.finishWay();
  });

  it('nothing is elevated over a minor road', () => {
    expect(store.getState().system.ways.every((w) => w.grade === 'atGrade')).toBe(true);
  });

  it('a real level-crossing node forms instead', () => {
    const after = store.getState().system;
    expect(after.nodes.length).toBe(1);
    expect(after.nodes[0].control).toBe('levelCrossing');
  });

  it('the level crossing splits both ways into two arms each', () => {
    const after = store.getState().system;
    expect(after.ways.filter((w) => w.typeId === 'heavyRail').length).toBe(2);
    expect(after.ways.filter((w) => w.typeId === 'road').length).toBe(2);
  });

  it("a level crossing's connectors are empty — nothing turns from a track onto a street lane", () => {
    const after = store.getState().system;
    expect(
      effectiveConnectors(after.nodes[0], new Map(after.ways.map((w) => [w.id, w]))).length,
    ).toBe(0);
  });

  // The two invariants a level crossing depends on that are easy to break
  // separately: withSingleTypeArms must not prune it back to single-type on
  // load, and the NODE_CONTROLS whitelist must not silently drop the value.
  it('a level crossing survives a save and a reload', () => {
    const reloaded = parseSystem(JSON.parse(JSON.stringify(store.getState().system)));
    expect(reloaded.nodes.length).toBe(1);
  });

  it('the reloaded node keeps all four arms and its control', () => {
    const reloaded = parseSystem(JSON.parse(JSON.stringify(store.getState().system)));
    expect(reloaded.nodes[0]?.control).toBe('levelCrossing');
    expect(reloaded.nodes[0]?.refs.length).toBe(4);
  });
});

// Auto-elevate only ever applies to a DIFFERENT-type crossing (guideway vs.
// road) — same-type crossings always take the existing junction-forming
// branch regardless of either way's class.
describe('store: road crossing a major road still forms an ordinary junction', () => {
  it('two major roads crossing still form an ordinary junction, not a viaduct', () => {
    const store = createEditorStore();
    const ew = required(store.commands.ways.beginWay('road', 'straight'));
    store.commands.ways.addWayPoint(ew, [-115.2, 36.1]);
    store.commands.ways.addWayPoint(ew, [-115.1, 36.1]);
    store.commands.ways.finishWay();
    store.commands.ways.setWayClassId(ew, 'arterial');
    const ns = required(store.commands.ways.beginWay('road', 'straight'));
    store.commands.ways.addWayPoint(ns, [-115.15, 36.05]);
    store.commands.ways.addWayPoint(ns, [-115.15, 36.15]);
    store.commands.ways.finishWay();
    store.commands.ways.setWayClassId(ns, 'arterial');
    store.commands.network.formCrossingJunctions(ns);
    const after = store.getState().system;
    expect(after.nodes.length).toBe(1);
    expect(after.ways.length).toBe(4);
    expect(after.ways.every((w) => w.grade === 'atGrade')).toBe(true);
  });
});

describe('store: a guideway crossing two major roads elevates over both', () => {
  let store: ReturnType<typeof createEditorStore>;

  beforeEach(() => {
    store = createEditorStore();
    const roadA = required(store.commands.ways.beginWay('road', 'straight'));
    store.commands.ways.addWayPoint(roadA, [-115.18, 36.05]);
    store.commands.ways.addWayPoint(roadA, [-115.18, 36.15]);
    store.commands.ways.finishWay();
    store.commands.ways.setWayClassId(roadA, 'arterial');
    const roadB = required(store.commands.ways.beginWay('road', 'straight'));
    store.commands.ways.addWayPoint(roadB, [-115.12, 36.05]);
    store.commands.ways.addWayPoint(roadB, [-115.12, 36.15]);
    store.commands.ways.finishWay();
    store.commands.ways.setWayClassId(roadB, 'arterial');
    const rail = required(store.commands.ways.beginWay('heavyRail', 'straight'));
    store.commands.ways.addWayPoint(rail, [-115.2, 36.1]);
    store.commands.ways.addWayPoint(rail, [-115.1, 36.1]);
    store.commands.ways.finishWay();
  });

  it('crossing two major roads produces five rail pieces', () => {
    const railPieces = store.getState().system.ways.filter((w) => w.typeId === 'heavyRail');
    expect(railPieces.length).toBe(5);
  });

  it('exactly two pieces are elevated, one per road', () => {
    const railPieces = store.getState().system.ways.filter((w) => w.typeId === 'heavyRail');
    expect(railPieces.filter((w) => w.grade === 'elevated').length).toBe(2);
  });

  it('both crossed roads are still untouched', () => {
    expect(store.getState().system.ways.filter((w) => w.typeId === 'road').length).toBe(2);
  });
});

describe('store: junction semantics (control, connectors)', () => {
  let store: ReturnType<typeof createEditorStore>;
  let nodeId: string;
  let armAId: string;
  let armBId: string;
  let armALaneId: string;
  let armBLaneId: string;

  beforeEach(() => {
    store = createStoreWithCrossingRoads();
    const sys = store.getState().system;
    nodeId = sys.nodes[0].id;
    const armA = mustFind(
      sys.ways.find((w) => sys.nodes[0].refs.some((r) => r.wayId === w.id)),
      'arm A',
    );
    const armB = mustFind(
      sys.ways.find((w) => w.id !== armA.id && sys.nodes[0].refs.some((r) => r.wayId === w.id)),
      'arm B',
    );
    armAId = armA.id;
    armBId = armB.id;
    armALaneId = armA.profile.lanes[1].id;
    armBLaneId = armB.profile.lanes[1].id;
  });

  it('setNodeControl stores the control', () => {
    store.commands.network.setNodeControl(nodeId, 'signal');
    expect(store.getState().system.nodes[0].control).toBe('signal');
  });

  it('setNodeConnectors stores the lane graph', () => {
    store.commands.network.setNodeConnectors(nodeId, [
      { from: { wayId: armAId, laneId: armALaneId }, to: { wayId: armBId, laneId: armBLaneId } },
    ]);
    expect(store.getState().system.nodes[0].connectors?.length).toBe(1);
  });

  // Deleting a referenced lane prunes its connectors.
  it('removing a lane prunes connectors that referenced it', () => {
    store.commands.network.setNodeConnectors(nodeId, [
      { from: { wayId: armAId, laneId: armALaneId }, to: { wayId: armBId, laneId: armBLaneId } },
    ]);
    const armA = mustFind(
      store.getState().system.ways.find((w) => w.id === armAId),
      'arm A',
    );
    store.commands.ways.setWayProfile(armAId, {
      lanes: armA.profile.lanes.filter((l) => l.id !== armALaneId),
    });
    expect(store.getState().system.nodes[0].connectors).toBeFalsy();
  });

  it('setNodeConnectors(undefined) reverts to heuristic', () => {
    store.commands.network.setNodeConnectors(nodeId, [
      { from: { wayId: armAId, laneId: armALaneId }, to: { wayId: armBId, laneId: armBLaneId } },
    ]);
    store.commands.network.setNodeConnectors(nodeId, undefined);
    expect(store.getState().system.nodes[0].connectors).toBeUndefined();
  });
});

describe('store: deleting a way cleans identity + connectors', () => {
  let store: ReturnType<typeof createEditorStore>;
  let firstArmId: string;

  beforeEach(() => {
    store = createStoreWithCrossingRoads();
    const arms = store.getState().system.ways;
    const nodeId = store.getState().system.nodes[0].id;
    store.commands.network.setNodeConnectors(nodeId, [
      {
        from: { wayId: arms[0].id, laneId: arms[0].profile.lanes[1].id },
        to: { wayId: arms[1].id, laneId: arms[1].profile.lanes[1].id },
      },
    ]);
    store.commands.ways.nameWay(arms[0].id, 'Sahara Ave');
    firstArmId = arms[0].id;
    store.commands.ways.deleteWay(arms[0].id);
  });

  it('deleting a way drops its identity membership', () => {
    expect(store.getState().system.namedWays.some((n) => n.wayIds.includes(firstArmId))).toBe(
      false,
    );
  });

  it('deleting a way drops connectors that referenced it', () => {
    expect(
      store
        .getState()
        .system.nodes.every(
          (n) =>
            !n.connectors?.some((c) => c.from.wayId === firstArmId || c.to.wayId === firstArmId),
        ),
    ).toBe(true);
  });
});
