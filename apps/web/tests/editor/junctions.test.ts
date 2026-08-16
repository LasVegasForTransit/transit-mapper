// Converted from apps/web/tests/verify.test.ts lines 1959-2323 (2 sections).
//
// Both sections narrate a sequence of mutations where later checks build on
// the state left by earlier ones (no fresh()/createEditorStore() between
// them) — that's the original structure, not an artifact of the split. The
// nesting below mirrors that: each describe's beforeEach performs the next
// mutation in the story, and sibling its() only assert facts about the state
// as of their own nesting level.
import { beforeEach, describe, expect, it } from 'vitest';
import { parseSystem } from '@transitmapper/core/model/serialize';
import { haversineMeters } from '@transitmapper/core/model/geo';
import { findMismatchedTypeJunctions } from '@transitmapper/core/model/validate';
import { defaultProfileFor } from '@transitmapper/core/model/profile';
import type { TransitSystem } from '@transitmapper/core/model/system';
import { createEditorStore } from '../../src/editor/store';

function wayOf(id: string, typeId: string, points: [number, number][]) {
  return {
    id,
    typeId,
    points,
    geometry: 'straight' as const,
    grade: 'atGrade' as const,
    profile: defaultProfileFor(typeId),
  };
}

describe('Junction primitive: joinWayPointToWay forms a real shared-coordinate node, and every way-editing action keeps its refs in sync', () => {
  describe('joining two ways at a shared coordinate', () => {
    // Way A: a straight line the junction will land on mid-segment.
    // Way B ends exactly where A's midpoint is — join them.
    let store: ReturnType<typeof createEditorStore>;
    let wA: string;
    let wB: string;
    let s: TransitSystem;

    beforeEach(() => {
      store = createEditorStore();
      wA = store.getState().beginWay('lightRail', 'straight');
      store.getState().addWayPoint(wA, [-115.2, 36.1]);
      store.getState().addWayPoint(wA, [-115.1, 36.1]);
      store.getState().finishWay();
      wB = store.getState().beginWay('lightRail', 'straight');
      store.getState().addWayPoint(wB, [-115.15, 36.2]);
      store.getState().addWayPoint(wB, [-115.15, 36.1]);
      store.getState().finishWay();
      store.getState().joinWayPointToWay(wB, 1, wA, [-115.15, 36.1]);
      s = store.getState().system;
    });

    it('joinWayPointToWay inserts a real control point into the target way', () => {
      expect(s.ways.find((w) => w.id === wA)!.points.length).toBe(3);
    });

    it('the inserted point lands at the join coordinate', () => {
      expect(s.ways.find((w) => w.id === wA)!.points[1][0]).toBe(-115.15);
    });

    it('exactly one node was created', () => {
      expect(s.nodes.length).toBe(1);
    });

    it("the node links both ways' points", () => {
      const node = s.nodes[0];
      expect(node.refs.length).toBe(2);
      expect(node.refs.some((r) => r.wayId === wA)).toBe(true);
      expect(node.refs.some((r) => r.wayId === wB)).toBe(true);
    });

    // Moving the junction (on EITHER way) must cascade to the other — the exact
    // bug the plan doc calls out ("junctions silently desync when you edit them").
    describe('moving the shared point on way B', () => {
      let s2: TransitSystem;

      beforeEach(() => {
        store.getState().moveWayPoint(wB, 1, [-115.16, 36.05]);
        s2 = store.getState().system;
      });

      it('moving the shared point on one way also moves it on the other (no desync)', () => {
        expect(s2.ways.find((w) => w.id === wA)!.points[1][0]).toBe(-115.16);
        expect(s2.ways.find((w) => w.id === wB)!.points[1][0]).toBe(-115.16);
      });

      it("the node's own coord tracks the cascaded move too", () => {
        expect(s2.nodes[0].coord[0]).toBe(-115.16);
      });

      // Inserting a point earlier in way A must shift the node's ref index, not
      // leave it pointing at the wrong (now-shifted) point.
      describe('inserting a point earlier in way A', () => {
        let s3: TransitSystem;
        let wARef: TransitSystem['nodes'][number]['refs'][number];

        beforeEach(() => {
          store.getState().insertWayPoint(wA, 0, [-115.22, 36.09]);
          s3 = store.getState().system;
          wARef = s3.nodes[0].refs.find((r) => r.wayId === wA)!;
        });

        it("insertWayPoint shifts the node's ref index on that way", () => {
          expect(wARef.pointIndex).toBe(2);
        });

        it('the ref still points at the actual junction point after the shift', () => {
          expect(s3.ways.find((w) => w.id === wA)!.points[wARef.pointIndex][0]).toBe(-115.16);
        });

        // Deleting the OTHER end of way A (not the junction point) must not
        // disturb the node's ref into way A, only reindex it.
        describe('deleting the other end of way A', () => {
          let s4: TransitSystem;
          let wARef2: TransitSystem['nodes'][number]['refs'][number];

          beforeEach(() => {
            store.getState().deleteWayPoint(wA, 0);
            s4 = store.getState().system;
            wARef2 = s4.nodes[0].refs.find((r) => r.wayId === wA)!;
          });

          it("deleteWayPoint before the node's index shifts it back down", () => {
            expect(wARef2.pointIndex).toBe(1);
          });

          it('node survives an unrelated point deletion', () => {
            expect(s4.nodes.length).toBe(1);
          });

          // Deleting the junction's OWN point on one way should drop that way's
          // ref and, since only one ref remains, the node stops being a
          // junction at all. Way B needs a third point first: it's sitting at
          // exactly 2 right now, and deleting its junction end would ghost it —
          // deleteWayPoint refuses that (see store.ts), so way B is extended
          // before deleting its junction point.
          it('deleting the shared point on one way drops the node (no longer a real junction)', () => {
            store.getState().insertWayPoint(wB, 0, [-115.15, 36.25]);
            const s5 = store.getState().system;
            const wBRefIndex = s5.nodes[0].refs.find((r) => r.wayId === wB)!.pointIndex;
            store.getState().deleteWayPoint(wB, wBRefIndex);
            expect(store.getState().system.nodes.length).toBe(0);
          });
        });
      });
    });
  });

  // The same guard also protects a junction arm still at exactly 2 points:
  // deleting its only remaining non-junction point would ghost the way AND,
  // as a side effect, desync the junction — refused outright instead.
  describe('a junction arm with exactly 2 points', () => {
    let store: ReturnType<typeof createEditorStore>;
    let armB: string;

    beforeEach(() => {
      store = createEditorStore();
      const armA = store.getState().beginWay('lightRail', 'straight');
      store.getState().addWayPoint(armA, [-115.2, 36.1]);
      store.getState().addWayPoint(armA, [-115.1, 36.1]);
      store.getState().finishWay();
      armB = store.getState().beginWay('lightRail', 'straight');
      store.getState().addWayPoint(armB, [-115.15, 36.2]);
      store.getState().addWayPoint(armB, [-115.15, 36.1]);
      store.getState().finishWay();
      store.getState().joinWayPointToWay(armB, 1, armA, [-115.15, 36.1]);
    });

    it('setup: a fresh junction with a 2-point arm exists', () => {
      expect(store.getState().system.nodes.length).toBe(1);
    });

    it("deleting a junction arm's own point is refused when the arm has only 2", () => {
      store.getState().deleteWayPoint(armB, 1);
      const s = store.getState().system;
      expect(s.nodes.length).toBe(1);
      expect(s.ways.find((w) => w.id === armB)!.points.length).toBe(2);
    });
  });

  // deleteWay must strip any surviving refs to the removed way.
  describe('deleteWay on a way with a junction', () => {
    let store: ReturnType<typeof createEditorStore>;
    let wC: string;

    beforeEach(() => {
      store = createEditorStore();
      wC = store.getState().beginWay('lightRail', 'straight');
      store.getState().addWayPoint(wC, [-115.2, 36.1]);
      store.getState().addWayPoint(wC, [-115.1, 36.1]);
      store.getState().finishWay();
      const wD = store.getState().beginWay('lightRail', 'straight');
      store.getState().addWayPoint(wD, [-115.15, 36.2]);
      store.getState().addWayPoint(wD, [-115.15, 36.1]);
      store.getState().finishWay();
      store.getState().joinWayPointToWay(wD, 1, wC, [-115.15, 36.1]);
    });

    it('setup: node exists before delete', () => {
      expect(store.getState().system.nodes.length).toBe(1);
    });

    it('deleteWay removes the node once its junction partner is gone', () => {
      store.getState().deleteWay(wC);
      expect(store.getState().system.nodes.length).toBe(0);
    });
  });

  // v3→v4 migration derives nodes from raw coordinate coincidence when a
  // loaded system has no explicit nodes field.
  it('migrated v3 data derives a node from coincident way endpoints', () => {
    const legacyRound = parseSystem({
      version: 3,
      id: 'x',
      name: 'x',
      viewport: { center: [-115, 36], zoom: 10 },
      createdAt: 1,
      updatedAt: 1,
      ways: [
        {
          id: 'p',
          typeId: 'lightRail',
          points: [
            [-115.2, 36.1],
            [-115.1, 36.1],
          ],
          geometry: 'straight',
        },
        {
          id: 'q',
          typeId: 'lightRail',
          points: [
            [-115.1, 36.1],
            [-115.1, 36.2],
          ],
          geometry: 'straight',
        },
      ],
      services: [],
      stations: [],
      facilities: [],
      groups: [],
    });
    expect(legacyRound.nodes.length).toBe(1);
    expect(legacyRound.nodes[0].refs.length).toBe(2);
  });

  // A system round-tripped through JSON keeps its explicit v4 nodes intact.
  it('v4 round-trip preserves the explicit node', () => {
    const store = createEditorStore();
    const wE = store.getState().beginWay('lightRail', 'straight');
    store.getState().addWayPoint(wE, [-115.2, 36.1]);
    store.getState().addWayPoint(wE, [-115.1, 36.1]);
    store.getState().finishWay();
    const wF = store.getState().beginWay('lightRail', 'straight');
    store.getState().addWayPoint(wF, [-115.15, 36.2]);
    store.getState().addWayPoint(wF, [-115.15, 36.1]);
    store.getState().finishWay();
    store.getState().joinWayPointToWay(wF, 1, wE, [-115.15, 36.1]);
    const v4Round = parseSystem(JSON.parse(JSON.stringify(store.getState().system)));
    expect(v4Round.nodes.length).toBe(1);
    expect(v4Round.nodes[0].refs.length).toBe(2);
  });
});

describe('Disconnecting a junction: disconnectNodeWay takes one way out and leaves nothing sharing the coordinate', () => {
  // A 2-arm junction: the crossing corridor's end joined onto a through way.
  describe('a 2-arm junction', () => {
    let store: ReturnType<typeof createEditorStore>;
    let through: string;
    let spur: string;
    let stayingPoint: [number, number];
    let s: TransitSystem;

    beforeEach(() => {
      store = createEditorStore();
      through = store.getState().beginWay('lightRail', 'straight');
      store.getState().addWayPoint(through, [-115.2, 36.1]);
      store.getState().addWayPoint(through, [-115.1, 36.1]);
      store.getState().finishWay();
      spur = store.getState().beginWay('lightRail', 'straight');
      store.getState().addWayPoint(spur, [-115.15, 36.2]);
      store.getState().addWayPoint(spur, [-115.15, 36.1]);
      store.getState().finishWay();
      store.getState().joinWayPointToWay(spur, 1, through, [-115.15, 36.1]);

      const junctionId = store.getState().system.nodes[0].id;
      stayingPoint = store
        .getState()
        .system.ways.find((w) => w.id === through)!
        .points[1].slice() as [number, number];
      store.getState().select({ kind: 'node', id: junctionId });
      store.getState().disconnectNodeWay(junctionId, spur);
      s = store.getState().system;
    });

    it('disconnecting one of two arms deletes the junction outright', () => {
      expect(s.nodes.length).toBe(0);
    });

    it('the disconnected way stops sharing the coordinate', () => {
      const movedEnd = s.ways.find((w) => w.id === spur)!.points[1];
      expect(haversineMeters(movedEnd, stayingPoint)).toBeGreaterThan(10);
    });

    it("the arm that stayed didn't move", () => {
      const throughPoint = s.ways.find((w) => w.id === through)!.points[1];
      expect(throughPoint[0]).toBe(stayingPoint[0]);
      expect(throughPoint[1]).toBe(stayingPoint[1]);
    });

    it('the selection clears with the junction it pointed at', () => {
      expect(store.getState().selection).toBeNull();
    });
  });

  // A 3-arm junction sheds one arm and keeps standing, taking that arm's
  // lane connectors with it — a connector naming a way that no longer meets
  // here would break junctionGeometry.
  describe('a 3-arm junction', () => {
    let store: ReturnType<typeof createEditorStore>;
    let main: string;
    let north: string;
    let south: string;
    let s: TransitSystem;
    let threeArm: TransitSystem['nodes'][number];

    beforeEach(() => {
      store = createEditorStore();
      main = store.getState().beginWay('lightRail', 'straight');
      store.getState().addWayPoint(main, [-115.2, 36.1]);
      store.getState().addWayPoint(main, [-115.1, 36.1]);
      store.getState().finishWay();
      north = store.getState().beginWay('lightRail', 'straight');
      store.getState().addWayPoint(north, [-115.15, 36.2]);
      store.getState().addWayPoint(north, [-115.15, 36.1]);
      store.getState().finishWay();
      south = store.getState().beginWay('lightRail', 'straight');
      store.getState().addWayPoint(south, [-115.15, 36.0]);
      store.getState().addWayPoint(south, [-115.15, 36.1]);
      store.getState().finishWay();
      store.getState().joinWayPointToWay(north, 1, main, [-115.15, 36.1]);
      store.getState().joinWayPointToWay(south, 1, main, [-115.15, 36.1]);

      s = store.getState().system;
      threeArm = s.nodes[0];
    });

    it('setup: all three ways meet at one junction', () => {
      expect(threeArm.refs.length).toBe(3);
    });

    describe('shedding the south arm', () => {
      let s2: TransitSystem;

      beforeEach(() => {
        const laneOf = (wayId: string) => s.ways.find((w) => w.id === wayId)!.profile.lanes[0].id;
        store.getState().setNodeConnectors(threeArm.id, [
          {
            from: { wayId: south, laneId: laneOf(south) },
            to: { wayId: north, laneId: laneOf(north) },
          },
          {
            from: { wayId: north, laneId: laneOf(north) },
            to: { wayId: main, laneId: laneOf(main) },
          },
        ]);
        store.getState().disconnectNodeWay(threeArm.id, south);
        s2 = store.getState().system;
      });

      it('a 3-arm junction survives shedding one arm', () => {
        expect(s2.nodes.length).toBe(1);
      });

      it('the remaining arms keep their refs', () => {
        expect(s2.nodes[0].refs.length).toBe(2);
        expect(s2.nodes[0].refs.some((r) => r.wayId === south)).toBe(false);
      });

      it('connectors naming the disconnected way are pruned', () => {
        expect((s2.nodes[0].connectors ?? []).length).toBe(1);
        expect(s2.nodes[0].connectors![0].from.wayId).toBe(north);
      });

      it('the shed arm is nudged clear of the junction that stayed', () => {
        expect(
          haversineMeters(s2.ways.find((w) => w.id === south)!.points[1], s2.nodes[0].coord),
        ).toBeGreaterThan(10);
      });
    });
  });

  // The bug this primitive exists for: drawing a road across a rail line no
  // longer wires them into one junction on commit.
  it('a road drawn across a rail line forms no junction', () => {
    const store = createEditorStore();
    const rail = store.getState().beginWay('lightRail', 'straight');
    store.getState().addWayPoint(rail, [-115.2, 36.1]);
    store.getState().addWayPoint(rail, [-115.1, 36.1]);
    store.getState().finishWay();
    const road = store.getState().beginWay('road', 'straight');
    store.getState().addWayPoint(road, [-115.15, 36.05]);
    store.getState().addWayPoint(road, [-115.15, 36.15]);
    store.getState().finishWay();
    expect(store.getState().system.nodes.length).toBe(0);
  });

  // An import that claims a junction between a road and a rail line does not
  // get one: nothing repairs it later, because it never lands. What survives
  // is the pair of same-kind arms, if there are two of them.
  describe('an import claiming a road/rail junction', () => {
    let store: ReturnType<typeof createEditorStore>;

    beforeEach(() => {
      store = createEditorStore();
      store.getState().importWays({
        ways: [
          wayOf('mixed-road-west', 'road', [
            [-115.2, 36.1],
            [-115.15, 36.1],
          ]),
          wayOf('mixed-road-east', 'road', [
            [-115.15, 36.1],
            [-115.1, 36.1],
          ]),
          wayOf('mixed-rail', 'lightRail', [
            [-115.15, 36.05],
            [-115.15, 36.1],
          ]),
        ],
        nodes: [
          {
            id: 'mixed-junction',
            coord: [-115.15, 36.1],
            refs: [
              { wayId: 'mixed-road-west', pointIndex: 1 },
              { wayId: 'mixed-road-east', pointIndex: 0 },
              { wayId: 'mixed-rail', pointIndex: 1 },
            ],
          },
        ],
        namedWays: [],
        medians: [],
        turnRestrictions: [],
      });
    });

    it('importing a road-and-rail junction leaves no mismatched junction behind', () => {
      expect(findMismatchedTypeJunctions(store.getState().system).length).toBe(0);
    });

    it('the two road arms keep their junction', () => {
      const s = store.getState().system;
      expect(s.nodes.length).toBe(1);
      expect(s.nodes[0].refs.every((r) => r.wayId.startsWith('mixed-road'))).toBe(true);
    });

    it('and the rail line is left where it was, crossing without joining', () => {
      expect(store.getState().system.ways.find((w) => w.id === 'mixed-rail')!.points[1][1]).toBe(
        36.1,
      );
    });
  });

  // The same rule keeps a bike path joined to the street it meets: both are
  // in the street junction group, and a cyclist really does turn there.
  it('a bike path keeps the junction where it meets a street', () => {
    const store = createEditorStore();
    store.getState().importWays({
      ways: [
        wayOf('bike-street-west', 'road', [
          [-115.2, 36.1],
          [-115.15, 36.1],
        ]),
        wayOf('bike-path', 'bike', [
          [-115.15, 36.05],
          [-115.15, 36.1],
        ]),
      ],
      nodes: [
        {
          id: 'bike-junction',
          coord: [-115.15, 36.1],
          refs: [
            { wayId: 'bike-street-west', pointIndex: 1 },
            { wayId: 'bike-path', pointIndex: 1 },
          ],
        },
      ],
      namedWays: [],
      medians: [],
      turnRestrictions: [],
    });
    expect(store.getState().system.nodes.length).toBe(1);
  });
});
