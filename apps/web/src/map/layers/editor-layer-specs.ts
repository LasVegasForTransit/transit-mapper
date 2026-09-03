import type { LayerSpecification } from 'maplibre-gl';
import { type MapTheme } from '../mapThemePalette';
import {
  LYR_ENDPOINT_HINT,
  LYR_FACILITIES,
  LYR_FACILITY_LABELS,
  LYR_FACILITY_SELECTED,
  LYR_GESTURE_FILL,
  LYR_GESTURE_LINE,
  LYR_GESTURE_POINT,
  LYR_GESTURE_STROKE,
  LYR_HANDLES,
  LYR_MARQUEE_FILL,
  LYR_MARQUEE_STROKE,
  LYR_PHYSICAL_HANDLES,
  LYR_PREVIEW,
  LYR_PREVIEW_ARROWS,
  LYR_SHARING,
  LYR_WAY_ENDPOINTS,
  SRC_ENDPOINT_HINT,
  SRC_FACILITIES,
  SRC_GESTURE,
  SRC_HANDLES,
  SRC_MARQUEE,
  SRC_PHYSICAL_HANDLES,
  SRC_PREVIEW,
  SRC_SHARING,
} from '@transitmapper/renderer/layers';

/** Surfaces that exist only while somebody is authoring:
 * drawing previews, editable points, facilities, and gesture feedback. */

export function drawingPreviewLayerSpecs(theme: MapTheme): LayerSpecification[] {
  return [
    {
      // "This is what you are about to join." A finished line is rebound onto
      // the infrastructure it runs along, and without showing that beforehand
      // the commit moves the line onto a street with no warning — the preview
      // has to say what the commit will do. Drawn UNDER the dashed preview
      // line, wide and soft, in the line's own colour: the point is that this
      // stretch is about to become part of it.
      id: LYR_SHARING,
      type: 'line',
      source: SRC_SHARING,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': 9,
        'line-opacity': 0.35,
      },
    },
    {
      id: LYR_PREVIEW,
      type: 'line',
      source: SRC_PREVIEW,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        // A stretch the route had to run against traffic (wrongWay) or that
        // the Demolish tool is about to remove (demolish) is drawn in the
        // warning colour, heavier and at full opacity — the rest of the
        // draft is a faint dashed hint, which destructive states must out-read.
        'line-color': [
          'case',
          ['any', ['get', 'wrongWay'], ['get', 'demolish']],
          theme.danger,
          theme.gesturePreview,
        ],
        'line-width': ['case', ['any', ['get', 'wrongWay'], ['get', 'demolish']], 3.5, 3],
        'line-dasharray': [1.5, 1.5],
        'line-opacity': ['case', ['any', ['get', 'wrongWay'], ['get', 'demolish']], 1, 0.75],
      },
    },
    {
      id: LYR_PREVIEW_ARROWS,
      type: 'symbol',
      source: SRC_PREVIEW,
      filter: ['==', ['get', 'oneWayReturn'], true],
      minzoom: 13,
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 80,
        'text-field': '▶',
        'text-size': 11,
        'text-keep-upright': false,
        'text-allow-overlap': true,
        'text-ignore-placement': true,
        'text-font': ['literal', ['Noto Sans Regular']],
      },
      paint: {
        'text-color': theme.gesturePreview,
        'text-halo-color': theme.labelHalo,
        'text-halo-width': 1.4,
      },
    },
  ];
}

export function editorPointLayerSpecs(theme: MapTheme): LayerSpecification[] {
  return [
    {
      // Way tool, not yet drawing, hovering near an existing way's open end:
      // a big soft ring signals "clicking here resumes/extends this way"
      // (see map/interactions.ts's onHoverMove + nearestOpenEndpoint) — clearly
      // bigger and softer than the plain endpoint dot (LYR_WAY_ENDPOINTS)
      // itself, which only ever renders for the active/selected way anyway and
      // wasn't visible at all for the arbitrary other way you're about to snap
      // onto. Also fires WHILE drawing, over the active way's own loop-close
      // vertex (see onHoverMoveImpl's ownLoopCloseTarget branch) — the one
      // case a mid-draw hover still needs an affordance for.
      id: LYR_ENDPOINT_HINT,
      type: 'circle',
      source: SRC_ENDPOINT_HINT,
      paint: {
        'circle-radius': 13,
        'circle-color': theme.hover,
        'circle-opacity': 0.16,
        'circle-stroke-width': 2.5,
        'circle-stroke-color': theme.hover,
        'circle-stroke-opacity': 0.85,
      },
    },
    {
      // Interior control points: reshape only (drag repositions the point). A
      // solid square, not a circle — the standard vector-editor "control
      // point" shape, so it can never be mistaken for a station or facility
      // (both of which stay circular/pictogram markers).
      id: LYR_HANDLES,
      type: 'symbol',
      source: SRC_HANDLES,
      filter: ['!', ['get', 'endpoint']],
      layout: {
        'icon-image': ['get', 'icon'],
        'icon-size': 0.28,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    },
    {
      // A way's open ends: drag to EXTEND (adds a new point), not reshape —
      // deliberately inverted (ink fill / light ring) so it never reads as a
      // regular handle or, worse, a station stop.
      id: LYR_WAY_ENDPOINTS,
      type: 'circle',
      source: SRC_HANDLES,
      filter: ['get', 'endpoint'],
      paint: {
        'circle-radius': 7,
        'circle-color': theme.handle,
        'circle-stroke-width': 2,
        'circle-stroke-color': theme.labelHalo,
      },
    },
    {
      id: LYR_FACILITY_SELECTED,
      type: 'circle',
      source: SRC_FACILITIES,
      // feature-state driven (see LYR_WAY_SELECTED).
      paint: {
        'circle-radius': ['+', ['get', 'radius'], 5],
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
  ];
}

export function facilityLayerSpecs(theme: MapTheme): LayerSpecification[] {
  return [
    {
      // Catalog-typed point facilities (entrances, bike docks, depots, …) —
      // each type gets its own pictogram (map/icons.ts, rasterized from the
      // same glyph set as the React UI) so they read as distinct real-world
      // things instead of interchangeable colored dots.
      id: LYR_FACILITIES,
      type: 'symbol',
      source: SRC_FACILITIES,
      layout: {
        'icon-image': ['get', 'icon'],
        'icon-size': 0.4,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    },
    {
      // Named facilities only — most stay unlabeled (an "entrance" pictogram
      // is usually self-explanatory), but a named depot/yard or parking lot
      // reads much better with its name on the map.
      id: LYR_FACILITY_LABELS,
      type: 'symbol',
      source: SRC_FACILITIES,
      // Facility names are close-up infrastructure detail (depots, entrances) —
      // no reason to place/collide them at overview zooms.
      minzoom: 14,
      filter: ['!=', ['get', 'name'], ''],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['literal', ['Noto Sans Regular']],
        'text-size': 11,
        'text-variable-anchor': ['bottom', 'top', 'right', 'left'],
        'text-radial-offset': 0.9,
        'text-allow-overlap': false,
        'text-optional': true,
      },
      paint: {
        'text-color': theme.ink,
        'text-halo-color': theme.labelHalo,
        'text-halo-width': 1.4,
      },
    },
    {
      // Footprint/platform vertices of the station currently being edited —
      // same reshape affordance/style as way handles (same verb, same look).
      id: LYR_PHYSICAL_HANDLES,
      type: 'symbol',
      source: SRC_PHYSICAL_HANDLES,
      layout: {
        'icon-image': ['get', 'icon'],
        'icon-size': 0.28,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    },
  ];
}

export function gestureLayerSpecs(theme: MapTheme): LayerSpecification[] {
  return [
    {
      // During direct manipulation, the last settled projection remains stable
      // while this tiny source carries live geometry under the pointer. It is
      // intentionally simplified; release restores the exact derived rendering.
      id: LYR_GESTURE_FILL,
      type: 'fill',
      source: SRC_GESTURE,
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: {
        'fill-color': ['coalesce', ['get', 'color'], theme.gesturePreview],
        'fill-opacity': 0.72,
      },
    },
    {
      id: LYR_GESTURE_STROKE,
      type: 'line',
      source: SRC_GESTURE,
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: {
        'line-color': theme.gesturePreview,
        'line-width': 2,
        'line-dasharray': [2, 1.5],
      },
    },
    {
      id: LYR_GESTURE_LINE,
      type: 'line',
      source: SRC_GESTURE,
      filter: ['==', ['get', 'kind'], 'way'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': theme.gesturePreview,
        'line-width': 3.5,
        'line-opacity': 0.9,
      },
    },
    {
      id: LYR_GESTURE_POINT,
      type: 'circle',
      source: SRC_GESTURE,
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-radius': ['case', ['==', ['get', 'kind'], 'control'], 5, 7],
        'circle-color': theme.paper,
        'circle-stroke-width': 2.5,
        'circle-stroke-color': theme.gesturePreview,
      },
    },
    {
      // Shift-drag rubber-band select (see map/interactions.ts's
      // startMarqueeSelect) — last in paint order so it always draws above
      // everything else while the drag is live.
      id: LYR_MARQUEE_FILL,
      type: 'fill',
      source: SRC_MARQUEE,
      paint: { 'fill-color': theme.selection, 'fill-opacity': 0.08 },
    },
    {
      id: LYR_MARQUEE_STROKE,
      type: 'line',
      source: SRC_MARQUEE,
      paint: {
        'line-color': theme.selection,
        'line-width': 1.5,
        'line-dasharray': [2, 2],
      },
    },
  ];
}
