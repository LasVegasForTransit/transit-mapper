import { useEffect, useRef } from 'react';
import maplibregl, { type GeoJSONSource, type Map as MLMap } from 'maplibre-gl';
import {
  registerMapIcons,
  SRC_FACILITIES,
  SRC_FOOTPRINTS,
  SRC_PLATFORMS,
  SRC_SERVICES,
  SRC_STATIONS,
  SRC_VEHICLES,
  SRC_WAYS,
} from '../../map/layers';
import type { SystemFeatures, ViewOptions } from '@transitmapper/core/render/buildFeatures';
import { pointAtDistance, systemBounds } from '@transitmapper/core/model/geo';
import { computeDiagramSystem } from '@transitmapper/core/model/diagramLayout';
import { runStateAt } from '@transitmapper/core/sim/fleet';
import type { TransitSystem } from '@transitmapper/core/model/system';
import {
  ONBOARDING_INBOUND_CUM_LENGTHS,
  ONBOARDING_PATTERN_STATS,
  ONBOARDING_SERVICE_COLOR,
  ONBOARDING_VEHICLE_PROFILE,
} from './fixtureSystem';
import { useSystemColorScheme } from '../../theme/systemColorScheme';
import { layerSpecsForScheme, localBlankStyleForScheme } from '../../map/mapTheme';
import { createRenderSettlementMarker } from '../../map/render-settlement-marker';
import { projectFeaturesForFittedMap } from '../../map/static-render-features';
import { createFeatureProjectionWorker } from '../../map/feature-projection-worker';

/**
 * A third, independent MapLibre instance — alongside the app's main map
 * (map/MapCanvas.tsx) and the export dialog's (ui/ExportPreviewMap.tsx) —
 * for the onboarding dialog's live slide previews. Two things set it apart
 * from those:
 *
 * - No basemap: `style` is blank, so there's no tile fetch and the preview
 *   paints instantly. Symbol layers (labels, drag-handle icons) are dropped
 *   too — they need a `glyphs` URL this style deliberately doesn't provide,
 *   and there's no room for legible text at thumbnail size anyway.
 * - Non-interactive: this is a picture that happens to be a real map, not
 *   something to pan or zoom.
 *
 * Sources are derived from LAYER_SPECS itself (the pattern apps/web/src/embed
 * /main.ts uses) rather than hand-listed — ExportPreviewMap.tsx hand-lists
 * ten sources for a LAYER_SPECS that references more than that, which is
 * only safe there because MapLibre reports a missing source through its own
 * 'error' event instead of throwing (confirmed by embed/main.ts's own
 * comment on the same recipe), so the gap never surfaced as a crash.
 */
interface OnboardingPreviewMapProps {
  system: TransitSystem;
  view: ViewOptions;
  className?: string;
  /** The route-sketching slide animates a vehicle along the fixture's
   *  Crosstown service, reusing the real sim kernel (packages/core/src/sim)
   *  instead of a hand-animated CSS trick. */
  animateVehicle?: boolean;
}

const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

function setOnboardingFeatureData(map: MLMap, features: SystemFeatures): void {
  const setData = (id: string, data: GeoJSON.FeatureCollection) => {
    map.getSource<GeoJSONSource>(id)?.setData(data);
  };
  setData(SRC_WAYS, features.ways);
  setData(SRC_SERVICES, features.services);
  setData(SRC_STATIONS, features.stops);
  setData(SRC_FOOTPRINTS, features.footprints);
  setData(SRC_PLATFORMS, features.platforms);
  setData(SRC_FACILITIES, features.facilities);
}

function addOnboardingPreviewOverlay(
  map: MLMap,
  previewLayerSpecs: ReturnType<typeof layerSpecsForScheme>,
): void {
  const sources = new Set(
    previewLayerSpecs.map((spec) => ('source' in spec ? spec.source : '')).filter(Boolean),
  );
  for (const source of sources) {
    if (!map.getSource(source)) map.addSource(source, { type: 'geojson', data: EMPTY_FC });
  }
  for (const spec of previewLayerSpecs) {
    if (!map.getLayer(spec.id)) map.addLayer(spec);
  }
}

interface OnboardingFeatureProjectionOptions {
  readonly map: MLMap;
  readonly featureProjection: ReturnType<typeof createFeatureProjectionWorker>;
  readonly system: TransitSystem;
  readonly view: ViewOptions;
  readonly settlement: ReturnType<typeof createRenderSettlementMarker>;
  readonly signal: AbortSignal;
}

async function projectOnboardingFeatures({
  map,
  featureProjection,
  system,
  view,
  settlement,
  signal,
}: OnboardingFeatureProjectionOptions): Promise<void> {
  const features = await projectFeaturesForFittedMap({
    worker: featureProjection,
    system,
    view,
    map,
    signal,
  });
  if (signal.aborted) return;
  setOnboardingFeatureData(map, features);
  map.once('idle', () => settlement.markSettled());
}

/** The vehicle preview follows the real service plan so its motion remains a
 * faithful example of the editor's simulation rather than an unrelated demo. */
function startOnboardingVehicleAnimation(map: MLMap): () => void {
  const { path, cumLengths, inboundPath, timetables, plan } = ONBOARDING_PATTERN_STATS;
  if (!plan) throw new Error('The onboarding fixture must have a runnable service plan.');
  const mountedAt = performance.now();
  let animationFrame: number | undefined;
  const tick = () => {
    const simMs = (performance.now() - mountedAt) % plan.cycleMs;
    const state = runStateAt(simMs, timetables, plan, 0, ONBOARDING_VEHICLE_PROFILE);
    // Outbound and inbound are different geometry in general (a couplet's two
    // directions ride different streets), so each needs its own path +
    // arc-lengths, not just the outbound pair PatternStats carries by default.
    const point =
      state.run === 'outbound'
        ? pointAtDistance(path, cumLengths, state.distMeters)
        : pointAtDistance(inboundPath, ONBOARDING_INBOUND_CUM_LENGTHS, state.distMeters);
    map.getSource<GeoJSONSource>(SRC_VEHICLES)?.setData({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: point },
          properties: { color: ONBOARDING_SERVICE_COLOR },
        },
      ],
    });
    animationFrame = requestAnimationFrame(tick);
  };
  tick();
  return () => {
    if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
  };
}

export function OnboardingPreviewMap({
  system,
  view,
  className = '',
  animateVehicle = false,
}: OnboardingPreviewMapProps) {
  const colorScheme = useSystemColorScheme();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const settlement = createRenderSettlementMarker(containerRef.current);
    const featureProjection = createFeatureProjectionWorker();
    const projectionAbort = new AbortController();
    const renderedSystem = view.viewMode === 'diagram' ? computeDiagramSystem(system) : system;
    const previewLayerSpecs = layerSpecsForScheme(colorScheme).filter(
      (spec) => spec.type !== 'symbol',
    );
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: localBlankStyleForScheme(colorScheme),
      center: system.viewport.center,
      zoom: system.viewport.zoom,
      interactive: false,
      attributionControl: false,
    });
    map.on('error', (e) => console.error('[onboarding preview]', e.error ?? e));

    let stopVehicleAnimation = () => {};

    map.on('load', () => {
      try {
        registerMapIcons(map, colorScheme);

        addOnboardingPreviewOverlay(map, previewLayerSpecs);

        // Resize before framing: fitBounds solves for the viewport it's told
        // about, so fitting against a stale container size (the dialog's
        // layout may not have settled yet at "load" time) frames the wrong
        // extent — the same ordering ExportPreviewMap/embed/main.ts use.
        map.resize();
        const bounds = systemBounds(renderedSystem);
        if (bounds) map.fitBounds(bounds, { padding: 24, animate: false });

        void projectOnboardingFeatures({
          map,
          featureProjection,
          system: renderedSystem,
          view,
          settlement,
          signal: projectionAbort.signal,
        }).catch((error: unknown) => {
          if (!projectionAbort.signal.aborted) {
            console.error('[onboarding preview] feature projection failed.', error);
          }
        });

        if (animateVehicle) stopVehicleAnimation = startOnboardingVehicleAnimation(map);
      } catch (e) {
        console.error('[onboarding preview]', e);
      }
    });

    return () => {
      projectionAbort.abort();
      featureProjection.dispose();
      stopVehicleAnimation();
      settlement.clear();
      map.remove();
    };
    // Each slide can reuse this React component position with a different
    // view or animation treatment. Rebuild the tiny non-interactive map when
    // that presentation changes so Infrastructure never keeps Network's
    // already-mounted layers after the user advances.
  }, [animateVehicle, colorScheme, system, view]);

  return <div ref={containerRef} className={`onboarding-preview-map ${className}`.trim()} />;
}
