import type { FilterSpecification, LayerSpecification } from 'maplibre-gl';
import {
  LYR_PATTERN_OVERLAY,
  LYR_PATTERN_OVERLAY_ARROWS,
  LYR_PATTERN_OVERLAY_CASING,
  LYR_PATTERN_OVERLAY_HIT,
  LYR_PATTERN_OVERLAY_TERMINI,
  LYR_PATTERN_OVERLAY_TERMINI_HIT,
  RENDER_TIER_SORT_KEY_EXPR,
  SELECT_HALO_WIDTH_EXPR,
  SERVICE_WIDTH_EXPR,
  SRC_PATTERN_OVERLAY,
  SRC_PATTERN_OVERLAY_ARROWS,
  SRC_PATTERN_OVERLAY_TERMINI,
  TIER_OPACITY_EXPR,
  tierOpacityExpr,
} from '@transitmapper/renderer/layers';
import type { MapTheme } from '../mapThemePalette';

function pathLayerSpecs(theme: MapTheme, pathFilter: FilterSpecification): LayerSpecification[] {
  return [
    {
      id: LYR_PATTERN_OVERLAY_CASING,
      type: 'line',
      source: SRC_PATTERN_OVERLAY,
      filter: pathFilter,
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
        'line-sort-key': RENDER_TIER_SORT_KEY_EXPR as never,
      },
      paint: {
        'line-color': theme.selection,
        'line-width': SELECT_HALO_WIDTH_EXPR as never,
        'line-opacity': tierOpacityExpr(0.38) as never,
        'line-offset': ['get', 'offset'],
      },
    },
    {
      id: LYR_PATTERN_OVERLAY,
      type: 'line',
      source: SRC_PATTERN_OVERLAY,
      filter: pathFilter,
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
        'line-sort-key': RENDER_TIER_SORT_KEY_EXPR as never,
      },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': SERVICE_WIDTH_EXPR as never,
        'line-opacity': TIER_OPACITY_EXPR as never,
        'line-offset': ['get', 'offset'],
      },
    },
    {
      id: LYR_PATTERN_OVERLAY_HIT,
      type: 'line',
      source: SRC_PATTERN_OVERLAY,
      filter: ['get', 'hitTarget'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': theme.ink,
        'line-width': 24,
        'line-opacity': 0,
        'line-offset': ['get', 'offset'],
      },
    },
  ];
}

function directionLayerSpecs(theme: MapTheme): LayerSpecification[] {
  return [
    {
      id: LYR_PATTERN_OVERLAY_ARROWS,
      type: 'symbol',
      source: SRC_PATTERN_OVERLAY_ARROWS,
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
  ];
}

function terminusLayerSpecs(theme: MapTheme): LayerSpecification[] {
  return [
    {
      id: LYR_PATTERN_OVERLAY_TERMINI,
      type: 'circle',
      source: SRC_PATTERN_OVERLAY_TERMINI,
      paint: {
        'circle-radius': ['case', ['boolean', ['get', 'armedReturn'], false], 10, 8],
        'circle-color': [
          'case',
          ['boolean', ['get', 'armedReturn'], false],
          theme.ink,
          theme.paper,
        ],
        'circle-stroke-width': 3,
        'circle-stroke-color': [
          'case',
          ['boolean', ['get', 'armedReturn'], false],
          theme.paper,
          theme.ink,
        ],
      },
    },
    {
      id: LYR_PATTERN_OVERLAY_TERMINI_HIT,
      type: 'circle',
      source: SRC_PATTERN_OVERLAY_TERMINI,
      filter: ['get', 'interactive'],
      paint: { 'circle-radius': 14, 'circle-color': theme.ink, 'circle-opacity': 0 },
    },
  ];
}

/** An opened path sits above its Line stripe without changing what the
 * committed Network scene contains. The editor installs these sources and
 * layers; document, viewer, and export compositions exclude them. */
export function patternOverlayLayerSpecs(theme: MapTheme): LayerSpecification[] {
  const pathFilter: FilterSpecification = ['!', ['get', 'hitTarget']];
  return [
    ...pathLayerSpecs(theme, pathFilter),
    ...directionLayerSpecs(theme),
    ...terminusLayerSpecs(theme),
  ];
}
