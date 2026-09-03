import type { FilterSpecification, LayerSpecification } from 'maplibre-gl';
import {
  LYR_ACTION_ANCHOR,
  LYR_LINE_CASING,
  LYR_LINE_STRIPE,
  LYR_LINE_STRIPE_HIT,
  LYR_LINE_STRIPE_SELECTED,
  LYR_SERVICES_ELEVATED,
  LYR_SERVICES_HIT,
  LYR_SERVICES_SOLID,
  LYR_SERVICES_SOLID_CASING,
  LYR_SERVICES_UNDERGROUND,
  LYR_SERVICES_UNDERGROUND_CASING,
  LYR_SERVICE_SELECTED,
  RENDER_TIER_SORT_KEY_EXPR,
  SELECT_HALO_WIDTH_EXPR,
  SERVICE_CASING_WIDTH_EXPR,
  SERVICE_ELEVATED_WIDTH_EXPR,
  SERVICE_WIDTH_EXPR,
  LYR_SERVICE_TERMINI,
  LYR_SERVICE_TERMINI_HIT,
  SRC_ACTION_ANCHOR,
  SRC_HIT_FEATURES,
  SRC_SERVICE_TERMINI,
  SRC_SERVICES,
  TIER_OPACITY_EXPR,
  tierOpacityExpr,
} from '@transitmapper/renderer/layers';
import type { MapTheme } from '../mapThemePalette';

/** Every layer that paints `SRC_SERVICES`.
 *
 * Two generations share the source. `lineSceneLayerSpecs` paints the resolved
 * Line scene, keyed on `routeRole`, and the `service*` functions paint the
 * per-Service geometry the infrastructure view still produces. The legacy
 * layers therefore have to exclude anything carrying `routeRole`, or a Line
 * would draw twice — once as its own stripe and once as the old geometry
 * underneath it. `legacyServiceGradeFilter` is where that exclusion lives. */

function legacyServiceGradeFilter(underground: boolean): FilterSpecification {
  return underground
    ? ['all', ['!', ['get', 'hitTarget']], ['!', ['has', 'routeRole']], ['get', 'underground']]
    : [
        'all',
        ['!', ['get', 'hitTarget']],
        ['!', ['has', 'routeRole']],
        ['!', ['get', 'underground']],
      ];
}

export function serviceLineLayerSpecs(theme: MapTheme): LayerSpecification[] {
  return [
    {
      // Elevated ways get a dark casing beneath — reads as a viaduct.
      id: LYR_SERVICES_ELEVATED,
      type: 'line',
      source: SRC_SERVICES,
      filter: [
        'all',
        ['!', ['get', 'hitTarget']],
        ['!', ['has', 'routeRole']],
        ['get', 'elevated'],
      ],
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
        'line-sort-key': RENDER_TIER_SORT_KEY_EXPR as never,
      },
      paint: {
        'line-color': theme.routeCasing,
        'line-width': SERVICE_ELEVATED_WIDTH_EXPR as never,
        'line-opacity': tierOpacityExpr(0.32) as never,
        'line-offset': ['get', 'offset'],
      },
    },
    {
      id: LYR_SERVICE_SELECTED,
      type: 'line',
      source: SRC_SERVICES,
      filter: ['all', ['!', ['get', 'hitTarget']], ['!', ['has', 'routeRole']]],
      // feature-state driven (see LYR_WAY_SELECTED). Selecting a way also lights
      // its rider services here — MapCanvas sets state on their serviceIds.
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
        'line-width': SELECT_HALO_WIDTH_EXPR as never,
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

export function servicePaintLayerSpecs(theme: MapTheme): LayerSpecification[] {
  return [
    {
      id: LYR_SERVICES_SOLID_CASING,
      type: 'line',
      source: SRC_SERVICES,
      filter: legacyServiceGradeFilter(false),
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
        'line-sort-key': RENDER_TIER_SORT_KEY_EXPR as never,
      },
      paint: {
        'line-color': theme.routeCasing,
        'line-width': SERVICE_CASING_WIDTH_EXPR as never,
        'line-opacity': tierOpacityExpr(0.72) as never,
        'line-offset': ['get', 'offset'],
      },
    },
    {
      id: LYR_SERVICES_SOLID,
      type: 'line',
      source: SRC_SERVICES,
      filter: legacyServiceGradeFilter(false),
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
      // Underground ways render dashed, like a tunnel.
      id: LYR_SERVICES_UNDERGROUND_CASING,
      type: 'line',
      source: SRC_SERVICES,
      filter: legacyServiceGradeFilter(true),
      layout: {
        'line-cap': 'butt',
        'line-join': 'round',
        'line-sort-key': RENDER_TIER_SORT_KEY_EXPR as never,
      },
      paint: {
        'line-color': theme.routeCasing,
        'line-width': SERVICE_CASING_WIDTH_EXPR as never,
        'line-dasharray': [2.5, 2],
        'line-opacity': tierOpacityExpr(0.72) as never,
        'line-offset': ['get', 'offset'],
      },
    },
    {
      id: LYR_SERVICES_UNDERGROUND,
      type: 'line',
      source: SRC_SERVICES,
      filter: legacyServiceGradeFilter(true),
      layout: {
        'line-cap': 'butt',
        'line-join': 'round',
        'line-sort-key': RENDER_TIER_SORT_KEY_EXPR as never,
      },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': SERVICE_WIDTH_EXPR as never,
        'line-dasharray': [2.5, 2],
        'line-opacity': TIER_OPACITY_EXPR as never,
        'line-offset': ['get', 'offset'],
      },
    },
  ];
}

export function serviceHitLayerSpecs(theme: MapTheme): LayerSpecification[] {
  return [
    {
      // Kept at zero opacity but queryable. It carries pattern/run/leg identity
      // where a service rides the same physical way more than once.
      id: LYR_SERVICES_HIT,
      type: 'line',
      source: SRC_HIT_FEATURES,
      filter: ['get', 'hitTarget'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': theme.ink,
        'line-width': 24,
        'line-opacity': 0,
        // The hit surface must sit on the same fanned/lane path as the line it
        // names; otherwise a bundled repeated line catches clicks at its center.
        'line-offset': ['get', 'offset'],
      },
    },
  ];
}

export function lineSceneLayerSpecs(theme: MapTheme): LayerSpecification[] {
  return [
    {
      id: LYR_LINE_CASING,
      type: 'line',
      source: SRC_SERVICES,
      filter: ['==', ['get', 'routeRole'], 'casing'],
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
        'line-sort-key': RENDER_TIER_SORT_KEY_EXPR as never,
      },
      paint: {
        'line-color': theme.routeCasing,
        'line-width': SERVICE_CASING_WIDTH_EXPR as never,
        'line-opacity': tierOpacityExpr(0.72) as never,
        'line-offset': ['get', 'offset'],
      },
    },
    {
      id: LYR_LINE_STRIPE,
      type: 'line',
      source: SRC_SERVICES,
      filter: ['==', ['get', 'routeRole'], 'stripe'],
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
      // A shared casing has no Line identity, so Line selection only lights
      // the stripe that carries lineId.
      id: LYR_LINE_STRIPE_SELECTED,
      type: 'line',
      source: SRC_SERVICES,
      filter: ['==', ['get', 'routeRole'], 'stripe'],
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
        'line-width': SELECT_HALO_WIDTH_EXPR as never,
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
    {
      // Network selection comes from the visible Line stripe. No per-Service
      // hit feature exists in this view, so shared corridors remain clickable
      // without multiplying invisible geometry.
      id: LYR_LINE_STRIPE_HIT,
      type: 'line',
      source: SRC_SERVICES,
      filter: ['==', ['get', 'routeRole'], 'stripe'],
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

export function serviceControlLayerSpecs(theme: MapTheme): LayerSpecification[] {
  return [
    {
      // Route ends sit above the occurrence hit surface so a coincident branch
      // resolves to the branch the inspector or map most recently focused.
      id: LYR_SERVICE_TERMINI,
      type: 'circle',
      source: SRC_SERVICE_TERMINI,
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
      id: LYR_SERVICE_TERMINI_HIT,
      type: 'circle',
      source: SRC_SERVICE_TERMINI,
      filter: ['get', 'interactive'],
      paint: { 'circle-radius': 14, 'circle-color': theme.ink, 'circle-opacity': 0 },
    },
    {
      id: LYR_ACTION_ANCHOR,
      type: 'circle',
      source: SRC_ACTION_ANCHOR,
      paint: {
        'circle-radius': 7,
        'circle-color': theme.paper,
        'circle-stroke-width': 2.5,
        'circle-stroke-color': theme.ink,
      },
    },
  ];
}
