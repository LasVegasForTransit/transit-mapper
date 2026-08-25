import type { GeoJSONSource, PaddingOptions } from 'maplibre-gl';
import type { LngLat } from '@transitmapper/core/model/system';
import { routePath } from '@transitmapper/core/model/routeGraph';
import type { RenderViewOptions } from '@transitmapper/core/render/buildFeatures';
import type { MapViewStore } from '@transitmapper/map';
import type { DocumentMapSession } from '@transitmapper/renderer/driver';
import { SRC_PREVIEW } from '@transitmapper/renderer/layers';
import { selectionFocus } from '../map/selectionFocus';
import type { EditorStore } from './store';

type EditorMapState = ReturnType<EditorStore['getState']>;

export interface EditorMapViewOptions {
  readonly store: MapViewStore;
  setRepresentation(id: string): void;
  framePadding(margin: number): PaddingOptions | number;
  renderView(): RenderViewOptions;
}

export function syncRoutePreview(
  session: DocumentMapSession,
  current: EditorMapState,
  previous: EditorMapState,
): void {
  if (current.routeDraft === previous.routeDraft) return;
  const features = (current.routeDraft?.spans ?? [])
    .map((span) => ({ span, path: routePath(current.system, [span]) }))
    .filter(({ path }) => path.length >= 2)
    .map(({ span, path }) => ({
      type: 'Feature' as const,
      properties: { wrongWay: span.wrongWay === true },
      geometry: { type: 'LineString' as const, coordinates: path },
    }));
  session.map.getSource<GeoJSONSource>(SRC_PREVIEW)?.setData({
    type: 'FeatureCollection',
    features,
  });
}

export function syncSelectionFocus(
  session: DocumentMapSession,
  view: EditorMapViewOptions,
  current: EditorMapState,
  previous: EditorMapState,
): void {
  if (current.cameraFocusToken === previous.cameraFocusToken) return;
  const focus = selectionFocus(current.system, current.selection);
  if (!focus) return;
  if (focus.needsInfrastructureView) view.setRepresentation('infrastructure');
  session.map.fitBounds(focus.bounds, {
    padding: view.framePadding(100),
    maxZoom: 18,
    duration: 500,
  });
}

export function focusEditorFootprint(
  session: DocumentMapSession,
  view: EditorMapViewOptions,
  footprint: readonly LngLat[],
): void {
  view.setRepresentation('infrastructure');
  const west = Math.min(...footprint.map(([longitude]) => longitude));
  const east = Math.max(...footprint.map(([longitude]) => longitude));
  const south = Math.min(...footprint.map(([, latitude]) => latitude));
  const north = Math.max(...footprint.map(([, latitude]) => latitude));
  session.map.fitBounds(
    [
      [west, south],
      [east, north],
    ],
    { padding: view.framePadding(120), maxZoom: 19, duration: 600 },
  );
}
