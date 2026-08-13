import { createEmptySystem } from '@transitmapper/core/model/serialize';
import { defaultProfileFor } from '@transitmapper/core/model/profile';
import { describe, expect, it, vi } from 'vitest';
import { createEditorStore } from '../../src/editor/store';

describe('editor history checkpoints', () => {
  it('commits a changed gesture without serializing document collections', () => {
    const store = createEditorStore();
    const system = createEmptySystem();
    system.ways = [
      {
        id: 'way',
        typeId: 'road',
        geometry: 'straight',
        grade: 'atGrade',
        profile: defaultProfileFor('road'),
        points: [
          [-115.2, 36.1],
          [-115.1, 36.1],
        ],
      },
    ];
    store.commands.document.setSystem(system);
    const stringify = vi.spyOn(JSON, 'stringify');

    store.commands.history.beginHistoryCheckpoint();
    store.commands.ways.moveWayPoint('way', 1, [-115, 36.2]);
    store.commands.history.commitHistoryCheckpoint();

    expect(stringify).not.toHaveBeenCalled();
    expect(store.getState().canUndo).toBe(true);
    stringify.mockRestore();
  });

  it('cancels a gesture by restoring the exact starting snapshot', () => {
    const store = createEditorStore();
    const system = createEmptySystem();
    system.stops = [{ id: 'selected-before-drag', coord: [-115.3, 36.2], anchors: [] }];
    store.commands.document.setSystem(system);
    const before = store.getState().system;
    const selection = { kind: 'stop' as const, id: 'selected-before-drag' };
    store.commands.selection.select(selection);

    store.commands.history.beginHistoryCheckpoint();
    store.commands.stops.addStop([-115.2, 36.1]);
    store.commands.history.cancelHistoryCheckpoint();

    expect(store.getState().system).toBe(before);
    expect(store.getState().selection).toBe(selection);
    expect(store.getState().canUndo).toBe(false);
  });

  it('refuses undo and redo until the open checkpoint is resolved', () => {
    const store = createEditorStore();
    const initial = store.getState().system;
    store.commands.document.setName('Before gesture');

    store.commands.history.beginHistoryCheckpoint();
    store.commands.document.setName('During gesture');
    const duringGesture = store.getState().system;
    store.commands.history.undo();
    expect(store.getState().system).toBe(duringGesture);
    store.commands.history.redo();

    expect(store.getState().system).toBe(duringGesture);
    store.commands.history.commitHistoryCheckpoint();
    store.commands.history.undo();
    expect(store.getState().system.name).toBe('Before gesture');
    store.commands.history.undo();
    expect(store.getState().system).toBe(initial);
  });

  it('prunes transient references that an undo removes from the document', () => {
    const store = createEditorStore();
    const stopId = store.commands.stops.addStop([-115.2, 36.1]);
    if (!stopId) throw new Error('Expected the stop command to create a record');
    store.commands.selection.setOutlineHover({ kind: 'stop', id: stopId });

    store.commands.history.undo();

    expect(store.getState().system.stops).toHaveLength(0);
    expect(store.getState().focusNameStopId).toBeNull();
    expect(store.getState().outlineHover).toBeNull();
  });
});
