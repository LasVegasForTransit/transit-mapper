import { describe, expect, it, vi } from 'vitest';
import { aRoad, aService, aStation, aStop, aSystem } from '@transitmapper/core/testing/fixtures';
import { createEditorSelectionController } from '../../src/editor/editor-selection';
import { createEditorStore, type Selection } from '../../src/editor/store';

function selectableSystem() {
  const service = aService('service', []);
  return aSystem({
    ways: [
      aRoad('way', [
        [-115.2, 36.1],
        [-115.1, 36.2],
      ]),
    ],
    lines: [{ id: 'line', name: 'Line', color: '#123456', serviceIds: [service.id] }],
    services: [service],
    stops: [aStop('stop', [-115.15, 36.15])],
    stations: [aStation('station', [-115.15, 36.15])],
    facilities: [{ id: 'facility', typeId: 'entrance', geometry: [-115.15, 36.15] }],
    groups: [{ id: 'group', memberIds: ['facility'] }],
    nodes: [{ id: 'node', coord: [-115.15, 36.15], refs: [] }],
  });
}

const supportedSelections: readonly Exclude<Selection, null>[] = [
  { kind: 'way', id: 'way' },
  { kind: 'line', id: 'line' },
  { kind: 'service', id: 'service' },
  { kind: 'stop', id: 'stop' },
  { kind: 'station', id: 'station' },
  { kind: 'facility', id: 'facility' },
  { kind: 'group', id: 'group' },
  { kind: 'node', id: 'node' },
];

describe('the editor selection controller', () => {
  it.each(supportedSelections)(
    'maps editor $kind selection to a document reference',
    (selection) => {
      const store = createEditorStore();
      store.commands.document.setSystem(selectableSystem());
      const controller = createEditorSelectionController(store);

      store.commands.selection.select(selection);

      expect(controller.getSnapshot()).toEqual({
        source: 'document',
        kind: selection.kind,
        id: selection.id,
      });
    },
  );

  it.each(supportedSelections)('applies a document $kind reference to the editor', (selection) => {
    const store = createEditorStore();
    store.commands.document.setSystem(selectableSystem());
    const controller = createEditorSelectionController(store);

    controller.select({ source: 'document', kind: selection.kind, id: selection.id });

    expect(store.getState().selection).toEqual(selection);
  });

  it.each([
    { source: 'published', kind: 'way', id: 'way' },
    { source: 'document', kind: 'unknown', id: 'way' },
    { source: 'document', kind: 'way', id: 'missing' },
  ] as const)('clears an editor selection for an unusable $source/$kind reference', (reference) => {
    const store = createEditorStore();
    store.commands.document.setSystem(selectableSystem());
    store.commands.selection.select({ kind: 'way', id: 'way' });
    const controller = createEditorSelectionController(store);

    controller.select(reference);

    expect(store.getState().selection).toBeNull();
    expect(controller.getSnapshot()).toBeUndefined();
  });

  it('preserves editor-only selection detail and avoids duplicate publications', () => {
    const store = createEditorStore();
    store.commands.document.setSystem(selectableSystem());
    const controller = createEditorSelectionController(store);
    const listener = vi.fn();
    controller.subscribe(listener);
    store.commands.selection.select({ kind: 'service', id: 'service', stopId: 'stop' });
    const reference = { source: 'document', kind: 'service', id: 'service' } as const;

    controller.select(reference);

    expect(store.getState().selection).toEqual({
      kind: 'service',
      id: 'service',
      stopId: 'stop',
    });
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenLastCalledWith(reference);
  });

  it('releases each editor subscription once', () => {
    const store = createEditorStore();
    const subscribe = store.subscribe;
    const releaseStore = vi.fn();
    vi.spyOn(store, 'subscribe').mockImplementation((listener) => {
      const release = subscribe(listener);
      return () => {
        release();
        releaseStore();
      };
    });
    const controller = createEditorSelectionController(store);
    const releaseFirst = controller.subscribe(() => {});
    const releaseSecond = controller.subscribe(() => {});

    releaseFirst();
    releaseFirst();
    expect(releaseStore).toHaveBeenCalledOnce();

    releaseSecond();
    releaseSecond();
    expect(releaseStore).toHaveBeenCalledTimes(2);
    expect(store.subscribe).toHaveBeenCalledTimes(2);
  });
});
