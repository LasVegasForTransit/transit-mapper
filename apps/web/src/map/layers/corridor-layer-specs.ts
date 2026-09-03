import type { LayerSpecification } from 'maplibre-gl';
import { type MapTheme } from '../mapThemePalette';
import {
  CORRIDOR_CASING_WIDTH_EXPR,
  CORRIDOR_SELECT_HALO_WIDTH_EXPR,
  CORRIDOR_WIDTH_EXPR,
  RENDER_TIER_SORT_KEY_EXPR,
  LYR_CARRIAGEWAYS,
  LYR_JUNCTION_SELECTED,
  LYR_WAYS_DASHED,
  LYR_WAYS_DASHED_CASING,
  LYR_WAYS_SOLID,
  LYR_WAYS_SOLID_CASING,
  LYR_WAY_SELECTED,
  SRC_JUNCTIONS,
  SRC_WAYS,
  tierOpacityExpr,
} from '@transitmapper/renderer/layers';

/** Corridors: the authored geometry a Way carries. */

export function corridorLayerSpecs(theme: MapTheme): LayerSpecification[] {
  return [
    {
      id: LYR_JUNCTION_SELECTED,
      type: 'line',
      source: SRC_JUNCTIONS,
      paint: {
        'line-color': [
          'case',
          ['boolean', ['feature-state', 'selected'], false],
          theme.selection,
          theme.hover,
        ],
        'line-width': 2.5,
        'line-opacity': tierOpacityExpr([
          'case',
          ['boolean', ['feature-state', 'selected'], false],
          0.7,
          ['boolean', ['feature-state', 'hover'], false],
          0.35,
          0,
        ]) as never,
      },
    },
    {
      // A selected bare/infra way gets the same soft dark halo a selected
      // service does (LYR_SERVICE_SELECTED below) — without this, selecting a
      // way via the Objects list (kind:"way", not "service") drew nothing
      // different at all, since only service features ever carried a
      // `selected` flag before.
      id: LYR_WAY_SELECTED,
      type: 'line',
      source: SRC_WAYS,
      // Driven by EditorFeatureState, not a `selected` property. Selection
      // therefore changes MapLibre paint state instead of re-uploading the
      // RTC-scale source, and the state follows the accepted physical bank.
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
        'line-sort-key': RENDER_TIER_SORT_KEY_EXPR as never,
      },
      paint: {
        'line-color': [
          'case',
          ['boolean', ['feature-state', 'selected'], false],
          theme.selection,
          theme.hover,
        ],
        'line-width': CORRIDOR_SELECT_HALO_WIDTH_EXPR as never,
        'line-opacity': tierOpacityExpr([
          'case',
          ['boolean', ['feature-state', 'selected'], false],
          0.18,
          ['boolean', ['feature-state', 'hover'], false],
          0.1,
          0,
        ]) as never,
        'line-offset': ['get', 'offset'],
      },
    },
  ];
}

function districtCarriagewayLayerSpec(theme: MapTheme): LayerSpecification {
  // District is a real metric corridor footprint. Overview stays a line; the
  // selection line layer reads this polygon as its perimeter halo.
  return {
    id: LYR_CARRIAGEWAYS,
    type: 'fill',
    source: SRC_WAYS,
    filter: ['==', ['get', 'renderTier'], 'district'],
    paint: {
      'fill-color': ['get', 'color'],
      // A footprint still needs a readable edge before individual Street lanes
      // take over. This is MapLibre's one-pixel fill outline, not an
      // artificially widened centerline casing.
      'fill-outline-color': theme.routeCasing,
      'fill-opacity': tierOpacityExpr(0.9) as never,
    },
  };
}

function dashedCorridorLayerSpecs(theme: MapTheme): LayerSpecification[] {
  return [
    {
      id: LYR_WAYS_DASHED_CASING,
      type: 'line',
      source: SRC_WAYS,
      filter: ['get', 'dashed'],
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
        'line-sort-key': RENDER_TIER_SORT_KEY_EXPR as never,
      },
      paint: {
        'line-color': theme.routeCasing,
        'line-width': CORRIDOR_CASING_WIDTH_EXPR as never,
        'line-dasharray': [2, 2],
        'line-opacity': tierOpacityExpr(0.62) as never,
        'line-offset': ['get', 'offset'],
      },
    },
    {
      id: LYR_WAYS_DASHED,
      type: 'line',
      source: SRC_WAYS,
      filter: ['get', 'dashed'],
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
        'line-sort-key': RENDER_TIER_SORT_KEY_EXPR as never,
      },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': CORRIDOR_WIDTH_EXPR as never,
        'line-dasharray': [2, 2],
        'line-opacity': tierOpacityExpr(0.9) as never,
        'line-offset': ['get', 'offset'],
      },
    },
  ];
}

export function corridorPaintLayerSpecs(theme: MapTheme): LayerSpecification[] {
  return [
    districtCarriagewayLayerSpec(theme),
    {
      // Overview and District are one centered corridor silhouette. Street
      // replaces this source with physical lane surfaces; `line-offset`
      // remains for schematic service/corridor compatibility only.
      id: LYR_WAYS_SOLID_CASING,
      type: 'line',
      source: SRC_WAYS,
      filter: [
        'all',
        ['==', ['geometry-type'], 'LineString'],
        ['!', ['get', 'dashed']],
        ['!', ['to-boolean', ['get', 'haloOnly']]],
      ],
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
        'line-sort-key': RENDER_TIER_SORT_KEY_EXPR as never,
      },
      paint: {
        'line-color': theme.routeCasing,
        'line-width': CORRIDOR_CASING_WIDTH_EXPR as never,
        'line-opacity': tierOpacityExpr(0.62) as never,
        'line-offset': ['get', 'offset'],
      },
    },
    {
      id: LYR_WAYS_SOLID,
      type: 'line',
      source: SRC_WAYS,
      // haloOnly features exist purely for LYR_WAY_SELECTED (a lane-rendered
      // way's selection glow) — they must never paint as a solid line.
      filter: [
        'all',
        ['==', ['geometry-type'], 'LineString'],
        ['!', ['get', 'dashed']],
        ['!', ['to-boolean', ['get', 'haloOnly']]],
      ],
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
        'line-sort-key': RENDER_TIER_SORT_KEY_EXPR as never,
      },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': CORRIDOR_WIDTH_EXPR as never,
        // Match the Street lane-surface alpha so the order-aware tier
        // expression preserves one constant corridor silhouette through the
        // District/Street blend.
        'line-opacity': tierOpacityExpr(0.9) as never,
        'line-offset': ['get', 'offset'],
      },
    },
    ...dashedCorridorLayerSpecs(theme),
  ];
}
