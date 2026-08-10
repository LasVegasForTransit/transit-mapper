import { describe, expect, it } from 'vitest';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
import { createEditorStore } from '../../src/editor/store';

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
        lines: [],
        services: [
          {
            id: 'late-service',
            name: 'Late service',
            modeId: 'bus',

            path: { id: 'late-service', sections: [] },
          },
        ],
      },
    });

    expect(applied).toBe(false);
    expect(store.getState().system.id).toBe(other.id);
    expect(store.getState().system.services).toHaveLength(0);
  });
});
