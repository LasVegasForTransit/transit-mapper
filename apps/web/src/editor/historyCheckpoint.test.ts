import { createEmptySystem } from '@transitmapper/core/model/serialize';
import { defaultProfileFor } from '@transitmapper/core/model/profile';
import { describe, expect, it, vi } from 'vitest';
import { createEditorStore } from './store';

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
    store.getState().setSystem(system);
    const stringify = vi.spyOn(JSON, 'stringify');

    store.getState().beginHistoryCheckpoint();
    store.getState().moveWayPoint('way', 1, [-115, 36.2]);
    store.getState().commitHistoryCheckpoint();

    expect(stringify).not.toHaveBeenCalled();
    expect(store.getState().canUndo).toBe(true);
    stringify.mockRestore();
  });

  it('cancels a gesture by restoring the exact starting snapshot', () => {
    const store = createEditorStore();
    const before = store.getState().system;

    store.getState().beginHistoryCheckpoint();
    store.getState().addStation([-115.2, 36.1]);
    store.getState().cancelHistoryCheckpoint();

    expect(store.getState().system).toBe(before);
    expect(store.getState().canUndo).toBe(false);
  });
});
