import { describe, expect, it, vi } from 'vitest';
import { aSystem } from '@transitmapper/core/testing/fixtures';
import {
  createDocumentMapSource,
  type EditorDocumentMapHold,
} from '../../src/editor/document-map-source';
import type { DocumentMapSnapshot } from '@transitmapper/renderer/driver';
import { createEditorStore } from '../../src/editor/store';

describe('the editor document map source', () => {
  it('maps an initial loading document and publishes the ready document that replaces it', () => {
    const store = createEditorStore({ documentStatus: 'loading' });
    const source = createDocumentMapSource(store);
    const listener = vi.fn();
    source.subscribe(listener);
    const saved = aSystem({ id: 'saved' });

    expect(source.getSnapshot()).toEqual({ status: 'loading', system: store.getState().system });

    store.commands.document.setSystem(saved);

    expect(source.getSnapshot()).toEqual({ status: 'ready', system: saved });
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenLastCalledWith({ status: 'ready', system: saved });
  });

  it('keeps one snapshot and emits nothing for transient editor updates', () => {
    const store = createEditorStore();
    const source = createDocumentMapSource(store);
    const before = source.getSnapshot();
    const listener = vi.fn();
    source.subscribe(listener);

    store.commands.tools.setTool('way');
    store.commands.tools.setSelectVariant('erase');
    store.commands.selection.select({ kind: 'stop', id: 'transient-selection' });

    expect(source.getSnapshot()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it('publishes a changed system and releases each store subscription once', () => {
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
    const source = createDocumentMapSource(store);
    const firstListener = vi.fn();
    const secondListener = vi.fn();
    const releaseFirst = source.subscribe(firstListener);
    const releaseSecond = source.subscribe(secondListener);

    store.commands.document.setSystem(aSystem({ id: 'replacement' }));

    expect(source.getSnapshot().system.id).toBe('replacement');
    expect(firstListener).toHaveBeenCalledOnce();
    expect(secondListener).toHaveBeenCalledOnce();
    expect(store.subscribe).toHaveBeenCalledTimes(2);

    releaseFirst();
    releaseFirst();
    expect(releaseStore).toHaveBeenCalledOnce();

    releaseSecond();
    releaseSecond();
    expect(releaseStore).toHaveBeenCalledTimes(2);
  });

  it('holds intermediate gesture snapshots and publishes the latest document once', () => {
    const store = createEditorStore();
    const source = createDocumentMapSource(store);
    const listener = vi.fn();
    source.subscribe(listener);
    const hold = source.hold();

    store.commands.document.setSystem(aSystem({ id: 'gesture-one' }));
    store.commands.document.setSystem(aSystem({ id: 'gesture-two' }));

    expect(source.getSnapshot().system.id).toBe('gesture-two');
    expect(listener).not.toHaveBeenCalled();

    hold.release();
    hold.release();

    expect(listener).toHaveBeenCalledOnce();
    const published = listener.mock.lastCall?.[0] as DocumentMapSnapshot;
    expect(published.system.id).toBe('gesture-two');
  });

  it('waits for every overlapping gesture hold before publishing', () => {
    const store = createEditorStore();
    const source = createDocumentMapSource(store);
    const listener = vi.fn();
    source.subscribe(listener);
    const first = source.hold();
    const second = source.hold();

    store.commands.document.setSystem(aSystem({ id: 'overlap' }));
    first.release();

    expect(listener).not.toHaveBeenCalled();

    second.release();

    expect(listener).toHaveBeenCalledOnce();
    const published = listener.mock.lastCall?.[0] as DocumentMapSnapshot;
    expect(published.system.id).toBe('overlap');
  });

  it.each([
    {
      name: 'release then cancel',
      finish: (first: EditorDocumentMapHold, second: EditorDocumentMapHold) => {
        first.release();
        second.cancel();
      },
    },
    {
      name: 'cancel then release',
      finish: (first: EditorDocumentMapHold, second: EditorDocumentMapHold) => {
        first.cancel();
        second.release();
      },
    },
  ])('publishes once when overlapping owners finish as $name', ({ finish }) => {
    const store = createEditorStore();
    const source = createDocumentMapSource(store);
    const listener = vi.fn();
    source.subscribe(listener);
    const first = source.hold();
    const second = source.hold();

    store.commands.document.setSystem(aSystem({ id: 'mixed-overlap' }));
    finish(first, second);

    expect(listener).toHaveBeenCalledOnce();
    expect((listener.mock.lastCall?.[0] as DocumentMapSnapshot).system.id).toBe('mixed-overlap');
  });

  it('cancels an aborted gesture hold without publishing stale document work', () => {
    const store = createEditorStore();
    const source = createDocumentMapSource(store);
    const listener = vi.fn();
    source.subscribe(listener);
    const hold = source.hold();

    store.commands.document.setSystem(aSystem({ id: 'replacement' }));
    hold.cancel();
    hold.release();

    expect(source.getSnapshot().system.id).toBe('replacement');
    expect(listener).not.toHaveBeenCalled();
  });
});
