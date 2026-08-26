// Shared jsdom harness for the editor map attachment tests. Vitest excludes
// support files from test discovery, so importing this does not register cases.
import type { LayerSpecification, Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import { vi } from 'vitest';
import { createMapViewStore } from '@transitmapper/map';
import { emptySystemFeatures } from '@transitmapper/renderer/layers';
import { createSourceFeatureProjectionAccounting } from '@transitmapper/renderer/projection';
import type { DocumentMapSceneAccepted, DocumentMapSession } from '@transitmapper/renderer/driver';
import type { TransitSystem } from '@transitmapper/core/model/system';
import type { AttachEditorMapOptions } from '../../src/editor/editor-map-attachment';
import { createDocumentMapSource } from '../../src/editor/document-map-source';
import { createDocumentPresentationState } from '../../src/editor/document-view-adapter';
import { createEditorStore } from '../../src/editor/store';
import { FINE_POINTER_TUNING } from '../../src/editor/input-tuning';
import { createProjectionOperationCounts } from '../../src/map/gestureProjection';
import { LAYER_SPECS } from '../../src/map/layers/layerSpecs';

type MapListener = (...args: unknown[]) => void;

function createMap() {
  const listeners = new Map<string, Set<MapListener>>();
  const canvas = document.createElement('canvas');
  const sources = new Map<string, { setData: (data: unknown) => void }>();
  const layers = new Map<string, LayerSpecification>(LAYER_SPECS.map((layer) => [layer.id, layer]));
  let renderedFeatures: unknown[] = [];
  const map = {
    on(type: string, layerOrListener: string | MapListener, listener?: MapListener) {
      const callback = typeof layerOrListener === 'function' ? layerOrListener : listener;
      if (callback) {
        const current = listeners.get(type) ?? new Set();
        current.add(callback);
        listeners.set(type, current);
      }
      return map;
    },
    once(type: string, listener: MapListener) {
      const wrapped: MapListener = (event) => {
        map.off(type, wrapped);
        listener(event);
      };
      map.on(type, wrapped);
      return map;
    },
    off(type: string, layerOrListener: string | MapListener, listener?: MapListener) {
      const callback = typeof layerOrListener === 'function' ? layerOrListener : listener;
      if (callback) listeners.get(type)?.delete(callback);
      return map;
    },
    fire(type: string, event: unknown) {
      for (const listener of [...(listeners.get(type) ?? [])]) listener(event);
      return map;
    },
    getCanvas: () => canvas,
    getContainer: () => document.createElement('div'),
    getCenter: () => ({ lng: -115.2, lat: 36.1 }),
    getZoom: () => 12,
    getLayer: (id: string) => layers.get(id),
    getStyle: (): StyleSpecification => ({
      version: 8,
      sources: {},
      layers: [...layers.values()],
    }),
    setStyle(style: StyleSpecification) {
      layers.clear();
      for (const layer of style.layers) layers.set(layer.id, layer);
      return map;
    },
    removeLayer(id: string) {
      layers.delete(id);
    },
    getFilter: () => null,
    setFilter: vi.fn(),
    getLayoutProperty: () => 'visible',
    setLayoutProperty: vi.fn(),
    getSource(id: string) {
      let source = sources.get(id);
      if (!source) {
        source = { setData: vi.fn() };
        sources.set(id, source);
      }
      return source;
    },
    queryRenderedFeatures: () => renderedFeatures,
    setRenderedFeatures(features: unknown[]) {
      renderedFeatures = features;
    },
    project: () => ({ x: 0, y: 0 }),
    unproject: () => ({ lng: -115.2, lat: 36.1 }),
    getBounds: () => ({
      getWest: () => -116,
      getEast: () => -114,
      getSouth: () => 35,
      getNorth: () => 37,
    }),
    getPixelRatio: () => 1,
    isMoving: () => false,
    fitBounds: vi.fn(),
    panBy: vi.fn(),
    easeTo: vi.fn(),
    triggerRepaint: vi.fn(),
    setFeatureState: vi.fn(),
    removeFeatureState: vi.fn(),
    dragPan: { enable: vi.fn(), disable: vi.fn() },
    listenerCount: () => [...listeners.values()].reduce((count, set) => count + set.size, 0),
  };
  return map;
}

export function createEditorMapAttachmentHarness() {
  const map = createMap();
  const accepted = new Set<(event: DocumentMapSceneAccepted) => void>();
  const store = createEditorStore();
  const source = createDocumentMapSource(store);
  const renderer = {
    physicalLayerIds: (id: string) => [id],
    activeSourceId: (id: string) => id,
    activeLayerId: (id: string) => id,
    hasAcceptedScene: () => true,
    publicationInProgress: () => false,
    updateEditorScene: vi.fn(() => null),
    setLayerVisibility: vi.fn(),
    setLayerPaintProperty: vi.fn(),
    targetsForDomainIdentity: () => [],
    cancelProjectionAndRequeue: vi.fn(() => false),
  };
  const scheduleProjection = vi.fn();
  const session: DocumentMapSession = {
    map: map as unknown as MapLibreMap,
    renderer: renderer as never,
    getSnapshot: () => source.getSnapshot(),
    scheduleProjection,
    recoverStyle: vi.fn(),
    subscribeAcceptedScene(listener) {
      accepted.add(listener);
      return () => accepted.delete(listener);
    },
  };
  const viewStore = createMapViewStore(createDocumentPresentationState());
  const worker = {
    project: vi.fn(() => Promise.resolve({ features: emptySystemFeatures() })),
    dispose: vi.fn(),
  };
  const detachSimulation = vi.fn();
  const detachInstrumentation = vi.fn();
  const notifySimulation = vi.fn();
  const reportError = vi.fn();
  const options: AttachEditorMapOptions = {
    document: { store, source },
    layers: { catalog: () => LAYER_SPECS },
    view: {
      store: viewStore,
      setRepresentation: (id) => viewStore.setRepresentationId(id),
      framePadding: () => 100,
      renderView: () => ({
        viewMode: 'network',
        visibleModes: new Set(),
        visibleWayTypes: new Set(),
        presentation: {
          bounds: { southwest: [-116, 35], northeast: [-114, 37] },
          zoom: 12,
          viewportWidthPx: 800,
          viewportHeightPx: 600,
          displayedWidthPx: 800,
          displayedHeightPx: 600,
          pixelRatio: 1,
        },
      }),
    },
    interactions: {
      tuning: FINE_POINTER_TUNING,
      openShortcuts() {},
      toggleUi() {},
      attachKeyboard: () => () => {},
      openContextMenu() {},
      closeContextMenu() {},
      isContextMenuOpen: () => false,
      onPointerIntent() {},
      registerPointerIntentRefresh: () => () => {},
      openTerminusConnectionChoice() {},
    },
    simulation: {
      attach: () => detachSimulation,
      notify: notifySimulation,
    },
    projection: {
      createWorker: () => worker as never,
      gestureCounts: createProjectionOperationCounts(),
      overlayNeedsHealing: () => false,
      beginAccounting: () => createSourceFeatureProjectionAccounting().begin(),
      recordUpdate() {},
      recordSourceUpload() {},
    },
    instrumentation: { attach: () => ({ dispose: detachInstrumentation }) },
    flushTheme() {},
    reportError,
  };
  const acceptScene = (system: TransitSystem = store.getState().system) => {
    const event: DocumentMapSceneAccepted = {
      snapshot: { status: store.getState().documentStatus, system },
      update: {} as DocumentMapSceneAccepted['update'],
    };
    for (const listener of accepted) listener(event);
  };
  return {
    acceptScene,
    accepted,
    detachInstrumentation,
    detachSimulation,
    map,
    notifySimulation,
    options,
    renderer,
    reportError,
    scheduleProjection,
    session,
    viewStore,
    worker,
  };
}

export function stopDragEvent(x: number) {
  return {
    point: { x, y: 100 },
    lngLat: { lng: -115.2 + x / 10_000, lat: 36.1 },
    originalEvent: {
      button: 0,
      buttons: 1,
      detail: 1,
      altKey: false,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      preventDefault() {},
    },
    preventDefault() {},
  };
}
