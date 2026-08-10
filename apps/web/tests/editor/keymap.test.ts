import { describe, expect, it } from 'vitest';
import { aService, aSystem } from '@transitmapper/core/testing/fixtures';
import { createEditorStore } from '../../src/editor/store';
import { KEY_BINDINGS, type KeyContext } from '../../src/editor/keymap';

describe('editor keymap', () => {
  it('does not delete a Service when its selected subject is a Stop call', () => {
    const store = createEditorStore();
    store.getState().setSystem(aSystem({ services: [aService('local', [])] }));
    store.getState().select({ kind: 'service', id: 'local', stopId: 'station' });
    const binding = KEY_BINDINGS.find((candidate) => candidate.description === 'Delete selection');
    if (!binding) throw new Error('Delete selection binding is missing');

    binding.run({ editor: store } as KeyContext);

    expect(store.getState().system.services.map((service) => service.id)).toEqual(['local']);
    expect(store.getState().selection).toEqual({
      kind: 'service',
      id: 'local',
      stopId: 'station',
    });
  });
});
