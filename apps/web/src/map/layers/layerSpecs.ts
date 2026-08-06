import type { LayerSpecification } from 'maplibre-gl';
import {
  FOOTPRINT_FILL_OPACITY,
  PLATFORM_FILL_OPACITY,
  VEHICLE_FILL_OPACITY,
} from '@transitmapper/core/style/catalogStyle';
import { MAP_THEMES, type MapTheme } from '../mapThemePalette';
import {
  LANE_WIDTH_EXPR,
  SERVICE_CASING_WIDTH_EXPR,
  SERVICE_WIDTH_EXPR,
  SELECT_HALO_WIDTH_EXPR,
  SERVICE_ELEVATED_WIDTH_EXPR,
  LYR_CENTER_LINES,
  LYR_CONNECTORS,
  LYR_EDGE_LINES,
  LYR_ENDPOINT_HINT,
  LYR_FACILITIES,
  LYR_FACILITY_LABELS,
  LYR_FACILITY_SELECTED,
  LYR_FOOTPRINTS_FILL,
  LYR_FOOTPRINTS_STROKE,
  LYR_GESTURE_FILL,
  LYR_GESTURE_LINE,
  LYR_GESTURE_POINT,
  LYR_GESTURE_STROKE,
  LYR_HANDLES,
  LYR_JUNCTIONS,
  LYR_JUNCTION_SELECTED,
  LYR_LANDMARKS,
  LYR_LANDMARK_LABELS,
  LYR_LANE_ARROWS,
  LYR_SERVICE_ARROWS,
  LYR_LANE_LINES,
  LYR_LANE_SURFACES,
  LYR_LANE_TRACKS,
  LYR_MARQUEE_FILL,
  LYR_MARQUEE_STROKE,
  LYR_PHYSICAL_HANDLES,
  LYR_PLATFORMS_FILL,
  LYR_PLATFORMS_STROKE,
  LYR_PREVIEW,
  LYR_PREVIEW_ARROWS,
  LYR_SHARING,
  LYR_SERVICES_ELEVATED,
  LYR_SERVICES_HIT,
  LYR_SERVICES_SOLID,
  LYR_SERVICES_SOLID_CASING,
  LYR_SERVICES_UNDERGROUND,
  LYR_SERVICES_UNDERGROUND_CASING,
  LYR_SERVICE_SELECTED,
  LYR_STATIONS,
  LYR_STATION_LABELS,
  LYR_STATION_LABELS_MAJOR,
  LYR_STATION_SELECTED,
  LYR_VEHICLES,
  LYR_VEHICLES_INFRA_FILL,
  LYR_VEHICLES_INFRA_STROKE,
  LYR_WAYS_DASHED,
  LYR_WAYS_DASHED_CASING,
  LYR_WAYS_SOLID,
  LYR_WAYS_SOLID_CASING,
  LYR_WAY_ENDPOINTS,
  LYR_SERVICE_TERMINI,
  LYR_SERVICE_TERMINI_HIT,
  LYR_ACTION_ANCHOR,
  LYR_WAY_LABELS,
  LYR_WAY_SELECTED,
  SRC_CONNECTORS,
  SRC_ENDPOINT_HINT,
  SRC_FACILITIES,
  SRC_FOOTPRINTS,
  SRC_GESTURE,
  SRC_HANDLES,
  SRC_SERVICE_TERMINI,
  SRC_ACTION_ANCHOR,
  SRC_JUNCTIONS,
  SRC_LANDMARKS,
  SRC_LANES,
  SRC_LANE_ARROWS,
  SRC_SERVICE_ARROWS,
  SRC_LANE_MARKINGS,
  SRC_MARQUEE,
  SRC_PHYSICAL_HANDLES,
  SRC_PLATFORMS,
  SRC_PREVIEW,
  SRC_SHARING,
  SRC_SERVICES,
  SRC_STATIONS,
  SRC_VEHICLES,
  SRC_VEHICLES_INFRA,
  SRC_WAYS,
  SRC_WAY_LABELS,
} from './constants';

export function createLayerSpecs(theme: MapTheme): LayerSpecification[] {
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
      paint: { 'fill-color': theme.roadSurface, 'fill-opacity': 0.9 },
    },
    {
      id: LYR_JUNCTION_SELECTED,
      type: 'line',
      source: SRC_JUNCTIONS,
      filter: ['get', 'selected'],
      paint: { 'line-color': theme.selection, 'line-width': 2.5, 'line-opacity': 0.7 },
    },
    {
      // Lane surfaces: each lane's centerline drawn at its true metric width
      // (w14 × exponential zoom scaling), so a 5-lane arterial reads as real
      // asphalt at high zoom. Only populated at lane-detail zooms.
      id: LYR_LANE_SURFACES,
      type: 'line',
      source: SRC_LANES,
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': LANE_WIDTH_EXPR as never,
        'line-opacity': 0.9,
      },
    },
    {
      // Thin-line lanes (rail tracks embedded in or beside a street) — a track
      // is a pair of rails, not a slab, so it draws as a fixed thin line.
      id: LYR_LANE_TRACKS,
      type: 'line',
      source: SRC_LANE_MARKINGS,
      filter: ['==', ['get', 'kind'], 'thinLane'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': 2.5 },
    },
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
        'line-opacity': 0.9,
      },
    },
    {
      // Solid edge line where the directional roadway meets sidewalk/parking.
      id: LYR_EDGE_LINES,
      type: 'line',
      source: SRC_LANE_MARKINGS,
      filter: ['==', ['get', 'kind'], 'edgeLine'],
      paint: { 'line-color': theme.laneMarking, 'line-width': 1.2, 'line-opacity': 0.75 },
    },
    {
      // The center line where directions oppose — solid yellow.
      id: LYR_CENTER_LINES,
      type: 'line',
      source: SRC_LANE_MARKINGS,
      filter: ['==', ['get', 'kind'], 'centerLine'],
      paint: { 'line-color': theme.centerLine, 'line-width': 1.8, 'line-opacity': 0.95 },
    },
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
        'line-opacity': 0.55,
      },
    },
    {
      // Direction arrows along each one-way lane, pointing with travel (the
      // geometry engine pre-reverses backward lanes' paths).
      id: LYR_LANE_ARROWS,
      type: 'symbol',
      source: SRC_LANE_ARROWS,
      // Direction detail belongs to closer zooms — without this, one-way ways
      // (now including every GTFS-imported route) would strew ▶ chevrons across
      // the whole-network overview.
      minzoom: 13,
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
      paint: { 'text-color': theme.laneMarking, 'text-opacity': 0.9 },
    },
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
    {
      // A selected bare/infra way gets the same soft dark halo a selected
      // service does (LYR_SERVICE_SELECTED below) — without this, selecting a
      // way via the Objects list (kind:"way", not "service") drew nothing
      // different at all, since only service features ever carried a
      // `selected` flag before.
      id: LYR_WAY_SELECTED,
      type: 'line',
      source: SRC_WAYS,
      // Driven by feature-state (set on selection in MapCanvas), not a `selected`
      // property — so selecting a way flips one setFeatureState call instead of
      // re-uploading the whole (RTC-scale ~121k-waypoint) source. Invisible until
      // its way is selected.
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': [
          'case',
          ['boolean', ['feature-state', 'selected'], false],
          theme.selection,
          theme.hover,
        ],
        'line-width': SELECT_HALO_WIDTH_EXPR as never,
        'line-opacity': [
          'case',
          ['boolean', ['feature-state', 'selected'], false],
          0.18,
          ['boolean', ['feature-state', 'hover'], false],
          0.1,
          0,
        ],
        'line-offset': ['get', 'offset'],
      },
    },
    {
      // A way with capacity > 1 fans out into several offset lane/track
      // features (see emitCrossSection) — line-offset is what actually spaces
      // them apart on screen into a real physical cross-section.
      id: LYR_WAYS_SOLID_CASING,
      type: 'line',
      source: SRC_WAYS,
      filter: ['all', ['!', ['get', 'dashed']], ['!', ['to-boolean', ['get', 'haloOnly']]]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': theme.routeCasing,
        'line-width': ['+', ['get', 'width'], 2],
        'line-opacity': 0.62,
        'line-offset': ['get', 'offset'],
      },
    },
    {
      id: LYR_WAYS_SOLID,
      type: 'line',
      source: SRC_WAYS,
      // haloOnly features exist purely for LYR_WAY_SELECTED (a lane-rendered
      // way's selection glow) — they must never paint as a solid line.
      filter: ['all', ['!', ['get', 'dashed']], ['!', ['to-boolean', ['get', 'haloOnly']]]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['get', 'width'],
        'line-opacity': 0.85,
        'line-offset': ['get', 'offset'],
      },
    },
    {
      id: LYR_WAYS_DASHED_CASING,
      type: 'line',
      source: SRC_WAYS,
      filter: ['get', 'dashed'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': theme.routeCasing,
        'line-width': ['+', ['get', 'width'], 2],
        'line-dasharray': [2, 2],
        'line-opacity': 0.62,
        'line-offset': ['get', 'offset'],
      },
    },
    {
      id: LYR_WAYS_DASHED,
      type: 'line',
      source: SRC_WAYS,
      filter: ['get', 'dashed'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['get', 'width'],
        'line-dasharray': [2, 2],
        'line-opacity': 0.85,
        'line-offset': ['get', 'offset'],
      },
    },
    {
      // Elevated ways get a dark casing beneath — reads as a viaduct.
      id: LYR_SERVICES_ELEVATED,
      type: 'line',
      source: SRC_SERVICES,
      filter: ['all', ['!', ['get', 'hitTarget']], ['get', 'elevated']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': theme.routeCasing,
        'line-width': SERVICE_ELEVATED_WIDTH_EXPR as never,
        'line-opacity': 0.32,
        'line-offset': ['get', 'offset'],
      },
    },
    {
      id: LYR_SERVICE_SELECTED,
      type: 'line',
      source: SRC_SERVICES,
      filter: ['!', ['get', 'hitTarget']],
      // feature-state driven (see LYR_WAY_SELECTED). Selecting a way also lights
      // its rider services here — MapCanvas sets state on their serviceIds.
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': [
          'case',
          ['boolean', ['feature-state', 'selected'], false],
          theme.selection,
          theme.hover,
        ],
        'line-width': SELECT_HALO_WIDTH_EXPR as never,
        'line-opacity': [
          'case',
          ['boolean', ['feature-state', 'selected'], false],
          0.18,
          ['boolean', ['feature-state', 'hover'], false],
          0.1,
          0,
        ],
        'line-offset': ['get', 'offset'],
      },
    },
    {
      id: LYR_SERVICES_SOLID_CASING,
      type: 'line',
      source: SRC_SERVICES,
      filter: ['all', ['!', ['get', 'hitTarget']], ['!', ['get', 'underground']]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': theme.routeCasing,
        'line-width': SERVICE_CASING_WIDTH_EXPR as never,
        'line-opacity': 0.72,
        'line-offset': ['get', 'offset'],
      },
    },
    {
      id: LYR_SERVICES_SOLID,
      type: 'line',
      source: SRC_SERVICES,
      filter: ['all', ['!', ['get', 'hitTarget']], ['!', ['get', 'underground']]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': SERVICE_WIDTH_EXPR as never,
        'line-offset': ['get', 'offset'],
      },
    },
    {
      // Underground ways render dashed, like a tunnel.
      id: LYR_SERVICES_UNDERGROUND_CASING,
      type: 'line',
      source: SRC_SERVICES,
      filter: ['all', ['!', ['get', 'hitTarget']], ['get', 'underground']],
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: {
        'line-color': theme.routeCasing,
        'line-width': SERVICE_CASING_WIDTH_EXPR as never,
        'line-dasharray': [2.5, 2],
        'line-opacity': 0.72,
        'line-offset': ['get', 'offset'],
      },
    },
    {
      id: LYR_SERVICES_UNDERGROUND,
      type: 'line',
      source: SRC_SERVICES,
      filter: ['all', ['!', ['get', 'hitTarget']], ['get', 'underground']],
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': SERVICE_WIDTH_EXPR as never,
        'line-dasharray': [2.5, 2],
        'line-offset': ['get', 'offset'],
      },
    },
    {
      // Kept at zero opacity but queryable. It carries pattern/run/leg identity
      // where a service rides the same physical way more than once.
      id: LYR_SERVICES_HIT,
      type: 'line',
      source: SRC_SERVICES,
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
        // A stretch the route had to run against traffic is drawn in the warning
        // colour, heavier and at full opacity — the rest of the draft is a faint
        // dashed hint, and something wrong with it has to out-read that.
        'line-color': ['case', ['get', 'wrongWay'], theme.danger, theme.gesturePreview],
        'line-width': ['case', ['get', 'wrongWay'], 3.5, 2],
        'line-dasharray': [1.5, 1.5],
        'line-opacity': ['case', ['get', 'wrongWay'], 1, 0.5],
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

/** Deterministic light rendering for portable exports. */
export const LIGHT_LAYER_SPECS = createLayerSpecs(MAP_THEMES.light);

/** Compatibility alias for logic whose result is scheme-invariant (layer
 * identity, source discovery, gesture masking, and tests). */
export const LAYER_SPECS = LIGHT_LAYER_SPECS;
