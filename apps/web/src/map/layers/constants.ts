// The handle glyph constants and the metric-to-pixel width helper moved to
// core (render/constants.ts) when buildFeatures did — the Worker stamps the
// same values onto features when it draws a system without a map. Re-exported
// here so every existing import of this module keeps working unchanged.
export { HANDLE_ICON, HANDLE_INK } from '@transitmapper/core/render/constants';

export const SRC_WAYS = 'tm-ways';
export const SRC_SERVICES = 'tm-services';
/** Invisible stable-ID interaction geometry, kept separate so visual service
 * batching never multiplies hit features or blocks paint-source diffs. */
export const SRC_HIT_FEATURES = 'tm-hit-features';
export const SRC_STATIONS = 'tm-stations';
export const SRC_HANDLES = 'tm-handles';
export const SRC_SERVICE_TERMINI = 'tm-service-termini';
export const SRC_ACTION_ANCHOR = 'tm-action-anchor';
export const SRC_PREVIEW = 'tm-preview';
/** Small, gesture-only geometry. Direct manipulation writes only this source
 *  until release instead of rebuilding and uploading every derived source. */
export const SRC_GESTURE = 'tm-gesture';
/** Stretches of existing infrastructure the in-progress stroke will be
 *  absorbed onto when it commits. See interactions.ts's setSharingPreview. */
export const SRC_SHARING = 'tm-sharing';
export const SRC_FOOTPRINTS = 'tm-footprints';
export const SRC_PLATFORMS = 'tm-platforms';
export const SRC_FACILITIES = 'tm-facilities';
export const SRC_PHYSICAL_HANDLES = 'tm-physical-handles';
export const SRC_VEHICLES = 'tm-vehicles';
export const SRC_VEHICLES_INFRA = 'tm-vehicles-infra';
export const SRC_MARQUEE = 'tm-marquee';
export const SRC_ENDPOINT_HINT = 'tm-endpoint-hint';
export const SRC_LANES = 'tm-lanes';
export const SRC_LANE_MARKINGS = 'tm-lane-markings';
export const SRC_LANE_ARROWS = 'tm-lane-arrows';
/** Direction arrows on a SERVICE line, where only one of its two directions
 *  rides that stretch. Distinct from lane arrows: those describe the street
 *  and sit on the asphalt under everything; these describe a line and have to
 *  sit on top of it, in its own colour. */
export const SRC_SERVICE_ARROWS = 'tm-service-arrows';
export const SRC_JUNCTIONS = 'tm-junctions';
export const SRC_CONNECTORS = 'tm-connectors';
/** Selection-owned junction movement guides. This transient source must stay
 * separate from renderer-owned connector geometry so editor clicks never
 * mutate or desynchronise the retained RenderScene. */
export const SRC_JUNCTION_GUIDES = 'tm-junction-guides';
export const SRC_WAY_LABELS = 'tm-way-labels';
export const SRC_LANDMARKS = 'tm-landmarks';

export const LYR_WAYS_SOLID = 'tm-ways-solid';
export const LYR_WAYS_DASHED = 'tm-ways-dashed';
export const LYR_WAYS_SOLID_CASING = 'tm-ways-solid-casing';
export const LYR_WAYS_DASHED_CASING = 'tm-ways-dashed-casing';
export const LYR_WAY_SELECTED = 'tm-way-selected';
export const LYR_SERVICES_ELEVATED = 'tm-services-elevated';
export const LYR_SERVICE_SELECTED = 'tm-service-selected';
export const LYR_SERVICES_SOLID = 'tm-services-solid';
export const LYR_SERVICES_UNDERGROUND = 'tm-services-underground';
export const LYR_SERVICES_SOLID_CASING = 'tm-services-solid-casing';
export const LYR_SERVICES_UNDERGROUND_CASING = 'tm-services-underground-casing';
/** Invisible per-occurrence geometry used only for exact service actions. */
export const LYR_SERVICES_HIT = 'tm-services-hit';
export const LYR_STATIONS = 'tm-stations';
export const LYR_STATION_SELECTED = 'tm-station-selected';
export const LYR_VEHICLES = 'tm-vehicles';
export const LYR_VEHICLES_INFRA_FILL = 'tm-vehicles-infra-fill';
export const LYR_VEHICLES_INFRA_STROKE = 'tm-vehicles-infra-stroke';
export const LYR_STATION_LABELS = 'tm-station-labels'; // ordinary stops (higher minzoom)
export const LYR_STATION_LABELS_MAJOR = 'tm-station-labels-major'; // interchanges + major stops (lower minzoom)
export const LYR_FACILITY_LABELS = 'tm-facility-labels';
export const LYR_HANDLES = 'tm-handles';
export const LYR_WAY_ENDPOINTS = 'tm-way-endpoints';
export const LYR_SERVICE_TERMINI = 'tm-service-termini';
export const LYR_SERVICE_TERMINI_HIT = 'tm-service-termini-hit';
export const LYR_ACTION_ANCHOR = 'tm-action-anchor';
export const LYR_PREVIEW = 'tm-preview';
export const LYR_PREVIEW_ARROWS = 'tm-preview-arrows';
export const LYR_GESTURE_FILL = 'tm-gesture-fill';
export const LYR_GESTURE_STROKE = 'tm-gesture-stroke';
export const LYR_GESTURE_LINE = 'tm-gesture-line';
export const LYR_GESTURE_POINT = 'tm-gesture-point';
export const LYR_SHARING = 'tm-sharing';
export const LYR_FOOTPRINTS_FILL = 'tm-footprints-fill';
export const LYR_FOOTPRINTS_STROKE = 'tm-footprints-stroke';
export const LYR_PLATFORMS_FILL = 'tm-platforms-fill';
export const LYR_PLATFORMS_STROKE = 'tm-platforms-stroke';
export const LYR_FACILITIES = 'tm-facilities';
export const LYR_FACILITY_SELECTED = 'tm-facility-selected';
export const LYR_PHYSICAL_HANDLES = 'tm-physical-handles';
export const LYR_ENDPOINT_HINT = 'tm-endpoint-hint';
export const LYR_MARQUEE_FILL = 'tm-marquee-fill';
export const LYR_MARQUEE_STROKE = 'tm-marquee-stroke';
export const LYR_LANE_SURFACES = 'tm-lane-surfaces';
export const LYR_LANE_LINES = 'tm-lane-lines';
export const LYR_CENTER_LINES = 'tm-center-lines';
export const LYR_EDGE_LINES = 'tm-edge-lines';
export const LYR_LANE_TRACKS = 'tm-lane-tracks';
export const LYR_RAIL_TIES = 'tm-rail-ties';
export const LYR_LANE_ARROWS = 'tm-lane-arrows';
export const LYR_SERVICE_ARROWS = 'tm-service-arrows';
export const LYR_JUNCTIONS = 'tm-junctions';
export const LYR_JUNCTION_SELECTED = 'tm-junction-selected';
export const LYR_CONNECTORS = 'tm-connectors';
export const LYR_JUNCTION_GUIDES = 'tm-junction-guides';
export const LYR_WAY_LABELS = 'tm-way-labels';
export const LYR_LANDMARKS = 'tm-landmarks';
export const LYR_LANDMARK_LABELS = 'tm-landmark-labels';

/** Stable low-to-high detail ordering inside one MapLibre line layer.
 * `updateData` may append a newly entered tier after existing features, so
 * collection order alone cannot guarantee correct source-over composition. */
export const RENDER_TIER_SORT_KEY_EXPR = [
  'match',
  ['get', 'renderTier'],
  'overview',
  1,
  'district',
  2,
  'street',
  3,
  0,
];

// Lane widths are stored in meters and carried on each feature as a z14 pixel
// width (see widthPxAtZ14, re-exported above); this expression scales that
// exponentially (base 2 — exact for mercator) with zoom.
export const LANE_WIDTH_EXPR = [
  'interpolate',
  ['exponential', 2],
  ['zoom'],
  14,
  ['get', 'w14'],
  22,
  ['*', 256, ['get', 'w14']],
];

const MIN_LOD_ZOOM = 8;
const MAX_LOD_ZOOM = 24;
const LOD_ZOOM_STEP = 0.25;
const LEGACY_TIER_OPACITY_EXPR = ['coalesce', ['get', 'tierOpacity'], 1];

/** MapLibre permits `zoom` only as a top-level interpolate input. A composite
 * expression therefore samples the exact projected-width function every
 * quarter zoom and exponentially interpolates between samples. The result is
 * continuous during camera movement, follows the same 2-4 px and 9-12 px
 * bands as core, and avoids rebuilding sources on every animation frame. */
function upperTierOpacity(baseOpacity: unknown, upperWeight: unknown[]): unknown[] {
  return ['*', baseOpacity, upperWeight];
}

/** Allocate a translucent cross-fade to the lower, already-painted tier.
 *
 * MapLibre composites separate GeoJSON features with source-over blending. If
 * both tiers simply use `baseOpacity * weight`, their combined alpha falls in
 * the middle of the transition and produces a visible dark/bright pulse. The
 * upper tier contributes `baseOpacity * weight`; this expression solves the
 * corresponding lower alpha so their combined opacity remains exactly
 * `baseOpacity` while the upper tier fades in. */
function lowerTierOpacity(baseOpacity: unknown, upperWeight: unknown[]): unknown[] {
  return [
    'case',
    ['<=', upperWeight, 0],
    baseOpacity,
    ['>=', upperWeight, 1],
    0,
    ['/', ['*', baseOpacity, ['-', 1, upperWeight]], ['-', 1, ['*', baseOpacity, upperWeight]]],
  ];
}

function tierOpacityAtZoom(zoom: number, baseOpacity: unknown): unknown[] {
  const corridorWidthAtZ14 = ['coalesce', ['get', 'corridorDisplayW14'], ['get', 'corridorW14']];
  const projectedWidth = ['*', corridorWidthAtZ14, 2 ** (zoom - 14)];
  const districtWeight = ['interpolate', ['linear'], projectedWidth, 2, 0, 4, 1];
  const streetWeight = ['interpolate', ['linear'], projectedWidth, 9, 0, 12, 1];
  const hasAvailabilityContract = [
    'all',
    ['has', 'projectedWidthPx'],
    ['has', 'hasOverviewTier'],
    ['has', 'hasDistrictTier'],
    ['has', 'hasStreetTier'],
  ];
  const hasOverview = ['boolean', ['get', 'hasOverviewTier'], false];
  const hasDistrict = ['boolean', ['get', 'hasDistrictTier'], false];
  const hasStreet = ['boolean', ['get', 'hasStreetTier'], false];
  const availableTierOpacity = [
    'match',
    ['get', 'renderTier'],
    // A retained Overview silhouette must bridge an in-flight camera move
    // until District geometry has been projected and patched into the source.
    'overview',
    [
      'case',
      ['all', hasAvailabilityContract, ['!', hasDistrict]],
      baseOpacity,
      lowerTierOpacity(baseOpacity, districtWeight),
    ],
    'district',
    [
      'case',
      ['all', hasAvailabilityContract, ['!', hasOverview], ['<', projectedWidth, 4]],
      baseOpacity,
      ['all', hasAvailabilityContract, ['!', hasStreet], ['>', projectedWidth, 9]],
      baseOpacity,
      ['<', projectedWidth, 4],
      upperTierOpacity(baseOpacity, districtWeight),
      ['>', projectedWidth, 9],
      lowerTierOpacity(baseOpacity, streetWeight),
      baseOpacity,
    ],
    // The same bridge works in reverse when the user zooms out faster than a
    // District patch can arrive.
    'street',
    [
      'case',
      ['all', hasAvailabilityContract, ['!', hasDistrict]],
      baseOpacity,
      upperTierOpacity(baseOpacity, streetWeight),
    ],
    ['*', baseOpacity, LEGACY_TIER_OPACITY_EXPR],
  ];
  return [
    'case',
    ['all', ['has', 'corridorW14'], ['has', 'renderTier']],
    availableTierOpacity,
    ['*', baseOpacity, LEGACY_TIER_OPACITY_EXPR],
  ];
}

function buildTierOpacityExpr(baseOpacity: unknown): unknown[] {
  const expression: unknown[] = ['interpolate', ['exponential', 2], ['zoom']];
  const stopCount = Math.round((MAX_LOD_ZOOM - MIN_LOD_ZOOM) / LOD_ZOOM_STEP);
  for (let index = 0; index <= stopCount; index += 1) {
    const zoom = MIN_LOD_ZOOM + index * LOD_ZOOM_STEP;
    expression.push(zoom, tierOpacityAtZoom(zoom, baseOpacity));
  }
  return expression;
}

const TIER_OPACITY_EXPRESSIONS = new Map<number, unknown[]>();

export function tierOpacityExpr(baseOpacity: unknown): unknown[] {
  if (typeof baseOpacity !== 'number') return buildTierOpacityExpr(baseOpacity);
  const cached = TIER_OPACITY_EXPRESSIONS.get(baseOpacity);
  if (cached) return cached;
  const expression = buildTierOpacityExpr(baseOpacity);
  TIER_OPACITY_EXPRESSIONS.set(baseOpacity, expression);
  return expression;
}

export const TIER_OPACITY_EXPR = tierOpacityExpr(1);

const SERVICE_FOCUS_DIM_OPACITY = 0.12;

/** Keeps service focus a paint-only change without discarding screen-space
 * tier fades. Returning the cached base expression on blur also restores the
 * exact layer-spec value rather than a constant opacity. */
export function serviceFocusOpacityExpr(baseOpacity: number, focused: boolean): unknown[] {
  return tierOpacityExpr(
    focused
      ? [
          'case',
          ['boolean', ['feature-state', 'selected'], false],
          baseOpacity,
          SERVICE_FOCUS_DIM_OPACITY,
        ]
      : baseOpacity,
  );
}

const DISTRICT_TIER_EXPR = ['==', ['get', 'renderTier'], 'district'];

// Overview stays a hierarchy-weighted silhouette (`width`) however far the
// camera moves. District alone expands to the corridor's true aggregate
// metric width (`corridorW14`), continuously under fractional zoom.
export const CORRIDOR_WIDTH_EXPR = [
  'interpolate',
  ['exponential', 2],
  ['zoom'],
  14,
  ['case', DISTRICT_TIER_EXPR, ['get', 'corridorW14'], ['get', 'width']],
  22,
  ['case', DISTRICT_TIER_EXPR, ['*', 256, ['get', 'corridorW14']], ['get', 'width']],
];

export const CORRIDOR_CASING_WIDTH_EXPR = [
  'interpolate',
  ['exponential', 2],
  ['zoom'],
  14,
  ['case', DISTRICT_TIER_EXPR, ['+', ['get', 'corridorW14'], 2], ['+', ['get', 'width'], 2]],
  22,
  [
    'case',
    DISTRICT_TIER_EXPR,
    ['+', ['*', 256, ['get', 'corridorW14']], 2],
    ['+', ['get', 'width'], 2],
  ],
];

// Service line width. A service drawn on its lane (Infrastructure lane detail —
// its feature carries `w14`) grows with zoom between a sensible min/max so it
// reads as the route occupying the lane, never a thread or a blob; a schematic
// service (no `w14`, Network view) keeps its fixed `width` at every zoom.
// MapLibre forbids ["zoom"] nested inside min/max/case, so the clamp is
// expressed as FLAT interpolate stops and the has-w14 branch lives in each
// stop's zoom-free OUTPUT. `margin` (halo/casing) is added inside each stop for
// the same reason. Below z15 → the z15 stop; above z21 → the z21 stop.
const serviceWidthExpr = (margin: number) => {
  const stop = (px: number) =>
    margin > 0
      ? ['+', ['case', ['has', 'w14'], px, ['get', 'width']], margin]
      : ['case', ['has', 'w14'], px, ['get', 'width']];
  return ['interpolate', ['linear'], ['zoom'], 15, stop(2.5), 18, stop(7), 21, stop(15)];
};
export const SERVICE_WIDTH_EXPR = serviceWidthExpr(0);
export const SERVICE_CASING_WIDTH_EXPR = serviceWidthExpr(2.5);
export const SELECT_HALO_WIDTH_EXPR = serviceWidthExpr(7);
export const SERVICE_ELEVATED_WIDTH_EXPR = serviceWidthExpr(3.5);

function corridorSelectionHaloWidthAtScale(scale: number): unknown[] {
  const physicalWidth = scale === 1 ? ['get', 'corridorW14'] : ['*', scale, ['get', 'corridorW14']];
  return [
    '+',
    [
      'case',
      ['==', ['get', 'renderTier'], 'overview'],
      ['get', 'width'],
      ['has', 'corridorW14'],
      physicalWidth,
      ['get', 'width'],
    ],
    7,
  ];
}

/** Selection width for corridor features. Unlike service halos, Street
 * corridor stand-ins represent the complete cross-section and therefore use
 * the aggregate physical width instead of a fixed zoom bucket. */
export const CORRIDOR_SELECT_HALO_WIDTH_EXPR = [
  'interpolate',
  ['exponential', 2],
  ['zoom'],
  14,
  corridorSelectionHaloWidthAtScale(1),
  22,
  corridorSelectionHaloWidthAtScale(256),
];
