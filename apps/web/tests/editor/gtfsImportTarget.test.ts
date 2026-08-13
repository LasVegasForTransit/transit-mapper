import { describe, expect, it } from 'vitest';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
import { osmElementsToNetwork } from '@transitmapper/core/model/import';
import { createEditorStore } from '../../src/editor/store';

describe('streaming GTFS import ownership', () => {
  it('never applies a late batch after the active document changes', () => {
    const store = createEditorStore();
    const target = createEmptySystem();
    const other = createEmptySystem();
    store.commands.document.setSystem(target);
    store.commands.document.setSystem(other);

    const applied = store.commands.imports.applyGtfsImportBatch({
      targetSystemId: target.id,
      pieces: {
        ways: [],
        stops: [],
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

describe('streaming OpenStreetMap import ownership', () => {
  it('applies one deduplicated batch only to its original active system', () => {
    const store = createEditorStore();
    const target = createEmptySystem();
    const other = createEmptySystem();
    store.commands.document.setSystem(target);
    const network = osmElementsToNetwork([
      {
        type: 'way',
        id: 1,
        tags: { highway: 'residential' },
        nodes: [1, 2],
        geometry: [
          { lat: 36, lon: -115.1 },
          { lat: 36.01, lon: -115.1 },
        ],
      },
    ]);

    expect(
      store.commands.imports.applyImportedNetwork({ targetSystemId: target.id, network }),
    ).toEqual({
      added: 1,
      skipped: 0,
    });
    expect(store.getState().system.ways).toHaveLength(1);

    store.commands.document.setSystem(other);
    expect(
      store.commands.imports.applyImportedNetwork({ targetSystemId: target.id, network }),
    ).toBeNull();
    expect(store.getState().system.ways).toHaveLength(0);
  });
});
