import { beforeEach, describe, expect, it } from 'vitest';
import { pointAtT, resolveWayPath } from '@transitmapper/core/model/geo';
import type { LngLat, TransitSystem } from '@transitmapper/core/model/system';
import type { SelectionAction } from '@transitmapper/core/model/selectionActions';
import { createEditorStore } from '../../src/editor/store';
import { createSelectionActions } from '../../src/editor/actions';
import { required } from '../support/required.test';

type Store = ReturnType<typeof createEditorStore>;

function must<T>(value: T | undefined | null): T {
  if (value == null) throw new Error('expected a defined value');
  return value;
}

describe('nudging two or more selected ways at once reanchors each stop against its own anchor way', () => {
  let store: Store, wayA: string, wayB: string, stOnA: string;

  beforeEach(() => {
    store = createEditorStore();
    wayA = required(store.commands.ways.beginWay('lightRail', 'straight')); // E-W
    store.commands.ways.addWayPoint(wayA, [-115.2, 36.1]);
    store.commands.ways.addWayPoint(wayA, [-115.1, 36.1]);
    store.commands.ways.finishWay();
    wayB = required(store.commands.ways.beginWay('lightRail', 'straight')); // N-S: shaped
    store.commands.ways.addWayPoint(wayB, [-115.3, 36.3]); // differently than wayA so a
    store.commands.ways.addWayPoint(wayB, [-115.3, 36.0]); // wrong-way reanchor is obvious.
    store.commands.ways.finishWay();
    stOnA = required(store.commands.stops.addStop([-115.15, 36.1], { wayId: wayA, t: 0.5 }));
    store.commands.selection.toggleMultiSelect({ kind: 'way', id: wayA });
    store.commands.selection.toggleMultiSelect({ kind: 'way', id: wayB });
  });

  it('both ways are in the group', () => {
    expect(store.getState().multiSelection).toHaveLength(2);
  });

  describe('nudging both selected ways', () => {
    let before: TransitSystem;

    beforeEach(() => {
      before = store.getState().system;
      store.commands.selection.nudgeMultiSelection(0.02, -0.03);
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

    it("a stop anchored to one of the two ways follows that way's new path", () => {
      const s = store.getState().system;
      const expectedOnA = pointAtT(resolveWayPath(must(s.ways.find((w) => w.id === wayA))), 0.5);
      const actual = must(s.stops.find((st) => st.id === stOnA)).coord;
      expect(Math.abs(actual[0] - expectedOnA[0])).toBeLessThan(1e-9);
      expect(Math.abs(actual[1] - expectedOnA[1])).toBeLessThan(1e-9);
    });

    it("…not the other selected way's path (they're shaped differently enough to tell apart)", () => {
      const s = store.getState().system;
      const wrongOnB = pointAtT(resolveWayPath(must(s.ways.find((w) => w.id === wayB))), 0.5);
      const actual = must(s.stops.find((st) => st.id === stOnA)).coord;
      expect(
        Math.abs(actual[0] - wrongOnB[0]) > 1e-6 || Math.abs(actual[1] - wrongOnB[1]) > 1e-6,
      ).toBe(true);
    });
  });
});

describe("extending a way's endpoint does not move stops anchored earlier on it, because their position is stored as a fraction of the way's total length", () => {
  let store: Store, w: string, midStation: string, before: LngLat;

  beforeEach(() => {
    store = createEditorStore();
    w = required(store.commands.ways.beginWay('lightRail', 'straight'));
    store.commands.ways.addWayPoint(w, [-115.2, 36.1]);
    store.commands.ways.addWayPoint(w, [-115.1, 36.1]);
    store.commands.ways.finishWay();
    midStation = required(store.commands.stops.addStop([-115.15, 36.1], { wayId: w, t: 0.5 }));
    before = must(store.getState().system.stops.find((s) => s.id === midStation)).coord;
  });

  describe('extending the far endpoint once', () => {
    beforeEach(() => {
      store.commands.ways.addWayPoint(w, [-115.0, 36.1]);
    });

    it("extending a way's endpoint does not move a stop anchored earlier on the way", () => {
      const after = must(store.getState().system.stops.find((s) => s.id === midStation));
      expect(Math.abs(after.coord[0] - before[0])).toBeLessThan(1e-9);
      expect(Math.abs(after.coord[1] - before[1])).toBeLessThan(1e-9);
    });

    it("extending a way's endpoint updates the stop's stored t, not just its coord", () => {
      const after = must(store.getState().system.stops.find((s) => s.id === midStation));
      expect(must(after.anchors.find((a) => a.wayId === w)).t).toBeLessThan(0.5);
    });

    describe('extending again', () => {
      beforeEach(() => {
        store.commands.ways.addWayPoint(w, [-114.9, 36.1]);
      });

      it("a second endpoint extension still preserves the stop's absolute position", () => {
        const after = must(store.getState().system.stops.find((s) => s.id === midStation)).coord;
        expect(Math.abs(after[0] - before[0])).toBeLessThan(1e-9);
        expect(Math.abs(after[1] - before[1])).toBeLessThan(1e-9);
      });
    });
  });
});

describe('a duplicate street drawn alongside another offers to merge into it', () => {
  let store: Store, road: string;

  beforeEach(() => {
    store = createEditorStore();
    store.commands.tools.setDraftServiceEnabled(false);
    road = required(store.commands.ways.beginWay('road', 'straight'));
    store.commands.ways.addWayPoint(road, [-115.2, 36.1]);
    store.commands.ways.addWayPoint(road, [-115.1, 36.1]);
    store.commands.ways.finishWay();
    // A second street laid alongside it, carrying a line — what a stroke drawn
    // just outside snapping range leaves behind.
    store.commands.tools.setDraftServiceEnabled(true);
    const beside = required(store.commands.ways.beginWay('road', 'straight'));
    store.commands.ways.addWayPoint(beside, [-115.19, 36.10028]);
    store.commands.ways.addWayPoint(beside, [-115.11, 36.10028]);
    store.commands.ways.finishWay();
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

      it('merging leaves a single street', () => {
        expect(store.getState().system.ways).toHaveLength(1);
      });
    });
  });
});

describe('switching to the Lines tool keeps only lines in the selection', () => {
  let store: Store;

  beforeEach(() => {
    store = createEditorStore();
    const w = required(store.commands.ways.beginWay('lightRail', 'straight'));
    store.commands.ways.addWayPoint(w, [-115.2, 36.1]);
    store.commands.ways.addWayPoint(w, [-115.1, 36.1]);
    store.commands.ways.finishWay();
    const line = store.getState().system.lines[0].id;
    store.commands.tools.setTool('select');
    store.commands.selection.toggleMultiSelect({ kind: 'way', id: w });
    store.commands.selection.toggleMultiSelect({ kind: 'line', id: line });
  });

  it('the group holds both kinds first', () => {
    expect(store.getState().multiSelection).toHaveLength(2);
  });

  describe('switching to the Lines tool', () => {
    beforeEach(() => {
      store.commands.tools.setTool('lines');
    });

    it("the way drops out of the selection, since the Lines tool's marquee only ever selects lines", () => {
      expect(store.getState().multiSelection).toHaveLength(1);
      expect(store.getState().multiSelection[0].kind).toBe('line');
    });
  });
});

describe('way-level actions need more context than a single way, or no selection at all', () => {
  let store: Store, ns: string;

  beforeEach(() => {
    store = createEditorStore();
    ns = required(store.commands.ways.beginWay('road', 'straight'));
    store.commands.ways.addWayPoint(ns, [-115.2, 36.0]);
    store.commands.ways.addWayPoint(ns, [-115.2, 36.2]);
    store.commands.ways.finishWay();
  });

  it('a single selected way offers no way-level action at all', () => {
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
