import { useEffect, useRef } from 'react';
import maplibregl, { type GeoJSONSource } from 'maplibre-gl';
import {
  buildFeatures,
  registerMapIcons,
  SRC_FACILITIES,
  SRC_FOOTPRINTS,
  SRC_PLATFORMS,
  SRC_SERVICES,
  SRC_STATIONS,
  SRC_VEHICLES,
  SRC_WAYS,
  type ViewOptions,
} from '../../map/layers';
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

    let animationFrame: number | undefined;

    map.on('load', () => {
      try {
        registerMapIcons(map, colorScheme);

        const sources = new Set(
          previewLayerSpecs
            .map((spec) => ('source' in spec ? (spec.source as string) : ''))
            .filter(Boolean),
        );
        for (const src of sources) {
          if (!map.getSource(src)) map.addSource(src, { type: 'geojson', data: EMPTY_FC });
        }
        for (const spec of previewLayerSpecs) {
          if (!map.getLayer(spec.id)) map.addLayer(spec);
        }

        const fc = buildFeatures(renderedSystem, null, [], view);
        const setData = (id: string, data: GeoJSON.FeatureCollection) => {
          (map.getSource(id) as GeoJSONSource | undefined)?.setData(data);
        };
        setData(SRC_WAYS, fc.ways);
        setData(SRC_SERVICES, fc.services);
        setData(SRC_STATIONS, fc.stations);
        setData(SRC_FOOTPRINTS, fc.footprints);
        setData(SRC_PLATFORMS, fc.platforms);
        setData(SRC_FACILITIES, fc.facilities);

        // Resize before framing: fitBounds solves for the viewport it's told
        // about, so fitting against a stale container size (the dialog's
        // layout may not have settled yet at "load" time) frames the wrong
        // extent — the same ordering ExportPreviewMap/embed/main.ts use.
        map.resize();
        const bounds = systemBounds(renderedSystem);
        if (bounds) map.fitBounds(bounds, { padding: 24, animate: false });

        if (animateVehicle) {
          const { path, cumLengths, inboundPath, timetables, plan } = ONBOARDING_PATTERN_STATS;
          // plan is non-null here — fixtureSystem.ts throws at module load
          // otherwise, so ONBOARDING_PATTERN_STATS never reaches this file
          // in that state.
          const mountedAt = performance.now();
          const tick = () => {
            const simMs = (performance.now() - mountedAt) % plan!.cycleMs;
            const state = runStateAt(simMs, timetables, plan!, 0, ONBOARDING_VEHICLE_PROFILE);
            // Outbound and inbound are different geometry in general (a
            // couplet's two directions ride different streets), so each
            // needs its own path + arc-lengths, not just the outbound pair
            // PatternStats carries by default.
            const point =
              state.run === 'outbound'
                ? pointAtDistance(path, cumLengths, state.distMeters)
                : pointAtDistance(inboundPath, ONBOARDING_INBOUND_CUM_LENGTHS, state.distMeters);
            setData(SRC_VEHICLES, {
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
        }
      } catch (e) {
        console.error('[onboarding preview]', e);
      }
    });

    return () => {
      if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
      map.remove();
    };
    // Each slide can reuse this React component position with a different
    // view or animation treatment. Rebuild the tiny non-interactive map when
    // that presentation changes so Infrastructure never keeps Network's
    // already-mounted layers after the user advances.
  }, [animateVehicle, colorScheme, system, view]);

  return <div ref={containerRef} className={`onboarding-preview-map ${className}`.trim()} />;
}
