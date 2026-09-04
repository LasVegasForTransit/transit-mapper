import type { LayerSpecification } from 'maplibre-gl';
import {
  FOOTPRINT_FILL_OPACITY,
  PLATFORM_FILL_OPACITY,
} from '@transitmapper/core/style/catalogStyle';
import type { MapTheme } from '../mapThemePalette';
import {
  LYR_CENTER_LINES,
  LYR_CONNECTORS,
  LYR_CROSSWALKS,
  LYR_EDGE_LINES,
  LYR_FOOTPRINTS_FILL,
  LYR_FOOTPRINTS_STROKE,
  LYR_JUNCTIONS,
  LYR_JUNCTION_CONTROLS,
  LYR_JUNCTION_GUIDES,
  LYR_LANDMARKS,
  LYR_LANDMARK_LABELS,
  LYR_LANE_ARROWS,
  LYR_LANE_LINES,
  LYR_LANE_SURFACES,
  LYR_LANE_TRACKS,
  LYR_RAIL_TIES,
  LYR_PLATFORMS_FILL,
  LYR_PLATFORMS_STROKE,
  LYR_STOP_BARS,
  SRC_CONNECTORS,
  SRC_FOOTPRINTS,
  SRC_JUNCTIONS,
  SRC_JUNCTION_GUIDES,
  SRC_LANDMARKS,
  SRC_LANES,
  SRC_LANE_ARROWS,
  SRC_LANE_MARKINGS,
  SRC_PLATFORMS,
  TIER_OPACITY_EXPR,
  tierOpacityExpr,
} from '@transitmapper/renderer/layers';

/** Roadway, rail, and the physical places that sit on them. */

export function contextLayerSpecs(theme: MapTheme): LayerSpecification[] {
  return [
    // Paint order, bottom-up: reference landmarks first (fixed context, not
    // system data — must sit under everything the user actually draws), then
    // the lane-detail STREET SURFACE (junction fills + lane asphalt +
    // markings — it's the ground), then station/complex footprints and
    // platforms ON TOP of it (a station area overlays the road it straddles —
    // painting streets later buried footprints, the "station boundaries are
    // invisible" bug), then ways/services/stations above those.
    {
      // Hand-placed reference points (the Strip, UNLV, downtown, the airport,
      // …) — static context, not user data (see map/landmarks.ts). Muted and
      // small so a real drawn system always reads as the foreground.
      id: LYR_LANDMARKS,
      type: 'circle',
      source: SRC_LANDMARKS,
      paint: { 'circle-radius': 3, 'circle-color': theme.landmark, 'circle-opacity': 0.7 },
    },
    {
      id: LYR_LANDMARK_LABELS,
      type: 'symbol',
      source: SRC_LANDMARKS,
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['literal', ['Noto Sans Regular']],
        'text-size': 11,
        'text-variable-anchor': ['top', 'bottom', 'right', 'left'],
        'text-radial-offset': 0.6,
        'text-allow-overlap': false,
        'text-optional': true,
      },
      paint: {
        'text-color': theme.landmark,
        'text-halo-color': theme.labelHalo,
        'text-halo-width': 1.2,
      },
    },
    {
      // Junction footprints: the shared asphalt where lane-detailed ways meet.
      // Painted BENEATH the lane surfaces so each arm's trimmed carriageway
      // butts cleanly against the footprint.
      id: LYR_JUNCTIONS,
      type: 'fill',
      source: SRC_JUNCTIONS,
      paint: {
        'fill-color': theme.roadSurface,
        'fill-opacity': tierOpacityExpr(0.9) as never,
      },
    },
    {
      // Controls live at the semantic Node, above the shared asphalt but below
      // lane guidance. The same source keeps a node edit one scene update.
      id: LYR_JUNCTION_CONTROLS,
      type: 'circle',
      source: SRC_JUNCTIONS,
      filter: ['has', 'control'],
      paint: {
        'circle-radius': [
          'match',
          ['get', 'control'],
          'roundabout',
          5.5,
          'signal',
          4.5,
          'stop',
          4.5,
          'yield',
          3.5,
          'levelCrossing',
          4,
          4,
        ],
        'circle-color': [
          'match',
          ['get', 'control'],
          'signal',
          theme.danger,
          'stop',
          theme.paper,
          'yield',
          theme.centerLine,
          'roundabout',
          theme.centerLine,
          'levelCrossing',
          theme.ink,
          theme.ink,
        ],
        'circle-stroke-color': theme.ink,
        'circle-stroke-width': 1.2,
        'circle-opacity': tierOpacityExpr(1) as never,
      },
    },
  ];
}

/** Metric lane surfaces are the Street-tier base. Markings deliberately live
 * in the following pass so their visual order is obvious at the call site. */
function laneSurfaceLayerSpecs(): LayerSpecification[] {
  return [
    {
      // Lane surfaces are true metric polygons, built from the same shared
      // cross-section boundaries as static SVG. That keeps adjacent lanes
      // flush at curves instead of relying on screen-space line inflation.
      id: LYR_LANE_SURFACES,
      type: 'fill',
      source: SRC_LANES,
      paint: {
        'fill-color': ['get', 'color'],
        'fill-opacity': tierOpacityExpr(0.9) as never,
      },
    },
  ];
}

/** Track ties paint below the rails they join. Keeping them as their own
 * pass makes the paired rail order explicit below. */
function railTieLayerSpecs(): LayerSpecification[] {
  return [
    {
      // One feature carries a track's ties as a MultiLineString, below the
      // two rails it joins. This is physical detail, not a repeated icon.
      id: LYR_RAIL_TIES,
      type: 'line',
      source: SRC_LANE_MARKINGS,
      filter: ['==', ['get', 'kind'], 'railTie'],
      layout: { 'line-cap': 'butt', 'line-join': 'miter' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': 0.7,
        'line-opacity': tierOpacityExpr(0.78) as never,
      },
    },
  ];
}

/** Rail centerlines follow the ties immediately. A rail is two physical lines,
 * not a generic widened lane surface. */
function railTrackLayerSpecs(): LayerSpecification[] {
  return [
    {
      // Thin-line lanes (rail tracks embedded in or beside a street) — a track
      // is two physical rails, not a slab. Monorail/channel centerlines retain
      // the legacy thinLane classification.
      id: LYR_LANE_TRACKS,
      type: 'line',
      source: SRC_LANE_MARKINGS,
      filter: ['in', ['get', 'kind'], ['literal', ['thinLane', 'rail']]],
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': 1.3,
        'line-opacity': TIER_OPACITY_EXPR as never,
      },
    },
  ];
}

/** Directional roadway boundaries, crosswalks, and stop bars are the surface
 * markings that sit above lanes and below junction movement guidance. */
function surfaceMarkingLayerSpecs(theme: MapTheme): LayerSpecification[] {
  return [
    {
      // Dashed white separator between same-direction lanes.
      id: LYR_LANE_LINES,
      type: 'line',
      source: SRC_LANE_MARKINGS,
      filter: ['==', ['get', 'kind'], 'laneLine'],
      paint: {
        'line-color': theme.laneMarking,
        'line-width': 1.2,
        'line-dasharray': [3, 3],
        'line-opacity': tierOpacityExpr(0.9) as never,
      },
    },
    {
      // Solid edge line where the directional roadway meets sidewalk/parking.
      id: LYR_EDGE_LINES,
      type: 'line',
      source: SRC_LANE_MARKINGS,
      filter: ['==', ['get', 'kind'], 'edgeLine'],
      paint: {
        'line-color': theme.laneMarking,
        'line-width': 1.2,
        'line-opacity': tierOpacityExpr(0.75) as never,
      },
    },
    {
      // The center line where directions oppose — solid yellow.
      id: LYR_CENTER_LINES,
      type: 'line',
      source: SRC_LANE_MARKINGS,
      filter: ['==', ['get', 'kind'], 'centerLine'],
      paint: {
        'line-color': theme.centerLine,
        'line-width': 1.8,
        'line-opacity': tierOpacityExpr(0.95) as never,
      },
    },
    {
      // Approach crosswalks derive from the same resolved junction arms as
      // the carriageway trim, so stripes stay perpendicular through a curve
      // or cross-section edit. They paint over lane boundaries but below turn
      // guidance, which keeps both pedestrian and movement information legible.
      id: LYR_CROSSWALKS,
      type: 'line',
      source: SRC_LANE_MARKINGS,
      filter: ['==', ['get', 'kind'], 'crosswalk'],
      layout: { 'line-cap': 'butt' },
      paint: {
        'line-color': theme.laneMarking,
        'line-width': 1.8,
        'line-opacity': tierOpacityExpr(0.9) as never,
      },
    },
    {
      // The solid bar is intentionally beyond the zebra stripes in the
      // approach direction. It reads as the driver boundary without obscuring
      // the pedestrian crossing or the turn guidance above it.
      id: LYR_STOP_BARS,
      type: 'line',
      source: SRC_LANE_MARKINGS,
      filter: ['==', ['get', 'kind'], 'stopBar'],
      layout: { 'line-cap': 'butt' },
      paint: {
        'line-color': theme.laneMarking,
        'line-width': 2.5,
        'line-opacity': tierOpacityExpr(0.95) as never,
      },
    },
  ];
}

/** Road markings sit over the metric lane polygons. The order reflects the
 * physical drawing order rather than forcing a reader through one long list. */
function laneMarkingLayerSpecs(theme: MapTheme): LayerSpecification[] {
  return [...railTieLayerSpecs(), ...railTrackLayerSpecs(), ...surfaceMarkingLayerSpecs(theme)];
}

export function streetDetailLayerSpecs(theme: MapTheme): LayerSpecification[] {
  return [...laneSurfaceLayerSpecs(), ...laneMarkingLayerSpecs(theme)];
}

export function streetGuidanceLayerSpecs(theme: MapTheme): LayerSpecification[] {
  return [
    {
      // Per-lane turn guides through a junction (from the lane-connectivity
      // graph — stored connectors or the derived defaults). Faint dashes, so
      // they read as guidance rather than paint.
      id: LYR_CONNECTORS,
      type: 'line',
      source: SRC_CONNECTORS,
      layout: { 'line-cap': 'round' },
      paint: {
        'line-color': theme.laneMarking,
        'line-width': 1.2,
        'line-dasharray': [1.5, 2],
        'line-opacity': tierOpacityExpr(0.55) as never,
      },
    },
    {
      // A selected junction's editor-only lane movement guides. Keeping this
      // above the settled connector layer preserves immediate feedback while
      // leaving the renderer-owned source untouched and patchable by ID.
      id: LYR_JUNCTION_GUIDES,
      type: 'line',
      source: SRC_JUNCTION_GUIDES,
      layout: { 'line-cap': 'round' },
      paint: {
        'line-color': theme.laneMarking,
        'line-width': 1.2,
        'line-dasharray': [1.5, 2],
        'line-opacity': tierOpacityExpr(0.55) as never,
      },
    },
    {
      // Direction arrows along each one-way lane, pointing with travel (the
      // geometry engine pre-reverses backward lanes' paths).
      id: LYR_LANE_ARROWS,
      type: 'symbol',
      source: SRC_LANE_ARROWS,
      // Street-tier feature generation and opacity decide when this direction
      // detail exists. A fixed zoom cannot account for corridor width or the
      // size at which an export/embed is actually displayed.
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 90,
        'text-field': '▶',
        'text-size': 10,
        'text-keep-upright': false,
        'text-allow-overlap': true,
        'text-ignore-placement': true,
        // Without this MapLibre asks for its built-in default stack, which the
        // basemap does not serve, so no glyph loads and the arrow silently never
        // draws. Every other text layer here names the stack for the same reason.
        'text-font': ['literal', ['Noto Sans Regular']],
      },
      paint: {
        'text-color': theme.laneMarking,
        'text-opacity': tierOpacityExpr(0.9) as never,
      },
    },
  ];
}

export function physicalPlaceLayerSpecs(theme: MapTheme): LayerSpecification[] {
  return [
    {
      id: LYR_FOOTPRINTS_FILL,
      type: 'fill',
      source: SRC_FOOTPRINTS,
      // A facility complex with its own color reads more clearly with a
      // slightly stronger fill than the shared monochrome default — a station
      // footprint (no color property) keeps the original subtle tint.
      paint: {
        'fill-color': ['coalesce', ['get', 'color'], theme.footprint],
        'fill-opacity': ['case', ['has', 'color'], 0.14, FOOTPRINT_FILL_OPACITY],
      },
    },
    {
      id: LYR_FOOTPRINTS_STROKE,
      type: 'line',
      source: SRC_FOOTPRINTS,
      paint: {
        'line-color': ['coalesce', ['get', 'color'], theme.footprintStroke],
        'line-width': 1.5,
        'line-dasharray': [3, 2],
      },
    },
    {
      id: LYR_PLATFORMS_FILL,
      type: 'fill',
      source: SRC_PLATFORMS,
      paint: { 'fill-color': theme.platform, 'fill-opacity': PLATFORM_FILL_OPACITY },
    },
    {
      id: LYR_PLATFORMS_STROKE,
      type: 'line',
      source: SRC_PLATFORMS,
      paint: { 'line-color': theme.platformStroke, 'line-width': 1.5 },
    },
  ];
}
