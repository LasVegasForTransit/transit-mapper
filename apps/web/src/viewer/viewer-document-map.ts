import type { Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl';
import type { TransitSystem } from '@transitmapper/core/model/system';
import type { MapDriver, MapViewStore, SelectionController } from '@transitmapper/map';
import {
  createDocumentMapDriver,
  documentLayerSpecsForViewMode,
  type DocumentMapSession,
  type DocumentMapSnapshotSource,
} from '@transitmapper/renderer/driver';
import {
  LYR_LANDMARKS,
  LYR_LANDMARK_LABELS,
  SRC_LANDMARKS,
  logicalRenderLayerId,
  sourceBankLayerSpecs,
} from '@transitmapper/renderer/layers';
import type { ColorScheme } from '../theme/systemColorScheme';
import { DOCUMENT_VIEW_FILTER_IDS } from '../editor/document-view-adapter';
import {
  DOCUMENT_MAP_DEFINITION,
  resolveDocumentMapPresentation,
} from '../editor/document-map-definition';
import { landmarksFeatureCollection } from '../map/landmarks';
import { registerMapIcons } from '../map/layers';
import { layerSpecsForScheme } from '../map/mapTheme';
import { viewerFeatureReference } from './viewer-feature-reference';

export interface ViewerDocumentMapStyle {
  readonly current: ColorScheme;
}

export interface CreateViewerDocumentMapOptions {
  readonly system: TransitSystem;
  readonly viewStore: MapViewStore;
  readonly selection: SelectionController;
  readonly style: ViewerDocumentMapStyle;
  readonly onSessionChange?: (session: DocumentMapSession | null) => void;
}

declare global {
  interface Window {
    __viewerDocumentSession?: DocumentMapSession;
  }
}

function readySource(system: TransitSystem): DocumentMapSnapshotSource {
  const snapshot = Object.freeze({ status: 'ready' as const, system });
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
  };
}

function addStaticSources(map: MapLibreMap, scheme: ColorScheme): void {
  registerMapIcons(map, scheme);
  if (!map.getSource(SRC_LANDMARKS)) {
    map.addSource(SRC_LANDMARKS, { type: 'geojson', data: landmarksFeatureCollection() });
  }
}

function applyLandmarkVisibility(map: MapLibreMap, viewStore: MapViewStore): void {
  const state = viewStore.getSnapshot();
  const enabled = state.filters[DOCUMENT_VIEW_FILTER_IDS.landmarks] !== false;
  const visibility = enabled && state.representationId !== 'diagram' ? 'visible' : 'none';
  if (
    map.getLayer(LYR_LANDMARKS) &&
    map.getLayoutProperty(LYR_LANDMARKS, 'visibility') !== visibility
  ) {
    map.setLayoutProperty(LYR_LANDMARKS, 'visibility', visibility);
  }
  if (map.getLayer(LYR_LANDMARK_LABELS)) {
    if (map.getLayoutProperty(LYR_LANDMARK_LABELS, 'visibility') !== visibility) {
      map.setLayoutProperty(LYR_LANDMARK_LABELS, 'visibility', visibility);
    }
  }
}

function setBasemapVisible(map: MapLibreMap, visible: boolean, scheme: ColorScheme): void {
  const documentLayerIds = new Set(
    sourceBankLayerSpecs(layerSpecsForScheme(scheme)).map((layer) => layer.id),
  );
  const visibility = visible ? 'visible' : 'none';
  for (const layer of map.getStyle().layers) {
    if (
      !documentLayerIds.has(layer.id) &&
      map.getLayoutProperty(layer.id, 'visibility') !== visibility
    ) {
      map.setLayoutProperty(layer.id, 'visibility', visibility);
    }
  }
}

function attachPresentation(
  session: DocumentMapSession,
  options: CreateViewerDocumentMapOptions,
): () => void {
  const initial = options.viewStore.getSnapshot();
  let previousRepresentation = initial.representationId;
  let previousLandmarks = initial.filters[DOCUMENT_VIEW_FILTER_IDS.landmarks];
  applyLandmarkVisibility(session.map, options.viewStore);
  setBasemapVisible(session.map, initial.representationId !== 'diagram', options.style.current);
  return options.viewStore.subscribe((state) => {
    const landmarks = state.filters[DOCUMENT_VIEW_FILTER_IDS.landmarks];
    if (previousRepresentation === state.representationId && previousLandmarks === landmarks) {
      return;
    }
    previousRepresentation = state.representationId;
    previousLandmarks = landmarks;
    applyLandmarkVisibility(session.map, options.viewStore);
    setBasemapVisible(session.map, state.representationId !== 'diagram', options.style.current);
  });
}

function attachReaderSelection(
  session: DocumentMapSession,
  selection: SelectionController,
): () => void {
  const onClick = (event: MapMouseEvent) => {
    const reference = session.map
      .queryRenderedFeatures(event.point)
      .map((feature) =>
        viewerFeatureReference(feature.properties, logicalRenderLayerId(feature.layer.id)),
      )
      .find((candidate) => candidate !== undefined);
    selection.select(reference);
  };
  session.map.on('click', onClick);
  return () => session.map.off('click', onClick);
}

export function createViewerDocumentMap(options: CreateViewerDocumentMapOptions): MapDriver {
  return createDocumentMapDriver({
    definition: DOCUMENT_MAP_DEFINITION,
    source: readySource(options.system),
    layerSpecs: () => layerSpecsForScheme(options.style.current),
    layerSpecsForPresentation: (catalog, presentation) =>
      documentLayerSpecsForViewMode(catalog, presentation.viewMode),
    resolvePresentation: resolveDocumentMapPresentation,
    setupStaticSources: (map) => addStaticSources(map, options.style.current),
    attachSession: (session) => {
      options.onSessionChange?.(session);
      if (import.meta.env.DEV) window.__viewerDocumentSession = session;
      const detachPresentation = attachPresentation(session, options);
      const detachSelection = attachReaderSelection(session, options.selection);
      const onResize = () => session.scheduleProjection();
      session.map.on('resize', onResize);
      return {
        restoreAfterStyle: () => {
          applyLandmarkVisibility(session.map, options.viewStore);
          setBasemapVisible(
            session.map,
            options.viewStore.getSnapshot().representationId !== 'diagram',
            options.style.current,
          );
        },
        dispose() {
          options.onSessionChange?.(null);
          if (import.meta.env.DEV && window.__viewerDocumentSession === session) {
            delete window.__viewerDocumentSession;
          }
          session.map.off('resize', onResize);
          detachSelection();
          detachPresentation();
        },
      };
    },
  });
}
