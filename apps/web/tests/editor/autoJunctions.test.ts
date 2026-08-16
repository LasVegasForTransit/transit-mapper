// Converted from apps/web/tests/verify.test.ts lines 7461-7729 (7 sections).
import { beforeEach, describe, expect, it } from 'vitest';
import { createEditorStore } from '../../src/editor/store';
import { patternLegs } from '@transitmapper/core/model/geo';
import { wayCrossings } from '@transitmapper/core/model/validate';
import { effectiveConnectors } from '@transitmapper/core/geometry/junctions';
import { parseSystem } from '@transitmapper/core/model/serialize';

describe('store: auto-junctions where ways cross (the SimCity moment)', () => {
  describe('two roads crossing at grade', () => {
    let store: ReturnType<typeof createEditorStore>;

    beforeEach(() => {
      store = createEditorStore();
      const ew = store.getState().beginWay('road', 'straight');
      store.getState().addWayPoint(ew, [-115.2, 36.1]);
      store.getState().addWayPoint(ew, [-115.1, 36.1]);
      store.getState().finishWay();
      const ns = store.getState().beginWay('road', 'straight');
      store.getState().addWayPoint(ns, [-115.15, 36.05]);
      store.getState().addWayPoint(ns, [-115.15, 36.15]);
      store.getState().finishWay();
      // finishWay auto-formed the junction already; an explicit re-run is a
      // no-op.
      store.getState().formCrossingJunctions(ns);
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
      expect(
        after.services.every((sv) => sv.patterns.every((p) => patternLegs(p).length === 2)),
      ).toBe(true);
    });
  });

  // Grade separation: an ELEVATED way crossing a surface street is an
  // overpass, never an intersection.
  it('different grades never auto-join (overpass, not intersection)', () => {
    const store = createEditorStore();
    const surface = store.getState().beginWay('road', 'straight');
    store.getState().addWayPoint(surface, [-115.2, 36.1]);
    store.getState().addWayPoint(surface, [-115.1, 36.1]);
    store.getState().finishWay();
    store.getState().setDraftGrade('elevated');
    const freeway = store.getState().beginWay('road', 'straight');
    store.getState().addWayPoint(freeway, [-115.15, 36.05]);
    store.getState().addWayPoint(freeway, [-115.15, 36.15]);
    store.getState().finishWay();
    store.getState().setDraftGrade('atGrade');
    store.getState().formCrossingJunctions(freeway);
    expect(store.getState().system.nodes.length).toBe(0);
    expect(store.getState().system.ways.length).toBe(2);
  });
});

describe('store: auto-elevate a guideway crossing a major road', () => {
  let store: ReturnType<typeof createEditorStore>;
  let road: string;

  beforeEach(() => {
    store = createEditorStore();
    road = store.getState().beginWay('road', 'straight');
    store.getState().addWayPoint(road, [-115.15, 36.05]);
    store.getState().addWayPoint(road, [-115.15, 36.15]);
    store.getState().finishWay();
    store.getState().setWayClassId(road, 'arterial'); // major
    const rail = store.getState().beginWay('heavyRail', 'straight');
    store.getState().addWayPoint(rail, [-115.2, 36.1]);
    store.getState().addWayPoint(rail, [-115.1, 36.1]);
    store.getState().finishWay();
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
    const crossedRoad = store.getState().system.ways.find((w) => w.id === road)!;
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
    const road = store.getState().beginWay('road', 'straight'); // defaults to collector, not major
    store.getState().addWayPoint(road, [-115.15, 36.05]);
    store.getState().addWayPoint(road, [-115.15, 36.15]);
    store.getState().finishWay();
    const rail = store.getState().beginWay('heavyRail', 'straight');
    store.getState().addWayPoint(rail, [-115.2, 36.1]);
    store.getState().addWayPoint(rail, [-115.1, 36.1]);
    store.getState().finishWay();
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
    const ew = store.getState().beginWay('road', 'straight');
    store.getState().addWayPoint(ew, [-115.2, 36.1]);
    store.getState().addWayPoint(ew, [-115.1, 36.1]);
    store.getState().finishWay();
    store.getState().setWayClassId(ew, 'arterial');
    const ns = store.getState().beginWay('road', 'straight');
    store.getState().addWayPoint(ns, [-115.15, 36.05]);
    store.getState().addWayPoint(ns, [-115.15, 36.15]);
    store.getState().finishWay();
    store.getState().setWayClassId(ns, 'arterial');
    store.getState().formCrossingJunctions(ns);
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
    const roadA = store.getState().beginWay('road', 'straight');
    store.getState().addWayPoint(roadA, [-115.18, 36.05]);
    store.getState().addWayPoint(roadA, [-115.18, 36.15]);
    store.getState().finishWay();
    store.getState().setWayClassId(roadA, 'arterial');
    const roadB = store.getState().beginWay('road', 'straight');
    store.getState().addWayPoint(roadB, [-115.12, 36.05]);
    store.getState().addWayPoint(roadB, [-115.12, 36.15]);
    store.getState().finishWay();
    store.getState().setWayClassId(roadB, 'arterial');
    const rail = store.getState().beginWay('heavyRail', 'straight');
    store.getState().addWayPoint(rail, [-115.2, 36.1]);
    store.getState().addWayPoint(rail, [-115.1, 36.1]);
    store.getState().finishWay();
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
    store = createEditorStore();
    const ew = store.getState().beginWay('road', 'straight');
    store.getState().addWayPoint(ew, [-115.2, 36.1]);
    store.getState().addWayPoint(ew, [-115.1, 36.1]);
    store.getState().finishWay();
    const ns = store.getState().beginWay('road', 'straight');
    store.getState().addWayPoint(ns, [-115.15, 36.05]);
    store.getState().addWayPoint(ns, [-115.15, 36.15]);
    store.getState().finishWay();
    store.getState().formCrossingJunctions(ns);
    const sys = store.getState().system;
    nodeId = sys.nodes[0].id;
    const armA = sys.ways.find((w) => sys.nodes[0].refs.some((r) => r.wayId === w.id))!;
    const armB = sys.ways.find(
      (w) => w.id !== armA.id && sys.nodes[0].refs.some((r) => r.wayId === w.id),
    )!;
    armAId = armA.id;
    armBId = armB.id;
    armALaneId = armA.profile.lanes[1].id;
    armBLaneId = armB.profile.lanes[1].id;
  });

  it('setNodeControl stores the control', () => {
    store.getState().setNodeControl(nodeId, 'signal');
    expect(store.getState().system.nodes[0].control).toBe('signal');
  });

  it('setNodeConnectors stores the lane graph', () => {
    store
      .getState()
      .setNodeConnectors(nodeId, [
        { from: { wayId: armAId, laneId: armALaneId }, to: { wayId: armBId, laneId: armBLaneId } },
      ]);
    expect(store.getState().system.nodes[0].connectors?.length).toBe(1);
  });

  // Deleting a referenced lane prunes its connectors.
  it('removing a lane prunes connectors that referenced it', () => {
    store
      .getState()
      .setNodeConnectors(nodeId, [
        { from: { wayId: armAId, laneId: armALaneId }, to: { wayId: armBId, laneId: armBLaneId } },
      ]);
    const armA = store.getState().system.ways.find((w) => w.id === armAId)!;
    store.getState().setWayProfile(armAId, {
      lanes: armA.profile.lanes.filter((l) => l.id !== armALaneId),
    });
    expect(store.getState().system.nodes[0].connectors).toBeFalsy();
  });

  it('setNodeConnectors(undefined) reverts to heuristic', () => {
    store
      .getState()
      .setNodeConnectors(nodeId, [
        { from: { wayId: armAId, laneId: armALaneId }, to: { wayId: armBId, laneId: armBLaneId } },
      ]);
    store.getState().setNodeConnectors(nodeId, undefined);
    expect(store.getState().system.nodes[0].connectors).toBeUndefined();
  });
});

describe('store: deleting a way cleans identity + connectors', () => {
  let store: ReturnType<typeof createEditorStore>;
  let firstArmId: string;

  beforeEach(() => {
    store = createEditorStore();
    const a = store.getState().beginWay('road', 'straight');
    store.getState().addWayPoint(a, [-115.2, 36.1]);
    store.getState().addWayPoint(a, [-115.1, 36.1]);
    store.getState().finishWay();
    const b = store.getState().beginWay('road', 'straight');
    store.getState().addWayPoint(b, [-115.15, 36.05]);
    store.getState().addWayPoint(b, [-115.15, 36.15]);
    store.getState().finishWay();
    store.getState().formCrossingJunctions(b);
    const arms = store.getState().system.ways;
    const nodeId = store.getState().system.nodes[0].id;
    store.getState().setNodeConnectors(nodeId, [
      {
        from: { wayId: arms[0].id, laneId: arms[0].profile.lanes[1].id },
        to: { wayId: arms[1].id, laneId: arms[1].profile.lanes[1].id },
      },
    ]);
    store.getState().nameWay(arms[0].id, 'Sahara Ave');
    firstArmId = arms[0].id;
    store.getState().deleteWay(arms[0].id);
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
