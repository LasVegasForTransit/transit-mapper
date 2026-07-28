import { describe, expect, it } from 'vitest';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
import { createEditorStore } from './store';

describe('streaming GTFS import ownership', () => {
  it('never applies a late batch after the active document changes', () => {
    const store = createEditorStore();
    const target = createEmptySystem();
    const other = createEmptySystem();
    store.getState().setSystem(target);
    store.getState().setSystem(other);

    const applied = store.getState().applyGtfsImportBatch({
      targetSystemId: target.id,
      pieces: {
        ways: [],
        stations: [],
        services: [
          {
            id: 'late-service',
            name: 'Late service',
            modeId: 'bus',
            color: '#000000',
            patterns: [],
          },
        ],
      },
    });

    expect(applied).toBe(false);
    expect(store.getState().system.id).toBe(other.id);
    expect(store.getState().system.services).toHaveLength(0);
  });
});
