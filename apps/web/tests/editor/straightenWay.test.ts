import { beforeEach, describe, expect, it } from 'vitest';
import { createEditorStore } from '../../src/editor/store';
import type { Way } from '@transitmapper/core/model/system';
import { required } from '../support/required.test';

describe('store: straightenWay', () => {
  let store: ReturnType<typeof createEditorStore>;

  beforeEach(() => {
    store = createEditorStore();
  });

  function mustFindWay(id: string): Way {
    const way = store.getState().system.ways.find((w) => w.id === id);
    if (!way) throw new Error(`expected way ${id} to exist`);
    return way;
  }

  it('straighten drops the non-junction intermediate point', () => {
    const w = required(store.commands.ways.beginWay('road', 'straight'));
    store.commands.ways.addWayPoint(w, [-115.2, 36.1]);
    store.commands.ways.addWayPoint(w, [-115.17, 36.13]); // a wobble off the straight line
    store.commands.ways.addWayPoint(w, [-115.1, 36.1]);
    store.commands.ways.finishWay();
    store.commands.ways.straightenWay(w);
    const straightened = mustFindWay(w);
    expect(straightened.points.length).toBe(2);
  });

  it('straighten keeps the original endpoints', () => {
    const w = required(store.commands.ways.beginWay('road', 'straight'));
    store.commands.ways.addWayPoint(w, [-115.2, 36.1]);
    store.commands.ways.addWayPoint(w, [-115.17, 36.13]); // a wobble off the straight line
    store.commands.ways.addWayPoint(w, [-115.1, 36.1]);
    store.commands.ways.finishWay();
    store.commands.ways.straightenWay(w);
    const straightened = mustFindWay(w);
    expect(straightened.points[0][0]).toBe(-115.2);
    expect(straightened.points[1][0]).toBe(-115.1);
  });

  describe('a junction at the wobble point', () => {
    // A junction at the wobble point must survive straightening — the other
    // way's coincident control point can't be silently orphaned.
    function buildGuardedJunction() {
      const wB = required(store.commands.ways.beginWay('road', 'straight'));
      store.commands.ways.addWayPoint(wB, [-115.2, 36.1]);
      store.commands.ways.addWayPoint(wB, [-115.17, 36.13]);
      store.commands.ways.addWayPoint(wB, [-115.1, 36.1]);
      store.commands.ways.finishWay();
      const wC = required(store.commands.ways.beginWay('road', 'straight'));
      store.commands.ways.addWayPoint(wC, [-115.17, 36.13]);
      store.commands.ways.addWayPoint(wC, [-115.17, 36.2]);
      store.commands.ways.finishWay();
      store.commands.ways.joinWayPointToWay(wC, 0, wB, [-115.17, 36.13]);
      store.commands.ways.straightenWay(wB);
      return { wB, wC };
    }

    it("straighten keeps a point that's a real junction", () => {
      const { wB } = buildGuardedJunction();
      const guarded = mustFindWay(wB);
      expect(guarded.points.length).toBe(3);
    });

    it('the junction node is still intact after straightening', () => {
      const { wB, wC } = buildGuardedJunction();
      expect(
        store
          .getState()
          .system.nodes.some(
            (n) => n.refs.some((r) => r.wayId === wB) && n.refs.some((r) => r.wayId === wC),
          ),
      ).toBe(true);
    });
  });
});
