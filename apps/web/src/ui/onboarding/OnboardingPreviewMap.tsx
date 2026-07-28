import { useEffect, useRef } from 'react';
import maplibregl, { type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import {
  buildFeatures,
  LAYER_SPECS,
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
import { runStateAt } from '@transitmapper/core/sim/fleet';
import type { TransitSystem } from '@transitmapper/core/model/system';
import {
  ONBOARDING_INBOUND_CUM_LENGTHS,
  ONBOARDING_PATTERN_STATS,
  ONBOARDING_SERVICE_COLOR,
  ONBOARDING_VEHICLE_PROFILE,
} from './fixtureSystem';

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
  /** Slide 3 only: animate a vehicle along the fixture's one service, reusing
   *  the real sim kernel (packages/core/src/sim) instead of a hand-animated
   *  CSS trick. */
  animateVehicle?: boolean;
}

const BLANK_STYLE: StyleSpecification = { version: 8, sources: {}, layers: [] };
const PREVIEW_LAYER_SPECS = LAYER_SPECS.filter((spec) => spec.type !== 'symbol');
const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

export function OnboardingPreviewMap({
  system,
  view,
  className = '',
  animateVehicle = false,
}: OnboardingPreviewMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BLANK_STYLE,
      center: system.viewport.center,
      zoom: system.viewport.zoom,
      interactive: false,
      attributionControl: false,
    });
    map.on('error', (e) => console.error('[onboarding preview]', e.error ?? e));

    let animationFrame: number | undefined;

    map.on('load', () => {
      try {
        registerMapIcons(map);

        const sources = new Set(
          PREVIEW_LAYER_SPECS.map((spec) =>
            'source' in spec ? (spec.source as string) : '',
          ).filter(Boolean),
        );
        for (const src of sources) {
          if (!map.getSource(src)) map.addSource(src, { type: 'geojson', data: EMPTY_FC });
        }
        for (const spec of PREVIEW_LAYER_SPECS) {
          if (!map.getLayer(spec.id)) map.addLayer(spec);
        }

        const fc = buildFeatures(system, null, [], view);
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
        const bounds = systemBounds(system);
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
    // Mounts once per slide (OnboardingDialog only renders the active
    // slide's preview) — system/view are fixed for this component's whole
    // lifetime, unlike ExportPreviewMap's, which tracks a live-editable one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={containerRef} className={`onboarding-preview-map ${className}`.trim()} />;
}
