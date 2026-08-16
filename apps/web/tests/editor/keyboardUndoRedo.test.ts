import { beforeEach, describe, expect, it } from 'vitest';
import { createEditorStore } from '../../src/editor/store';
import { FINE_POINTER_TUNING } from '../../src/editor/input-tuning';
import { KEY_BINDINGS, matchesKey, resolveBinding, type KeyContext } from '../../src/editor/keymap';

function evt(o: Partial<KeyboardEvent>): KeyboardEvent {
  return o as KeyboardEvent;
}

function buildCtx(store: ReturnType<typeof createEditorStore>): KeyContext {
  return {
    map: { panBy() {}, zoomTo() {}, getZoom: () => 10 },
    editor: store,
    setPanKeyHeld() {},
    tuning: FINE_POINTER_TUNING,
    openShortcuts() {},
    toggleUi() {},
  } as unknown as KeyContext;
}

describe('keyboard: matcher, resolver, command execution, gating', () => {
  let store: ReturnType<typeof createEditorStore>;
  let ctx: KeyContext;

  beforeEach(() => {
    store = createEditorStore();
    ctx = buildCtx(store);
  });

  it('matchesKey is case-insensitive & reserves Ctrl', () => {
    expect(matchesKey(evt({ key: 'V' }), 'v')).toBe(true);
    expect(matchesKey(evt({ key: 'c', ctrlKey: true }), 'c')).toBe(false);
  });

  it('Escape command stops the current way draw', () => {
    store.getState().setTool('way');
    const wayId = store.getState().beginWay('road', 'straight');
    store.getState().addWayPoint(wayId, [-115.2, 36.1]);
    store.getState().addWayPoint(wayId, [-115.1, 36.1]);

    resolveBinding(KEY_BINDINGS, evt({ key: 'Escape' }), ctx)?.run(ctx);

    expect(store.getState().activeWayId).toBeNull();
  });

  it("'l' selects the way tool", () => {
    resolveBinding(KEY_BINDINGS, evt({ key: 'l' }), ctx)?.run(ctx);

    expect(store.getState().tool).toBe('way');
  });

  it('way-tool binding gated in read-only', () => {
    store.getState().setSystem(store.getState().system, { readOnly: true });

    expect(resolveBinding(KEY_BINDINGS, evt({ key: 'l' }), ctx)).toBeNull();
  });
});

describe('undo/redo: basic push/pop, redo invalidation, readOnly/empty guards', () => {
  let store: ReturnType<typeof createEditorStore>;

  beforeEach(() => {
    store = createEditorStore();
  });

  it('fresh system starts with nothing to undo/redo', () => {
    expect(store.getState().canUndo).toBe(false);
    expect(store.getState().canRedo).toBe(false);
  });

  it('adding a station is undoable', () => {
    store.getState().addStation([-115.2, 36.1]);

    expect(store.getState().canUndo).toBe(true);
  });

  it('undo removes the station', () => {
    const stationId = store.getState().addStation([-115.2, 36.1]);

    store.getState().undo();

    expect(store.getState().system.stations.some((s) => s.id === stationId)).toBe(false);
  });

  it('undo clears selection (avoids pointing at a gone/stale object)', () => {
    store.getState().addStation([-115.2, 36.1]);

    store.getState().undo();

    expect(store.getState().selection).toBeNull();
  });

  it('undoing the only step leaves nothing left to undo', () => {
    store.getState().addStation([-115.2, 36.1]);

    store.getState().undo();

    expect(store.getState().canUndo).toBe(false);
  });

  it('undo makes a redo available', () => {
    store.getState().addStation([-115.2, 36.1]);

    store.getState().undo();

    expect(store.getState().canRedo).toBe(true);
  });

  it('redo restores the station', () => {
    const stationId = store.getState().addStation([-115.2, 36.1]);
    store.getState().undo();

    store.getState().redo();

    expect(store.getState().system.stations.some((s) => s.id === stationId)).toBe(true);
  });

  it('redoing the only step leaves nothing left to redo', () => {
    store.getState().addStation([-115.2, 36.1]);
    store.getState().undo();

    store.getState().redo();

    expect(store.getState().canRedo).toBe(false);
  });

  it('a new action after undo clears the redo stack', () => {
    store.getState().addStation([-115.2, 36.1]);
    store.getState().undo();

    store.getState().addStation([-115.3, 36.2]); // a fresh action after undo invalidates redo

    expect(store.getState().canRedo).toBe(false);
  });

  it('undo on an empty stack is a no-op, not a crash', () => {
    store.getState().undo();

    expect(store.getState().canUndo).toBe(false);
  });

  it('loading a system (even the same one) resets history', () => {
    store.getState().addStation([-115.2, 36.1]);

    store.getState().setSystem(store.getState().system, { readOnly: true });

    expect(store.getState().canUndo).toBe(false);
    expect(store.getState().canRedo).toBe(false);
  });

  // Regression: setViewport (camera pan/zoom, persisted on the system for
  // sharing) must NOT create an undo step — otherwise every pan buries real
  // edits under viewport noise, and pressing Ctrl+Z mostly just un-pans.
  it('panning alone starts with nothing to undo', () => {
    expect(store.getState().canUndo).toBe(false);
  });

  it('setViewport does not create an undo step', () => {
    store.getState().setViewport({ center: [-115.5, 36.5], zoom: 12 });

    expect(store.getState().canUndo).toBe(false);
  });

  it('a real edit after panning is still undoable', () => {
    store.getState().setViewport({ center: [-115.5, 36.5], zoom: 12 });

    store.getState().addStation([-115.2, 36.1]);

    expect(store.getState().canUndo).toBe(true);
  });

  it("panning after a real edit doesn't add a second (viewport) undo step", () => {
    store.getState().addStation([-115.2, 36.1]);
    store.getState().setViewport({ center: [-115.6, 36.6], zoom: 13 });

    let steps = 0;
    while (store.getState().canUndo) {
      store.getState().undo();
      steps++;
    }

    expect(steps).toBe(1);
  });
});

describe('undo/redo must not exit draw mode: activeWayId only clears once the way it points at is genuinely gone, not on every undo/redo', () => {
  let store: ReturnType<typeof createEditorStore>;
  let w: string;

  beforeEach(() => {
    store = createEditorStore();
    w = store.getState().beginWay('road', 'straight');
    store.getState().addWayPoint(w, [-115.2, 36.1]);
    store.getState().addWayPoint(w, [-115.15, 36.1]);
  });

  it('drawing sets activeWayId to the way being drawn', () => {
    expect(store.getState().activeWayId).toBe(w);
  });

  it('undoing one point of an in-progress way keeps activeWayId set', () => {
    store.getState().undo();

    expect(store.getState().activeWayId).toBe(w);
  });

  it('undo removed only the last point', () => {
    store.getState().undo();

    const way = store.getState().system.ways.find((x) => x.id === w);
    expect(way?.points).toHaveLength(1);
  });

  it('redo mirrors undo: activeWayId survives while the way still exists', () => {
    store.getState().undo();

    store.getState().redo();

    const way = store.getState().system.ways.find((x) => x.id === w);
    expect(store.getState().activeWayId).toBe(w);
    expect(way?.points).toHaveLength(2);
  });

  it('a way undone back to zero points still counts as existing', () => {
    store.getState().undo();
    store.getState().redo();

    store.getState().undo(); // back to 1 point
    store.getState().undo(); // back to the way existing with 0 points (still "exists")

    expect(store.getState().activeWayId).toBe(w);
  });

  it("undoing past a way's own creation clears activeWayId", () => {
    store.getState().undo();
    store.getState().redo();
    store.getState().undo();
    store.getState().undo();

    store.getState().undo(); // back to before beginWay: the way is gone entirely

    expect(store.getState().activeWayId).toBeNull();
  });
});

describe('undo/redo: gesture checkpoints coalesce into one step, discard no-ops', () => {
  function countUndoSteps(store: ReturnType<typeof createEditorStore>): number {
    let n = 0;
    while (store.getState().canUndo) {
      store.getState().undo();
      n++;
    }
    for (let i = 0; i < n; i++) store.getState().redo();
    return n;
  }

  function setup() {
    const store = createEditorStore();
    const wayId = store.getState().beginWay('lightRail', 'straight');
    store.getState().addWayPoint(wayId, [-115.2, 36.1]);
    store.getState().addWayPoint(wayId, [-115.1, 36.1]);
    return { store, wayId };
  }

  function drag(store: ReturnType<typeof createEditorStore>, wayId: string) {
    store.getState().beginHistoryCheckpoint();
    store.getState().moveWayPoint(wayId, 1, [-115.05, 36.1]);
    store.getState().moveWayPoint(wayId, 1, [-115.02, 36.15]);
    store.getState().moveWayPoint(wayId, 1, [-115.0, 36.2]);
    store.getState().commitHistoryCheckpoint();
  }

  it('a whole drag (many moves) coalesces into exactly one undo step', () => {
    const { store, wayId } = setup();
    const stepsBeforeDrag = countUndoSteps(store);

    drag(store, wayId);

    expect(countUndoSteps(store)).toBe(stepsBeforeDrag + 1);
  });

  it('undoing the coalesced drag reverts to before the whole drag, not one move step', () => {
    const { store, wayId } = setup();
    drag(store, wayId);

    const wayBeforeUndo = store.getState().system.ways.find((w) => w.id === wayId);
    const movedPoint = wayBeforeUndo?.points[1];
    store.getState().undo();
    const wayAfterUndo = store.getState().system.ways.find((w) => w.id === wayId);
    const revertedPoint = wayAfterUndo?.points[1];

    expect(revertedPoint).toEqual([-115.1, 36.1]);
    expect(movedPoint?.[0]).toBe(-115.0);
  });

  // An Escape-cancelled drag restores the exact checkpoint snapshot instead
  // of serializing changed agency-scale collections to discover equivalence.
  it('canceling a checkpoint restores its exact snapshot and pushes no undo step', () => {
    const { store, wayId } = setup();
    drag(store, wayId);
    const stepsBeforeNoOpDrag = countUndoSteps(store);
    const beforeCancelledDrag = store.getState().system;

    store.getState().beginHistoryCheckpoint();
    store.getState().moveWayPoint(wayId, 1, [-114.9, 36.3]);
    store.getState().cancelHistoryCheckpoint();

    expect(store.getState().system).toBe(beforeCancelledDrag);
    expect(countUndoSteps(store)).toBe(stepsBeforeNoOpDrag);
  });
});

describe('keyboard: mod (Ctrl/Cmd) bindings for undo/redo do not collide with plain ones', () => {
  it("plain 'z' still matches the non-mod zoom-in binding", () => {
    expect(matchesKey(evt({ key: 'z' }), 'z')).toBe(true);
  });

  it('Ctrl+Z does not match a plain (mod-less) binding', () => {
    expect(matchesKey(evt({ key: 'z', ctrlKey: true }), 'z')).toBe(false);
  });

  it('Ctrl+Z matches a mod:true binding', () => {
    expect(matchesKey(evt({ key: 'z', ctrlKey: true }), 'z', true)).toBe(true);
  });

  it('plain Z (no Ctrl) does not match a mod:true binding', () => {
    expect(matchesKey(evt({ key: 'z' }), 'z', true)).toBe(false);
  });

  it('Ctrl+Shift+Z does not match the mod:true/shift:false Undo binding', () => {
    expect(matchesKey(evt({ key: 'z', ctrlKey: true, shiftKey: true }), 'z', true, false)).toBe(
      false,
    );
  });

  it('Ctrl+Shift+Z matches the mod:true/shift:true Redo binding', () => {
    expect(matchesKey(evt({ key: 'z', ctrlKey: true, shiftKey: true }), 'z', true, true)).toBe(
      true,
    );
  });

  describe('resolving and running the bindings', () => {
    let store: ReturnType<typeof createEditorStore>;
    let ctx: KeyContext;

    beforeEach(() => {
      store = createEditorStore();
      ctx = buildCtx(store);
    });

    it('Undo binding is gated by canUndo', () => {
      expect(resolveBinding(KEY_BINDINGS, evt({ key: 'z', ctrlKey: true }), ctx)).toBeNull();
    });

    it("Ctrl+Z resolves to the Undo binding once there's something to undo", () => {
      store.getState().addStation([-115.2, 36.1]);

      const undone = resolveBinding(KEY_BINDINGS, evt({ key: 'z', ctrlKey: true }), ctx);

      expect(undone?.description).toBe('Undo');
    });

    it('running the resolved Undo binding actually undoes', () => {
      store.getState().addStation([-115.2, 36.1]);
      const undone = resolveBinding(KEY_BINDINGS, evt({ key: 'z', ctrlKey: true }), ctx);

      undone?.run(ctx);

      expect(store.getState().system.stations).toHaveLength(0);
    });

    it('Ctrl+Shift+Z resolves to the Redo binding', () => {
      store.getState().addStation([-115.2, 36.1]);
      resolveBinding(KEY_BINDINGS, evt({ key: 'z', ctrlKey: true }), ctx)?.run(ctx);

      const redone = resolveBinding(
        KEY_BINDINGS,
        evt({ key: 'z', ctrlKey: true, shiftKey: true }),
        ctx,
      );

      expect(redone?.description).toBe('Redo');
    });

    it('running the resolved Redo binding actually redoes', () => {
      store.getState().addStation([-115.2, 36.1]);
      resolveBinding(KEY_BINDINGS, evt({ key: 'z', ctrlKey: true }), ctx)?.run(ctx);
      const redone = resolveBinding(
        KEY_BINDINGS,
        evt({ key: 'z', ctrlKey: true, shiftKey: true }),
        ctx,
      );

      redone?.run(ctx);

      expect(store.getState().system.stations).toHaveLength(1);
    });
  });
});

describe('keyboard: UI-hide toggle', () => {
  function buildToggleCtx(onToggle: () => void): KeyContext {
    return {
      map: { panBy() {}, zoomTo() {}, getZoom: () => 10 },
      editor: createEditorStore(),
      setPanKeyHeld() {},
      openShortcuts() {},
      toggleUi: onToggle,
    } as unknown as KeyContext;
  }

  it('backslash resolves to the Show/hide UI binding', () => {
    const ctx = buildToggleCtx(() => {});

    const binding = resolveBinding(KEY_BINDINGS, evt({ key: '\\' }), ctx);

    expect(binding?.description).toBe('Show/hide UI');
  });

  it('running it calls toggleUi', () => {
    let toggled = 0;
    const ctx = buildToggleCtx(() => {
      toggled++;
    });
    const binding = resolveBinding(KEY_BINDINGS, evt({ key: '\\' }), ctx);

    binding?.run(ctx);

    expect(toggled).toBe(1);
  });
});
