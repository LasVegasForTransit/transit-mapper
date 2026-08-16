import { beforeEach, describe, expect, it } from 'vitest';
import { pointAtT, resolveWayPath } from '@transitmapper/core/model/geo';
import type { LngLat, TransitSystem } from '@transitmapper/core/model/system';
import type { SelectionAction } from '@transitmapper/core/model/selectionActions';
import { createEditorStore } from '../../src/editor/store';
import { createSelectionActions } from '../../src/editor/actions';

type Store = ReturnType<typeof createEditorStore>;

function must<T>(value: T | undefined | null): T {
  if (value == null) throw new Error('expected a defined value');
  return value;
}

describe('multi-way group-drag: nudging 2+ selected ways in one batch reanchors each station against its OWN anchor way (updateWayPointsBatch)', () => {
  let store: Store, wayA: string, wayB: string, stOnA: string;

  beforeEach(() => {
    store = createEditorStore();
    wayA = store.getState().beginWay('lightRail', 'straight'); // E-W
    store.getState().addWayPoint(wayA, [-115.2, 36.1]);
    store.getState().addWayPoint(wayA, [-115.1, 36.1]);
    store.getState().finishWay();
    wayB = store.getState().beginWay('lightRail', 'straight'); // N-S: shaped
    store.getState().addWayPoint(wayB, [-115.3, 36.3]); // differently than wayA so a
    store.getState().addWayPoint(wayB, [-115.3, 36.0]); // wrong-way reanchor is obvious.
    store.getState().finishWay();
    stOnA = store.getState().addStation([-115.15, 36.1], { wayId: wayA, t: 0.5 });
    store.getState().toggleMultiSelect({ kind: 'way', id: wayA });
    store.getState().toggleMultiSelect({ kind: 'way', id: wayB });
  });

  it('both ways are in the group', () => {
    expect(store.getState().multiSelection).toHaveLength(2);
  });

  describe('nudging both selected ways', () => {
    let before: TransitSystem;

    beforeEach(() => {
      before = store.getState().system;
      store.getState().nudgeMultiSelection(0.02, -0.03);
    });

    it('wayA moved by the nudge delta', () => {
      const newWayA = must(store.getState().system.ways.find((w) => w.id === wayA));
      expect(newWayA.points[0][0]).toBe(
        must(before.ways.find((w) => w.id === wayA)).points[0][0] + 0.02,
      );
    });

    it('wayB moved by the nudge delta too', () => {
      const newWayB = must(store.getState().system.ways.find((w) => w.id === wayB));
      expect(newWayB.points[0][1]).toBe(
        must(before.ways.find((w) => w.id === wayB)).points[0][1] - 0.03,
      );
    });

    it("a station anchored to one way in a multi-way batch follows THAT way's new path", () => {
      const s = store.getState().system;
      const expectedOnA = pointAtT(resolveWayPath(must(s.ways.find((w) => w.id === wayA))), 0.5);
      const actual = must(s.stations.find((st) => st.id === stOnA)).coord;
      expect(Math.abs(actual[0] - expectedOnA[0])).toBeLessThan(1e-9);
      expect(Math.abs(actual[1] - expectedOnA[1])).toBeLessThan(1e-9);
    });

    it("…not the other selected way's path (they're shaped differently enough to tell apart)", () => {
      const s = store.getState().system;
      const wrongOnB = pointAtT(resolveWayPath(must(s.ways.find((w) => w.id === wayB))), 0.5);
      const actual = must(s.stations.find((st) => st.id === stOnA)).coord;
      expect(
        Math.abs(actual[0] - wrongOnB[0]) > 1e-6 || Math.abs(actual[1] - wrongOnB[1]) > 1e-6,
      ).toBe(true);
    });
  });
});

describe("extending a way's endpoint must not move stations anchored earlier on it (t is a fraction of TOTAL length)", () => {
  let store: Store, w: string, midStation: string, before: LngLat;

  beforeEach(() => {
    store = createEditorStore();
    w = store.getState().beginWay('lightRail', 'straight');
    store.getState().addWayPoint(w, [-115.2, 36.1]);
    store.getState().addWayPoint(w, [-115.1, 36.1]);
    store.getState().finishWay();
    midStation = store.getState().addStation([-115.15, 36.1], { wayId: w, t: 0.5 });
    before = must(store.getState().system.stations.find((s) => s.id === midStation)).coord;
  });

  describe('extending the far endpoint once', () => {
    beforeEach(() => {
      store.getState().addWayPoint(w, [-115.0, 36.1]);
    });

    it("extending a way's endpoint does not move a station anchored earlier on the way", () => {
      const after = must(store.getState().system.stations.find((s) => s.id === midStation));
      expect(Math.abs(after.coord[0] - before[0])).toBeLessThan(1e-9);
      expect(Math.abs(after.coord[1] - before[1])).toBeLessThan(1e-9);
    });

    it("extending a way's endpoint updates the station's stored t, not just its coord", () => {
      const after = must(store.getState().system.stations.find((s) => s.id === midStation));
      expect(must(after.anchors.find((a) => a.wayId === w)).t).toBeLessThan(0.5);
    });

    describe('extending again', () => {
      beforeEach(() => {
        store.getState().addWayPoint(w, [-114.9, 36.1]);
      });

      it("a second endpoint extension still preserves the station's absolute position", () => {
        const after = must(store.getState().system.stations.find((s) => s.id === midStation)).coord;
        expect(Math.abs(after[0] - before[0])).toBeLessThan(1e-9);
        expect(Math.abs(after[1] - before[1])).toBeLessThan(1e-9);
      });
    });
  });
});

describe('a duplicate street offers its own way out', () => {
  let store: Store, road: string;

  beforeEach(() => {
    store = createEditorStore();
    store.getState().setDraftServiceEnabled(false);
    road = store.getState().beginWay('road', 'straight');
    store.getState().addWayPoint(road, [-115.2, 36.1]);
    store.getState().addWayPoint(road, [-115.1, 36.1]);
    store.getState().finishWay();
    // A second street laid alongside it, carrying a line — what a stroke drawn
    // just outside snapping range leaves behind.
    store.getState().setDraftServiceEnabled(true);
    const beside = store.getState().beginWay('road', 'straight');
    store.getState().addWayPoint(beside, [-115.19, 36.10028]);
    store.getState().addWayPoint(beside, [-115.11, 36.10028]);
    store.getState().finishWay();
  });

  it('the duplicate survived drawing', () => {
    expect(store.getState().system.ways).toHaveLength(2);
  });

  describe('the merge action', () => {
    let merge: SelectionAction | undefined;

    beforeEach(() => {
      const registry = createSelectionActions(store);
      const duplicate = must(store.getState().system.ways.find((w) => w.id !== road));
      merge = registry
        .actionsFor({ system: store.getState().system, refs: [{ kind: 'way', id: duplicate.id }] })
        .find((a) => a.id === 'way.mergeIntoNeighbour');
    });

    it('one selected street running alongside another offers to merge into it', () => {
      expect(merge).toBeDefined();
    });

    describe('after merging', () => {
      beforeEach(() => {
        must(merge).run();
      });

      it('and merging leaves a single street', () => {
        expect(store.getState().system.ways).toHaveLength(1);
      });
    });
  });
});

describe('picking up the Lines tool drops an infrastructure selection', () => {
  let store: Store;

  beforeEach(() => {
    store = createEditorStore();
    const w = store.getState().beginWay('lightRail', 'straight');
    store.getState().addWayPoint(w, [-115.2, 36.1]);
    store.getState().addWayPoint(w, [-115.1, 36.1]);
    store.getState().finishWay();
    const svc = store.getState().system.services[0].id;
    store.getState().setTool('select');
    store.getState().toggleMultiSelect({ kind: 'way', id: w });
    store.getState().toggleMultiSelect({ kind: 'service', id: svc });
  });

  it('the group holds both kinds first', () => {
    expect(store.getState().multiSelection).toHaveLength(2);
  });

  describe('switching to the Lines tool', () => {
    beforeEach(() => {
      store.getState().setTool('lines');
    });

    it('the Lines tool keeps only the lines, so its marquee cannot build a group nothing applies to', () => {
      expect(store.getState().multiSelection).toHaveLength(1);
      expect(store.getState().multiSelection[0].kind).toBe('service');
    });
  });
});

describe('connect at crossing: two streets drawn across each other with nothing joining them get a real junction, and only with the way that was picked', () => {
  let store: Store, ns: string;

  beforeEach(() => {
    store = createEditorStore();
    ns = store.getState().beginWay('road', 'straight');
    store.getState().addWayPoint(ns, [-115.2, 36.0]);
    store.getState().addWayPoint(ns, [-115.2, 36.2]);
    store.getState().finishWay();
  });

  it('one selected way alone offers no merge', () => {
    const registry = createSelectionActions(store);
    expect(
      registry
        .actionsFor({ system: store.getState().system, refs: [{ kind: 'way', id: ns }] })
        .some((action) => action.id.startsWith('way.')),
    ).toBe(false);
  });

  it('an empty selection offers nothing at all', () => {
    const registry = createSelectionActions(store);
    const refs = store.getState().multiSelection;
    expect(registry.actionsFor({ system: store.getState().system, refs })).toHaveLength(0);
  });
});
