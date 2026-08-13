import { describe, expect, it } from 'vitest';
import { aService, aStation, aStop, aSystem } from '@transitmapper/core/testing/fixtures';
import { createEditorStore } from '../../src/editor/store';
import { KEY_BINDINGS, type KeyContext } from '../../src/editor/keymap';

describe('editor keymap', () => {
  it('does not delete a Service when its selected subject is a Stop call', () => {
    const store = createEditorStore();
    store.commands.document.setSystem(aSystem({ services: [aService('local', [])] }));
    store.commands.selection.select({ kind: 'service', id: 'local', stopId: 'stop' });
    const binding = KEY_BINDINGS.find((candidate) => candidate.description === 'Delete selection');
    if (!binding) throw new Error('Delete selection binding is missing');

    binding.run({ editor: store } as KeyContext);

    expect(store.getState().system.services.map((service) => service.id)).toEqual(['local']);
    expect(store.getState().selection).toEqual({
      kind: 'service',
      id: 'local',
      stopId: 'stop',
    });
  });

  it('deletes a Station without deleting its contained Stops', () => {
    const store = createEditorStore();
    store.commands.document.setSystem(
      aSystem({
        stations: [aStation('central', [-115.17, 36.12])],
        stops: [{ ...aStop('platform-a', [-115.17, 36.12]), stationId: 'central' }],
      }),
    );
    store.commands.selection.select({ kind: 'station', id: 'central' });
    const binding = KEY_BINDINGS.find((candidate) => candidate.description === 'Delete selection');
    if (!binding) throw new Error('Delete selection binding is missing');

    binding.run({ editor: store } as KeyContext);

    expect(store.getState().system.stations).toEqual([]);
    expect(store.getState().system.stops).toMatchObject([
      { id: 'platform-a', stationId: undefined },
    ]);
  });
});
