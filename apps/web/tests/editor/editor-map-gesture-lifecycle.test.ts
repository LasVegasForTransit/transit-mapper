import type { Map as MapLibreMap } from 'maplibre-gl';
import { describe, expect, it, vi } from 'vitest';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
import type { DocumentMapSceneAccepted, DocumentMapSession } from '@transitmapper/renderer/driver';
import { createDocumentMapSource } from '../../src/editor/document-map-source';
import { createEditorMapGesture } from '../../src/editor/editor-map-gesture';
import { createEditorStore } from '../../src/editor/store';
import { createProjectionOperationCounts } from '../../src/map/gestureProjection';
import { required } from '../support/required.test';

describe('the editor map gesture lifecycle', () => {
  it.each([
    { name: 'the committed scene is accepted', settle: 'accept' },
    { name: 'the document is replaced', settle: 'replace' },
  ] as const)('contains every settlement cleanup failure when $name', ({ settle }) => {
    const store = createEditorStore();
    const stopId = required(store.commands.stops.addStop([-115.2, 36.1]));
    const source = createDocumentMapSource(store);
    const gestureSource = { setData: vi.fn() };
    const setFilter = vi.fn();
    const flushTheme = vi.fn();
    const reportError = vi.fn();
    const map = {
      getSource: () => gestureSource,
      getLayer: () => ({}),
      getFilter: () => null,
      setFilter,
      getLayoutProperty: () => 'visible',
      setLayoutProperty: vi.fn(),
    };
    const session: DocumentMapSession = {
      map: map as unknown as MapLibreMap,
      renderer: {
        physicalLayerIds: (layerId: string) => [layerId],
        cancelProjectionAndRequeue: vi.fn(),
      } as never,
      getSnapshot: () => source.getSnapshot(),
      scheduleProjection: vi.fn(),
      recoverStyle: vi.fn(),
      subscribeAcceptedScene: () => () => {},
    };
    const gesture = createEditorMapGesture(session, {
      store,
      source,
      counts: createProjectionOperationCounts(),
      recordSourceUpload: vi.fn(),
      flushTheme,
      reportError,
    });

    gesture.begin({ stopIds: [stopId] });
    gesture.end();
    expect(gesture.ownsPreview()).toBe(true);
    gestureSource.setData.mockClear();
    gestureSource.setData.mockImplementation(() => {
      throw new Error('preview cleanup');
    });
    setFilter.mockClear();
    flushTheme.mockClear();
    reportError.mockClear();

    const settleGesture = () => {
      if (settle === 'replace') {
        store.commands.document.setSystem(createEmptySystem());
        gesture.documentChanged();
        return;
      }
      gesture.acceptedScene({
        snapshot: source.getSnapshot(),
        update: {} as never,
      } satisfies DocumentMapSceneAccepted);
    };

    expect(settleGesture).not.toThrow();
    expect(gestureSource.setData).toHaveBeenCalledOnce();
    expect(setFilter).toHaveBeenCalled();
    expect(flushTheme).toHaveBeenCalledOnce();
    expect(reportError).toHaveBeenCalledOnce();
    expect(gesture.ownsPreview()).toBe(false);

    settleGesture();
    expect(flushTheme).toHaveBeenCalledOnce();
    expect(reportError).toHaveBeenCalledOnce();
  });
});
