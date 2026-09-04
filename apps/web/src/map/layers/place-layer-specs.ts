import type { LayerSpecification } from 'maplibre-gl';
import { VEHICLE_FILL_OPACITY } from '@transitmapper/core/style/catalogStyle';
import type { MapTheme } from '../mapThemePalette';
import {
  LYR_SERVICE_ARROWS,
  LYR_STATIONS,
  LYR_STATION_LABELS,
  LYR_STATION_LABELS_MAJOR,
  LYR_STATION_SELECTED,
  LYR_VEHICLES,
  LYR_VEHICLES_INFRA_FILL,
  LYR_VEHICLES_INFRA_STROKE,
  LYR_WAY_LABELS,
  SRC_SERVICE_ARROWS,
  SRC_STATIONS,
  SRC_VEHICLES,
  SRC_VEHICLES_INFRA,
  SRC_WAY_LABELS,
} from '@transitmapper/renderer/layers';

/** Stations, vehicles, and every label drawn over them. */

export function stationLayerSpecs(theme: MapTheme): LayerSpecification[] {
  return [
    {
      id: LYR_STATION_SELECTED,
      type: 'circle',
      source: SRC_STATIONS,
      // feature-state driven (see LYR_WAY_SELECTED).
      paint: {
        'circle-radius': ['case', ['get', 'interchange'], 12, 10],
        'circle-color': [
          'case',
          ['boolean', ['feature-state', 'selected'], false],
          theme.selection,
          theme.hover,
        ],
        'circle-opacity': [
          'case',
          ['boolean', ['feature-state', 'selected'], false],
          0.18,
          ['boolean', ['feature-state', 'hover'], false],
          0.1,
          0,
        ],
      },
    },
    {
      // Travel arrows on a service line, for a stretch only one of its two
      // directions rides. Sits ABOVE the service lines, unlike the lane arrows
      // above: those describe the street and belong on the asphalt underneath,
      // while these describe the line and are unreadable anywhere but on top of
      // it. Drawn in the line's own colour with a paper halo so a couplet's two
      // halves each say which way they run against a pale basemap — the lane
      // arrows' near-white would vanish there.
      id: LYR_SERVICE_ARROWS,
      type: 'symbol',
      source: SRC_SERVICE_ARROWS,
      minzoom: 13,
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 90,
        'text-field': '▶',
        'text-size': 11,
        'text-keep-upright': false,
        'text-allow-overlap': true,
        'text-ignore-placement': true,
        'text-font': ['literal', ['Noto Sans Regular']],
      },
      paint: {
        'text-color': ['coalesce', ['get', 'color'], theme.laneMarking],
        'text-halo-color': theme.labelHalo,
        'text-halo-width': 1.4,
      },
    },
    {
      id: LYR_STATIONS,
      type: 'circle',
      source: SRC_STATIONS,
      paint: {
        // Gently zoom-scaled with a REASONABLE FLOOR — dots stay clearly visible
        // and clickable even zoomed out (min r4 intermediate / r5 interchange),
        // just a touch smaller than full size, trimming some low-zoom fill-rate.
        // Full size (r5/r7) returns at street zoom. Export bloat (thousands of
        // stops in one frame) is handled separately, on the export map only
        // (map/export/exportRenderer.ts), NOT by shrinking the live dots.
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          11,
          ['case', ['get', 'interchange'], 5, 4],
          14,
          ['case', ['get', 'interchange'], 7, 5],
        ],
        'circle-color': theme.paper,
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 11, 2.2, 14, 3],
        'circle-stroke-color': ['case', ['get', 'interchange'], theme.ink, ['get', 'color']],
      },
    },
  ];
}

export function vehicleLayerSpecs(theme: MapTheme): LayerSpecification[] {
  return [
    {
      // One dot per service, driven by sim/vehicles.ts's own rAF loop directly
      // pushing to SRC_VEHICLES — bypasses the store entirely (ambient motion,
      // never a system mutation), so its data is never touched by buildFeatures.
      id: LYR_VEHICLES,
      type: 'circle',
      source: SRC_VEHICLES,
      paint: {
        'circle-radius': 5,
        'circle-color': ['get', 'color'],
        'circle-stroke-width': 2,
        'circle-stroke-color': theme.paper,
      },
    },
    {
      // Infrastructure-view vehicles: a real rotated-rectangle polygon per
      // vehicle, true-to-scale and riding its actual physical lane (see
      // sim/vehicles.ts + geometry/vehicleLane.ts) — the same class of
      // feature as a station footprint/platform (LYR_FOOTPRINTS_FILL/
      // LYR_PLATFORMS_FILL above), not a raster icon. Filled with the
      // vehicle's own route color, unlike the monochrome footprint fill,
      // since a vehicle belongs to one service.
      id: LYR_VEHICLES_INFRA_FILL,
      type: 'fill',
      source: SRC_VEHICLES_INFRA,
      paint: { 'fill-color': ['get', 'color'], 'fill-opacity': VEHICLE_FILL_OPACITY },
    },
    {
      id: LYR_VEHICLES_INFRA_STROKE,
      type: 'line',
      source: SRC_VEHICLES_INFRA,
      paint: { 'line-color': theme.vehicleStroke, 'line-width': 1 },
    },
  ];
}

export function labelLayerSpecs(theme: MapTheme): LayerSpecification[] {
  return [
    {
      // MAJOR station labels — interchanges (derived) and hand-flagged major
      // stops (Station.majorStop) — shown from a lower zoom than ordinary stops.
      // Placed BEFORE the ordinary-stop layer so its labels win MapLibre's
      // collision placement. minzoom skips its placement work entirely below the
      // threshold; at the post-import whole-valley framing that removes ~all of
      // the 3787-label symbol-collision cost that made panning drop frames.
      // Two variable anchors (was four) — fewer per-label placement attempts.
      id: LYR_STATION_LABELS_MAJOR,
      type: 'symbol',
      source: SRC_STATIONS,
      minzoom: 12,
      filter: ['all', ['!=', ['get', 'name'], ''], ['get', 'major']],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': [
          'case',
          ['get', 'interchange'],
          ['literal', ['Noto Sans Bold']],
          ['literal', ['Noto Sans Regular']],
        ],
        'text-size': 12,
        'text-variable-anchor': ['top', 'bottom'],
        'text-radial-offset': 0.7,
        'text-justify': 'auto',
        'text-allow-overlap': false,
        'text-optional': true,
        // Interchanges outrank plain major stops when they compete for space.
        'symbol-sort-key': ['case', ['get', 'interchange'], 0, 1],
      },
      paint: {
        'text-color': theme.ink,
        'text-halo-color': theme.labelHalo,
        'text-halo-width': 1.4,
      },
    },
    {
      // Ordinary station labels — every OTHER named stop (empty-name ones stay
      // unlabeled). Only from z14+, where a neighborhood's worth of stops is on
      // screen instead of the whole valley's worth colliding into unreadable
      // soup. Anchor varies so collision can slide a label around its station.
      id: LYR_STATION_LABELS,
      type: 'symbol',
      source: SRC_STATIONS,
      minzoom: 14,
      filter: ['all', ['!=', ['get', 'name'], ''], ['!', ['get', 'major']]],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['literal', ['Noto Sans Regular']],
        'text-size': 12,
        'text-variable-anchor': ['top', 'bottom'],
        'text-radial-offset': 0.7,
        'text-justify': 'auto',
        'text-allow-overlap': false,
        'text-optional': true,
        'symbol-sort-key': 2,
      },
      paint: {
        'text-color': theme.ink,
        'text-halo-color': theme.labelHalo,
        'text-halo-width': 1.4,
      },
    },
    {
      // Street/line/trail names along their ways — classic map street labels,
      // only at zooms where the name is about THIS street, not clutter.
      id: LYR_WAY_LABELS,
      type: 'symbol',
      source: SRC_WAY_LABELS,
      minzoom: 13,
      layout: {
        'symbol-placement': 'line',
        'text-field': ['get', 'name'],
        'text-font': ['literal', ['Noto Sans Regular']],
        'text-size': 12,
        'text-letter-spacing': 0.05,
      },
      paint: {
        'text-color': theme.mutedContext,
        'text-halo-color': theme.labelHalo,
        'text-halo-width': 1.4,
      },
    },
  ];
}
