import type { LayerSpecification, Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl';
import type { TransitSystem } from '@transitmapper/core/model/system';
import type { MapDriver, MapViewStore, SelectionController } from '@transitmapper/map';
import type { MapPresentationStateV1 } from '@transitmapper/views';
import {
  createSnapshotMapDriver,
  documentLayerSpecsForViewMode,
  type SnapshotMapPresentation,
  type SnapshotMapSession,
} from '@transitmapper/map/snapshot';
import { createFeatureProjectionWorker } from '@transitmapper/renderer/projection-worker';
import {
  COMMITTED_SYSTEM_FEATURE_SOURCES,
  LYR_LANDMARKS,
  LYR_LANDMARK_LABELS,
  SRC_LANDMARKS,
  SRC_STATIONS,
  logicalRenderLayerId,
} from '@transitmapper/map/layers';
import type { ColorScheme } from '../theme/color-scheme';
import {
  DOCUMENT_VIEW_FILTER_IDS,
  DOCUMENT_MAP_DEFINITION,
  resolveDocumentMapPresentation,
} from '@transitmapper/map/presentation';
import { landmarksFeatureCollection } from '../map/landmarks';
import { registerMapIcons } from '../map/layers';
import { layerSpecsForScheme } from '../map/mapTheme';
import { markFirstSystemMapPaint } from '../perf/mapPaintMark';
import { viewerFeatureReference } from './viewer-feature-reference';

export const VIEWER_DOCUMENT_SOURCE_IDS = [
  ...COMMITTED_SYSTEM_FEATURE_SOURCES,
  SRC_LANDMARKS,
] as const;
const viewerDocumentSourceIds = new Set<string>(VIEWER_DOCUMENT_SOURCE_IDS);

export interface ViewerDocumentMapStyle {
  readonly current: ColorScheme;
}

export interface CreateViewerDocumentMapOptions {
  readonly system: TransitSystem;
  readonly viewStore: MapViewStore;
  readonly selection: SelectionController;
  readonly style: ViewerDocumentMapStyle;
  readonly onSessionChange?: (session: SnapshotMapSession | null) => void;
}

declare global {
  interface Window {
    __viewerSnapshotSession?: SnapshotMapSession;
  }
}

function layerSource(spec: LayerSpecification): string | null {
  return 'source' in spec && typeof spec.source === 'string' ? spec.source : null;
}

function viewerLayerSpecsForPresentation(
  catalog: readonly LayerSpecification[],
  presentation: SnapshotMapPresentation,
): LayerSpecification[] {
  return documentLayerSpecsForViewMode(catalog, presentation.viewMode).filter((spec) => {
    const source = layerSource(spec);
    return source !== null && viewerDocumentSourceIds.has(source);
  });
}

export function viewerLayerSpecsForState(
  catalog: readonly LayerSpecification[],
  state: MapPresentationStateV1,
): LayerSpecification[] {
  return viewerLayerSpecsForPresentation(catalog, resolveDocumentMapPresentation(state));
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
  if (
    map.getLayer(LYR_LANDMARK_LABELS) &&
    map.getLayoutProperty(LYR_LANDMARK_LABELS, 'visibility') !== visibility
  ) {
    map.setLayoutProperty(LYR_LANDMARK_LABELS, 'visibility', visibility);
  }
}

function setBasemapVisible(map: MapLibreMap, visible: boolean, scheme: ColorScheme): void {
  const documentLayerIds = new Set(
    layerSpecsForScheme(scheme)
      .filter((layer) => {
        const source = layerSource(layer);
        return source !== null && viewerDocumentSourceIds.has(source);
      })
      .map((layer) => layer.id),
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
  session: SnapshotMapSession,
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
  session: SnapshotMapSession,
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

function attachPaintProof(session: SnapshotMapSession): () => void {
  const onRender = () => {
    if (!session.map.getSource(SRC_STATIONS) || !session.map.isSourceLoaded(SRC_STATIONS)) return;
    session.map.off('render', onRender);
    markFirstSystemMapPaint();
  };
  session.map.on('render', onRender);
  session.map.triggerRepaint();
  return () => session.map.off('render', onRender);
}

export function createViewerDocumentMap(options: CreateViewerDocumentMapOptions): MapDriver {
  return createSnapshotMapDriver({
    definition: DOCUMENT_MAP_DEFINITION,
    system: options.system,
    layerSpecs: () => layerSpecsForScheme(options.style.current),
    layerSpecsForPresentation: viewerLayerSpecsForPresentation,
    resolvePresentation: resolveDocumentMapPresentation,
    createFeatureProjectionWorker,
    setupStaticSources: (map) => addStaticSources(map, options.style.current),
    attachSession: (session) => {
      options.onSessionChange?.(session);
      if (import.meta.env.DEV) window.__viewerSnapshotSession = session;
      const detachPaintProof = attachPaintProof(session);
      const detachPresentation = attachPresentation(session, options);
      const detachSelection = attachReaderSelection(session, options.selection);
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
          if (import.meta.env.DEV && window.__viewerSnapshotSession === session) {
            delete window.__viewerSnapshotSession;
          }
          detachPaintProof();
          detachSelection();
          detachPresentation();
        },
      };
    },
  });
}
