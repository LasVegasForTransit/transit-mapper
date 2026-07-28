// The handle glyph constants and the metric-to-pixel width helper moved to
// core (render/constants.ts) when buildFeatures did — the Worker stamps the
// same values onto features when it draws a system without a map. Re-exported
// here so every existing import of this module keeps working unchanged.
export { HANDLE_ICON, HANDLE_INK, widthPxAtZ14 } from '@transitmapper/core/render/constants';

export const SRC_WAYS = 'tm-ways';
export const SRC_SERVICES = 'tm-services';
export const SRC_STATIONS = 'tm-stations';
export const SRC_HANDLES = 'tm-handles';
export const SRC_PREVIEW = 'tm-preview';
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
export const SRC_JUNCTIONS = 'tm-junctions';
export const SRC_CONNECTORS = 'tm-connectors';
export const SRC_WAY_LABELS = 'tm-way-labels';
export const SRC_LANDMARKS = 'tm-landmarks';

export const LYR_WAYS_SOLID = 'tm-ways-solid';
export const LYR_WAYS_DASHED = 'tm-ways-dashed';
export const LYR_WAY_SELECTED = 'tm-way-selected';
export const LYR_SERVICES_ELEVATED = 'tm-services-elevated';
export const LYR_SERVICE_SELECTED = 'tm-service-selected';
export const LYR_SERVICES_SOLID = 'tm-services-solid';
export const LYR_SERVICES_UNDERGROUND = 'tm-services-underground';
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
export const LYR_PREVIEW = 'tm-preview';
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
export const LYR_LANE_ARROWS = 'tm-lane-arrows';
export const LYR_JUNCTIONS = 'tm-junctions';
export const LYR_JUNCTION_SELECTED = 'tm-junction-selected';
export const LYR_CONNECTORS = 'tm-connectors';
export const LYR_WAY_LABELS = 'tm-way-labels';
export const LYR_LANDMARKS = 'tm-landmarks';
export const LYR_LANDMARK_LABELS = 'tm-landmark-labels';

// Lane-level street rendering only exists at zooms where a lane is at least
// a few pixels wide; below this the Infrastructure view keeps its cheap
// offset-fan rendering, and the whole-valley view never derives lane
// geometry at all (the LOD gate that keeps big imports fast).
export const LANE_DETAIL_MIN_ZOOM = 15;

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
export const SELECT_HALO_WIDTH_EXPR = serviceWidthExpr(7);
export const SERVICE_ELEVATED_WIDTH_EXPR = serviceWidthExpr(3.5);
