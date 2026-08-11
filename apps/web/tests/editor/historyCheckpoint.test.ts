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
    const before = store.getState().system;

    store.commands.history.beginHistoryCheckpoint();
    store.commands.stations.addStation([-115.2, 36.1]);
    store.commands.history.cancelHistoryCheckpoint();

    expect(store.getState().system).toBe(before);
    expect(store.getState().canUndo).toBe(false);
  });
});
