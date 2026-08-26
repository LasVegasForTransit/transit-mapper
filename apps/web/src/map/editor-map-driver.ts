import type { Map as MLMap } from 'maplibre-gl';
import type { MapDriver, MapViewStore } from '@transitmapper/map';
import type { RenderViewOptions, ViewOptions } from '@transitmapper/core/render/buildFeatures';
import {
  ALL_SYSTEM_FEATURE_SOURCES,
  LYR_LANDMARKS,
  LYR_LANDMARK_LABELS,
  SRC_ACTION_ANCHOR,
  SRC_ENDPOINT_HINT,
  SRC_GESTURE,
  SRC_HIT_FEATURES,
  SRC_JUNCTION_GUIDES,
  SRC_LANDMARKS,
  SRC_MARQUEE,
  SRC_PREVIEW,
  SRC_SERVICES,
  SRC_SHARING,
  SRC_VEHICLES,
  SRC_VEHICLES_INFRA,
  SRC_WAYS,
  physicalRenderSourceIds,
  renderOverlayNeedsHealing,
  sourceBankLayerSpecs,
} from '@transitmapper/renderer/layers';
import {
  createDiagramLayoutWorker,
  createFeatureProjectionWorker,
  createSourceFeatureProjectionAccounting,
} from '@transitmapper/renderer/projection';
import type { DocumentMapSession } from '@transitmapper/renderer/driver';
import { createRendererStatsCollector } from '@transitmapper/renderer/stats';
import { createRenderTierStateResolver } from '@transitmapper/core/render/render-presentation';
import { renderPresentationFromMap } from '@transitmapper/renderer/driver';
import { documentLayerSpecsForViewMode } from '@transitmapper/renderer/driver';
import { createEditorDocumentMap } from '../editor/document-map';
import { attachEditorMap, type EditorMapAttachment } from '../editor/editor-map-attachment';
import { editorMapSurfaceLayerSpecs } from '../editor/editor-map-layers';
import { attachKeyboard } from '../editor/keymap';
import { DOCUMENT_VIEW_FILTER_IDS } from '../editor/document-view-adapter';
import { attachVehicleAnimation } from '../sim/vehicles';
import { withVehiclePaintingSuspension } from '../sim/vehicle-painting-gate';
import { landmarksFeatureCollection } from './landmarks';
import { LAYER_SPECS, registerMapIcons } from './layers';
import { claimEditorMapNavigation } from './editor-map-navigation';
import { layerSpecsForScheme } from './mapTheme';
import {
  carryDocumentStyle,
  documentOverlayIsRetained,
  editorDocumentLayersForScheme,
} from './document-style-carry';
import {
  createProjectionOperationCounts,
  recordSourceUpload,
  type ProjectionOperationCounts,
} from './gestureProjection';
import { attachEditorMapInstrumentation } from './editor-map-instrumentation';
import type { EditorMapDriverPorts, EditorMapStyleBridge } from './editor-map-ports';

const PERF_HARNESS_BUILD = import.meta.env.DEV || import.meta.env.VITE_PERF_BUILD === '1';
const LOGICAL_SOURCES = [
  ...ALL_SYSTEM_FEATURE_SOURCES,
  SRC_HIT_FEATURES,
  SRC_ACTION_ANCHOR,
  SRC_PREVIEW,
  SRC_GESTURE,
  SRC_SHARING,
  SRC_ENDPOINT_HINT,
  SRC_MARQUEE,
  SRC_VEHICLES,
  SRC_VEHICLES_INFRA,
  SRC_JUNCTION_GUIDES,
] as const;
const PHYSICAL_SOURCES = physicalRenderSourceIds(LOGICAL_SOURCES);

function mapPresentation(map: MLMap) {
  const canvas = map.getCanvas();
  const container = map.getContainer();
  return renderPresentationFromMap({
    bounds: map.getBounds(),
    zoom: map.getZoom(),
    viewportWidthPx: canvas.clientWidth,
    viewportHeightPx: canvas.clientHeight,
    displayedWidthPx: container.clientWidth,
    displayedHeightPx: container.clientHeight,
    pixelRatio: map.getPixelRatio(),
  });
}

function createRenderView(ports: EditorMapDriverPorts, map: MLMap): () => RenderViewOptions {
  const tierStateResolver = createRenderTierStateResolver();
  return () => {
    const view = ports.viewStore.getSnapshot();
    return {
      viewMode: view.representationId as ViewOptions['viewMode'],
      visibleModes: new Set(view.filters[DOCUMENT_VIEW_FILTER_IDS.modes] as string[]),
      visibleWayTypes: new Set(view.filters[DOCUMENT_VIEW_FILTER_IDS.wayTypes] as string[]),
      presentation: mapPresentation(map),
      styleDeferredVisibility: true,
      tierStateResolver,
    };
  };
}

function addEditorSources(map: MLMap): void {
  const empty = { type: 'FeatureCollection' as const, features: [] };
  for (const sourceId of PHYSICAL_SOURCES) {
    if (map.getSource(sourceId)) continue;
    const heavy = sourceId.startsWith(SRC_WAYS) || sourceId.startsWith(SRC_SERVICES);
    map.addSource(sourceId, {
      type: 'geojson',
      data: empty,
      ...(heavy ? { tolerance: 1 } : {}),
    });
  }
  if (!map.getSource(SRC_LANDMARKS)) {
    map.addSource(SRC_LANDMARKS, { type: 'geojson', data: landmarksFeatureCollection() });
  }
}

function applyLandmarkVisibility(map: MLMap, viewStore: MapViewStore): void {
  const state = viewStore.getSnapshot();
  const enabled = state.filters[DOCUMENT_VIEW_FILTER_IDS.landmarks] !== false;
  const visibility = enabled && state.representationId !== 'diagram' ? 'visible' : 'none';
  if (map.getLayer(LYR_LANDMARKS)) map.setLayoutProperty(LYR_LANDMARKS, 'visibility', visibility);
  if (map.getLayer(LYR_LANDMARK_LABELS)) {
    map.setLayoutProperty(LYR_LANDMARK_LABELS, 'visibility', visibility);
  }
}

function setBasemapVisible(map: MLMap, visible: boolean): void {
  const owned = new Set(sourceBankLayerSpecs(LAYER_SPECS).map((layer) => layer.id));
  for (const layer of map.getStyle().layers) {
    if (!owned.has(layer.id)) {
      map.setLayoutProperty(layer.id, 'visibility', visible ? 'visible' : 'none');
    }
  }
}

function recordSceneUpdate(
  counts: ProjectionOperationCounts,
  stats: ReturnType<typeof createRendererStatsCollector>,
  update: ReturnType<DocumentMapSession['renderer']['updateEditorScene']> | null,
): void {
  if (!update) return;
  counts.sourceUploadCount += update.sourceUploadCount;
  if (update.strategy === 'full') stats.recordFullUpload(update.sourceUploadCount);
  else if (update.strategy === 'patch') {
    stats.recordPatch({
      addedFeatureCount: update.addedFeatureCount + update.changedFeatureCount,
      removedFeatureCount: update.removedFeatureCount,
      sourceUploadCount: update.sourceUploadCount,
    });
  }
}

function attachViewPresentation(
  session: DocumentMapSession,
  ports: EditorMapDriverPorts,
): () => void {
  let previousRepresentation = ports.viewStore.getSnapshot().representationId;
  applyLandmarkVisibility(session.map, ports.viewStore);
  return ports.viewStore.subscribe((state) => {
    const nextRepresentation = state.representationId;
    if (previousRepresentation === 'diagram' && nextRepresentation !== 'diagram') {
      setBasemapVisible(session.map, true);
    }
    previousRepresentation = nextRepresentation;
    applyLandmarkVisibility(session.map, ports.viewStore);
    session.map.triggerRepaint();
  });
}

// One factory keeps the deferred renderer resources and its editor extension in one disposal scope.
// eslint-disable-next-line max-lines-per-function -- Splitting this scope would duplicate lifecycle ownership.
export function createEditorMapDriver(ports: EditorMapDriverPorts): MapDriver {
  const counts = createProjectionOperationCounts();
  const accounting = createSourceFeatureProjectionAccounting();
  const stats = createRendererStatsCollector();
  const sourceRef: { current?: ReturnType<typeof createEditorDocumentMap>['source'] } = {};
  let attachment: EditorMapAttachment | null = null;

  const composition = createEditorDocumentMap({
    store: ports.store,
    layerSpecs: () => layerSpecsForScheme(ports.style.current.activeTheme),
    layerSpecsForPresentation: (catalog, presentation) =>
      documentLayerSpecsForViewMode(catalog, presentation.viewMode),
    surfaceLayerSpecsForPresentation: (catalog, presentation) =>
      editorMapSurfaceLayerSpecs(
        catalog,
        documentLayerSpecsForViewMode(catalog, presentation.viewMode),
      ),
    setupStaticSources: (map) => {
      registerMapIcons(map, ports.style.current.activeTheme);
      addEditorSources(map);
    },
    createFeatureProjectionWorker,
    createDiagramLayoutWorker,
    projectionAccounting: accounting,
    rendererStats: stats,
    instrumentationEnabled: PERF_HARNESS_BUILD,
    // eslint-disable-next-line max-lines-per-function -- This transaction claims navigation before attaching editor ports and rolls both back together.
    attachSession: (session, signal) => {
      const renderView = createRenderView(ports, session.map);
      const detachView = attachViewPresentation(session, ports);
      const detachResize = (() => {
        const onResize = () => session.scheduleProjection();
        session.map.on('resize', onResize);
        return () => session.map.off('resize', onResize);
      })();
      const releaseNativeNavigation = claimEditorMapNavigation(session.map);
      try {
        attachment = attachEditorMap(
          session,
          {
            document: {
              store: ports.store,
              get source() {
                if (!sourceRef.current)
                  throw new Error('The editor document source is unavailable.');
                return sourceRef.current;
              },
            },
            layers: {
              catalog: () => layerSpecsForScheme(ports.style.current.activeTheme),
            },
            view: {
              store: ports.viewStore,
              setRepresentation: (mode) => ports.setRepresentation(mode),
              framePadding: (margin) => ports.framePadding(margin),
              renderView,
            },
            interactions: {
              tuning: ports.tuning,
              openShortcuts: () => ports.openShortcuts(),
              toggleUi: () => ports.toggleUi(),
              attachKeyboard,
              openContextMenu: (...args) => ports.openContextMenu(...args),
              closeContextMenu: () => ports.closeContextMenu(),
              isContextMenuOpen: () => ports.isContextMenuOpen(),
              onPointerIntent: (...args) => ports.onPointerIntent(...args),
              registerPointerIntentRefresh: (refresh) =>
                ports.registerPointerIntentRefresh(refresh),
              openTerminusConnectionChoice: (choice) => ports.openTerminusConnectionChoice(choice),
            },
            simulation: {
              attach: (_session, store, isDirectManipulationActive) => {
                const gate = withVehiclePaintingSuspension(
                  ports.vehicleGate.createGate(isDirectManipulationActive),
                  {
                    isSuspended: () =>
                      !session.renderer.hasAcceptedScene() ||
                      session.renderer.hasActiveProjection() ||
                      session.renderer.publicationInProgress(),
                    subscribe: (listener) =>
                      session.subscribeAcceptedScene(() => {
                        listener();
                      }),
                  },
                );
                return attachVehicleAnimation(session.map, store, ports.simClock, gate);
              },
              notify: () => ports.vehicleGate.notify(),
            },
            projection: {
              createWorker: createFeatureProjectionWorker,
              gestureCounts: counts,
              overlayNeedsHealing: () =>
                renderOverlayNeedsHealing({
                  sourceIds: PHYSICAL_SOURCES,
                  layerIds: sourceBankLayerSpecs(
                    documentLayerSpecsForViewMode(
                      layerSpecsForScheme(ports.style.current.activeTheme),
                      ports.viewStore.getSnapshot().representationId as ViewOptions['viewMode'],
                    ),
                  ).map((layer) => layer.id),
                  hasSource: (sourceId) => Boolean(session.map.getSource(sourceId)),
                  hasLayer: (layerId) => Boolean(session.map.getLayer(layerId)),
                }),
              beginAccounting: () => accounting.begin(),
              recordUpdate: (update) => recordSceneUpdate(counts, stats, update),
              recordSourceUpload: () => recordSourceUpload(counts),
            },
            instrumentation: {
              attach: () => ({
                dispose: attachEditorMapInstrumentation({
                  session,
                  ports,
                  counts,
                  accounting,
                  stats,
                  attachment: () => attachment,
                  hideBasemap: () => setBasemapVisible(session.map, false),
                }),
              }),
            },
            flushTheme: () => ports.style.current.runtime?.flushTheme(),
            reportError: (error) => ports.reportError(error),
          },
          signal,
        );
      } catch (error) {
        releaseNativeNavigation();
        detachResize();
        detachView();
        throw error;
      }
      ports.style.current = createLoadedStyleBridge(ports.style.current, session, attachment);
      return {
        synchronizeInteractionState: (targets) => attachment?.applySelection(targets),
        refreshInteractionPreviews: () => attachment?.restoreGesturePreview(),
        restoreAfterStyle: () => attachment?.restoreAfterStyle(),
        dispose() {
          detachResize();
          detachView();
          attachment?.dispose();
          attachment = null;
          releaseNativeNavigation();
        },
      };
    },
  });
  sourceRef.current = composition.source;
  return composition.driver;
}

function createLoadedStyleBridge(
  previous: EditorMapStyleBridge,
  session: DocumentMapSession,
  attachment: EditorMapAttachment,
): EditorMapStyleBridge {
  return {
    ...previous,
    get runtime() {
      return previous.runtime;
    },
    get activeTheme() {
      return previous.activeTheme;
    },
    get attachment() {
      return attachment;
    },
    carry: (before, next, theme) =>
      carryDocumentStyle(before, next, editorDocumentLayersForScheme(theme)),
    retained: () =>
      documentOverlayIsRetained(
        session.map.getStyle(),
        physicalRenderSourceIds([...ALL_SYSTEM_FEATURE_SOURCES, SRC_HIT_FEATURES]),
        editorDocumentLayersForScheme(previous.activeTheme),
      ),
    themeApplied(theme) {
      previous.themeApplied(theme);
      registerMapIcons(session.map, theme);
    },
    recover: () => session.recoverStyle(),
    interactionActive: () =>
      attachment.isInteractionActive() || session.renderer.publicationInProgress(),
    resized: () => session.scheduleProjection(),
  };
}
