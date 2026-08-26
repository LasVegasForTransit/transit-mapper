import { describe, expect, it } from 'vitest';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
import { createMapViewStore } from '@transitmapper/map';
import { createDocumentPresentationState } from '@transitmapper/renderer/presentation';
import {
  currentDocumentCamera,
  editorSelectionReference,
  initializeDocumentCamera,
  restoreEditorSelection,
  withDocumentCamera,
} from '../../src/editor/document-view-adapter';
import { createEditorStore } from '../../src/editor/store';

describe('the document View adapter', () => {
  it('folds the View camera into a serialization copy without changing the document', () => {
    const system = createEmptySystem();
    system.updatedAt = 123;
    const store = createMapViewStore(createDocumentPresentationState({ camera: system.viewport }));
    store.setCamera({ center: [-73.9857, 40.7484], zoom: 13 });

    const serialized = withDocumentCamera(system, store);

    expect(serialized).not.toBe(system);
    expect(serialized.viewport).toEqual({ center: [-73.9857, 40.7484], zoom: 13 });
    expect(serialized.updatedAt).toBe(123);
    expect(system.viewport).not.toEqual(serialized.viewport);
  });

  it('initializes the camera from a document without replacing View filters', () => {
    const store = createMapViewStore(createDocumentPresentationState());
    store.setRepresentationId('infrastructure');
    store.setFilter('landmarks', false);

    initializeDocumentCamera(store, { center: [-122.3321, 47.6062], zoom: 10 });

    expect(store.getSnapshot()).toMatchObject({
      camera: { center: [-122.3321, 47.6062], zoom: 10 },
      representationId: 'infrastructure',
      filters: { landmarks: false },
    });
    expect(currentDocumentCamera(store)).toEqual({
      center: [-122.3321, 47.6062],
      zoom: 10,
    });
  });

  it('keeps camera changes out of editor state and history', () => {
    const editor = createEditorStore();
    const view = createMapViewStore(createDocumentPresentationState());
    const before = editor.getState();

    view.setCamera({ center: [-87.6298, 41.8781], zoom: 12 });

    expect(editor.getState()).toBe(before);
    expect(editor.getState().canUndo).toBe(false);
    expect(editor.getState().system.updatedAt).toBe(before.system.updatedAt);
  });

  it('captures an editor selection as an optional portable feature reference', () => {
    expect(editorSelectionReference({ kind: 'station', id: 'station-1' })).toEqual({
      source: 'document',
      kind: 'station',
      id: 'station-1',
    });
    expect(editorSelectionReference(null)).toBeUndefined();
  });

  it('clears a restored selection when its feature is missing', () => {
    const system = createEmptySystem();
    system.stations = [{ id: 'station-1', name: 'Central', coord: [-115.17, 36.11] }];

    expect(
      restoreEditorSelection({ source: 'document', kind: 'station', id: 'station-1' }, system),
    ).toEqual({ kind: 'station', id: 'station-1' });
    expect(
      restoreEditorSelection({ source: 'document', kind: 'station', id: 'missing' }, system),
    ).toBeNull();
    expect(
      restoreEditorSelection({ source: 'published', kind: 'station', id: 'station-1' }, system),
    ).toBeNull();
  });
});
