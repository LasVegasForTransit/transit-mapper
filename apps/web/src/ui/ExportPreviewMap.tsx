import { useEffect, useRef } from 'react';
import maplibregl, { type Map as MLMap } from 'maplibre-gl';
import type { ViewOptions } from '@transitmapper/core/render/buildFeatures';
import { registerMapIcons, SRC_STATIONS } from '../map/layers';
import { addExportSourcesAndLayers, setExportFeatureData } from '../map/export/exportLayerSetup';
import { systemBounds } from '@transitmapper/core/model/geo';
import type { TransitSystem } from '@transitmapper/core/model/system';
import { basemapStyleForScheme } from '../map/mapTheme';
import { createRenderSettlementMarker } from '../map/render-settlement-marker';
import { projectFeaturesForFittedMap } from '../map/static-render-features';
import {
  createFeatureProjectionWorker,
  type FeatureProjectionWorkerClient,
} from '../map/feature-projection-worker';

/**
 * A second, read-only MapLibre instance for the export dialog — deliberately
 * separate from the app's main map (map/MapCanvas.tsx) so panning/zooming it
 * to frame an export never touches the live editing view. Plain interactions
 * (drag/scroll/double-click zoom) instead of the app's SimCity-style
 * right-drag-to-pan scheme, since there's nothing to draw here.
 */
interface ExportPreviewMapProps {
  system: TransitSystem;
  view: ViewOptions;
  onReady: (map: MLMap) => void;
}

function createExportPreviewMap(container: HTMLDivElement, system: TransitSystem): MLMap {
  return new maplibregl.Map({
    container,
    style: basemapStyleForScheme('light'),
    center: system.viewport.center,
    zoom: system.viewport.zoom,
    preserveDrawingBuffer: true, // needed to read the canvas back out for PNG export
    attributionControl: false,
    // The export UI promises pan and zoom, not a second 3D camera. Keeping it
    // flat and north-up lets SVG projection run exactly off-thread.
    dragRotate: false,
    touchPitch: false,
    pitchWithRotate: false,
  });
}

export function ExportPreviewMap({ system, view, onReady }: ExportPreviewMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const featureProjectionRef = useRef<FeatureProjectionWorkerClient | null>(null);
  const projectionAbortRef = useRef<AbortController | null>(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    if (!containerRef.current) return;
    const settlement = createRenderSettlementMarker(containerRef.current);
    const featureProjection = createFeatureProjectionWorker();
    featureProjectionRef.current = featureProjection;
    const map = createExportPreviewMap(containerRef.current, system);
    mapRef.current = map;
    const onCameraSettled = () => pushDataRef.current();

    map.on('load', () => {
      registerMapIcons(map, 'light');
      addExportSourcesAndLayers(map);

      // Resize BEFORE fitting bounds — the dialog's layout (and this map's
      // container) may not have settled to its final size yet at "load"
      // time, and fitBounds computes its zoom from whatever size the
      // container reports right now. Fitting first would frame against a
      // stale (often smaller) size and leave the real system off-screen.
      map.resize();
      const bounds = systemBounds(system);
      if (bounds) map.fitBounds(bounds, { padding: 40, animate: false });

      pushDataRef.current();
      onReadyRef.current(map);
      map.on('moveend', onCameraSettled);
      map.on('resize', onCameraSettled);
    });

    const ro = new ResizeObserver(() => map.resize());
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      settlement.clear();
      projectionAbortRef.current?.abort();
      projectionAbortRef.current = null;
      featureProjection.dispose();
      featureProjectionRef.current = null;
      mapRef.current = null;
      map.off('moveend', onCameraSettled);
      map.off('resize', onCameraSettled);
      map.remove();
    };
    // Mounts once; the preview map's own life (bounds fit, sources) starts
    // from whatever `system`/`view` are at mount time — see the separate
    // effect below for keeping its data in sync as those props change.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mounts once; another effect syncs data
  }, []);

  const pushData = () => {
    const map = mapRef.current;
    const featureProjection = featureProjectionRef.current;
    if (!map?.getSource(SRC_STATIONS) || !featureProjection) return;
    if (containerRef.current) delete containerRef.current.dataset.renderSettled;
    projectionAbortRef.current?.abort();
    const abort = new AbortController();
    projectionAbortRef.current = abort;
    void projectFeaturesForFittedMap({
      worker: featureProjection,
      system,
      view,
      map,
      signal: abort.signal,
    })
      .then((features) => {
        if (abort.signal.aborted || mapRef.current !== map) return;
        setExportFeatureData(map, features);
        map.once('idle', () => {
          if (containerRef.current) containerRef.current.dataset.renderSettled = 'true';
        });
      })
      .catch((error: unknown) => {
        if (!abort.signal.aborted)
          console.error('[export preview] feature projection failed.', error);
      });
  };
  const pushDataRef = useRef(pushData);
  pushDataRef.current = pushData;

  useEffect(() => {
    pushDataRef.current();
  }, [system, view]);

  return <div ref={containerRef} className="export-preview-map" />;
}

/** Re-fit the given map to the whole system's extent — the export dialog's
 *  "Reset framing" action, for when a user has panned away from it. */
export function resetFraming(map: MLMap, system: TransitSystem): void {
  const bounds = systemBounds(system);
  if (bounds) map.fitBounds(bounds, { padding: 40, animate: true });
}
