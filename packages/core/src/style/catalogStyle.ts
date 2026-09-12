// How catalog entries (way types, facility classes, modes) are DRAWN. This is
// the only place visual properties (color, width, dashed) live — model/catalog.ts
// stays pure domain data. The map layer builder, the editor store (default draft
// colors), and UI swatches/pickers all read this. The model's type/domain
// modules (system.ts, catalog.ts, geo.ts) never do — LINE_COLORS lives in
// catalog.ts instead of here because serialize.ts's createEmptySystem needs a
// default palette and a domain module has no business importing a style one;
// re-exported here so existing style-module consumers don't need to know that.
//
// This lives in core (rather than the web app, where it started) so the Worker
// can draw a shared system for preview images and embeds with exactly the
// styling the editor uses. It stays a separate style/ module for the same
// reason it always was: rendering concerns never belong in model/.
import type { Grade } from '../model/catalog';
export { LINE_COLORS } from '../model/catalog';

/**
 * Paint tables are keyed by catalog IDs but declared here, because rendering
 * does not belong in `model/`. That separation costs a second list, and a
 * second list drifts: `WAY_TYPES.pedestrian` had no entry in
 * `WAY_TYPE_RENDER`, so every pedestrian path drew itself as a grey heavy-rail
 * track. `tests/style/catalog-paint.test.ts` fails when a catalog gains an entry
 * these tables do not cover, which is the only thing keeping the two lists
 * honest. A compile-time guarantee would be better and is possible — see the
 * note in that test — but it needs `model/catalog.ts` to stop erasing its own
 * key types, and that file is 243 lines over its limit and may not grow.
 *
 * The lookups below therefore only reach their fallback for an ID no catalog
 * knows — a document written by a newer build. Such a thing renders as
 * explicitly unknown rather than borrowing another entry's paint, because a
 * ferry silently drawn as a bus is worse than one drawn as a question mark.
 */
export interface RenderStyle {
  color: string;
  /** Base line width in px at the reference zoom. */
  width: number;
  /** Dashed line — a painted lane, a proposed route. */
  dashed?: boolean;
}

// ---- Way-type infrastructure render -----------------------------------------
export const WAY_TYPE_RENDER: Record<string, RenderStyle> = {
  heavyRail: { color: '#7b8188', width: 3 },
  lightRail: { color: '#9aa0a6', width: 2 },
  monorail: { color: '#a89bd6', width: 2 },
  road: { color: '#9ca3af', width: 4 },
  bike: { color: '#0f9d58', width: 3 },
  aerial: { color: '#a78bfa', width: 2, dashed: true },
  water: { color: '#38bdf8', width: 2, dashed: true },
  // A footway reads as a path, not a corridor: thin, dashed, and lighter than
  // the bike path it often runs beside.
  pedestrian: { color: '#b9b3a4', width: 1.5, dashed: true },
};

// Facility-class overrides, layered over the way type's base render. Partial
// on purpose: only road and bike subdivide into classes, so a lookup for any
// other way type finds nothing, and the type says so rather than making the
// caller's optional chain look redundant.
export const WAY_CLASS_RENDER: Record<string, Record<string, Partial<RenderStyle>> | undefined> = {
  road: {
    transitway: { color: '#6b7280', width: 5 },
    arterial: { color: '#9ca3af', width: 4 },
    collector: { color: '#b8bcc4', width: 3 },
    local: { color: '#cbd0d8', width: 2 },
  },
  bike: {
    protected: { color: '#0f9d58', width: 3 },
    buffered: { color: '#34a853', width: 2 },
    painted: { color: '#5bb974', width: 2, dashed: true },
    path: { color: '#137333', width: 3 },
    greenway: { color: '#66bb6a', width: 2, dashed: true },
  },
};

/**
 * Whether a way type's infrastructure line still shows underneath the colored
 * service line(s) riding it. Roads/bike paths are real surfaces a service sits
 * on (show it); a rail track *is* the colored service line, so a grey line
 * underneath would be redundant (don't show it).
 */
export const WAY_TYPE_SHOW_WHEN_SERVED: Record<string, boolean | undefined> = {
  road: true,
  bike: true,
};

/** Paint for an ID this build's catalog does not contain. Deliberately drab
 * and dashed: it should read as "this build does not know what this is". */
export const UNKNOWN_WAY_RENDER: RenderStyle = { color: '#9a9a92', width: 2, dashed: true };

export const UNKNOWN_LANE_RENDER: LaneRenderStyle = { color: '#9a9a92', surface: true };
export const UNKNOWN_MODE_RENDER: RenderStyle = { color: '#9a9a92', width: 3, dashed: true };
export const UNKNOWN_FACILITY_RENDER: FacilityRenderStyle = {
  color: '#9a9a92',
  radius: 9,
  icon: 'square',
};

/** Effective infrastructure render for a way: type base overridden by its class. */
export function wayRender(typeId: string, classId?: string): RenderStyle {
  const base = WAY_TYPE_RENDER[typeId] ?? UNKNOWN_WAY_RENDER;
  const override = classId ? WAY_CLASS_RENDER[typeId]?.[classId] : undefined;
  return override ? { ...base, ...override } : base;
}

export function showWayWhenServed(typeId: string): boolean {
  return !!WAY_TYPE_SHOW_WHEN_SERVED[typeId];
}

// ---- Lane-kind render (Infrastructure view, lane-detail zooms) --------------
// How one cross-section element paints when a way renders as real lanes.
// `surface: true` fills the lane's full physical width (asphalt, sidewalk,
// median); `surface: false` draws a fixed thin line at the lane's centerline
// (a rail track is a pair of rails, not a 4-meter slab).
export interface LaneRenderStyle {
  color: string;
  surface: boolean;
}

export const LANE_KIND_RENDER: Record<string, LaneRenderStyle> = {
  drive: { color: '#787c83', surface: true },
  bus: { color: '#a3543f', surface: true }, // red-painted transit lane
  turnPocket: { color: '#82868d', surface: true },
  bike: { color: '#3e9463', surface: true },
  sidewalk: { color: '#cfccc3', surface: true },
  parking: { color: '#8d9198', surface: true },
  shoulder: { color: '#989ca3', surface: true },
  median: { color: '#aab3a0', surface: true }, // landscaped strip
  track: { color: '#5b5c57', surface: false },
  platform: { color: '#b9b3a4', surface: true },
  channel: { color: '#9cc7e0', surface: false },
};

export function laneRender(kindId: string): LaneRenderStyle {
  return LANE_KIND_RENDER[kindId] ?? UNKNOWN_LANE_RENDER;
}

// Painted road markings — real-world semantics (white lane lines, yellow
// center line), not UI chrome, so they're exempt from the monochrome rule.
export const LANE_LINE_COLOR = '#f4f2ec';
export const CENTER_LINE_COLOR = '#d9a62e';
export const LANE_ARROW_COLOR = '#f4f2ec';

// ---- Mode (service) render --------------------------------------------------
export const MODE_RENDER: Record<string, RenderStyle> = {
  subway: { color: '#c0392b', width: 5 },
  commuterRail: { color: '#8e44ad', width: 4 },
  lightRail: { color: '#e4572e', width: 4 },
  tram: { color: '#16a085', width: 3 },
  monorail: { color: '#8b5cf6', width: 4 },
  brt: { color: '#2e86e4', width: 4 },
  bus: { color: '#2ea44f', width: 3 },
  gondola: { color: '#7c3aed', width: 4 },
  ferry: { color: '#0891b2', width: 4 },
};

export function modeRender(modeId: string): RenderStyle {
  return MODE_RENDER[modeId] ?? UNKNOWN_MODE_RENDER;
}

// ---- Vehicle paint (Infrastructure view) ------------------------------------
// A mode's real-world SIZE is domain data (model/catalog.ts's
// Mode.defaultFootprintM / vehicleFootprint) — this is only the paint: a
// vehicle's fill is its own route color (the `color` GeoJSON property,
// same value the Network-view dot already uses) — unlike a footprint or
// platform, a vehicle belongs to exactly one service, so it gets that
// service's color rather than the shared monochrome ink fill.
export const VEHICLE_STROKE = '#191a17';
export const VEHICLE_FILL_OPACITY = 0.92;

// ---- Grade ------------------------------------------------------------------
// Grade drives HOW a line renders (dashed tunnel, elevated casing) — the
// grade catalog itself (labels) stays in model/catalog.ts; this is just the
// boolean flags the layer specs filter on.
export function gradeFlags(grade: Grade): { underground: boolean; elevated: boolean } {
  return { underground: grade === 'underground', elevated: grade === 'elevated' };
}

// ---- Facility render ----------------------------------------------------------
export interface FacilityRenderStyle {
  color: string;
  /** Point marker radius, or area fill/stroke width — px at reference zoom. */
  radius: number;
  /** Icon-registry key (see map/icons.ts) — every facility type gets its own
   *  pictogram so the map never reduces them all to interchangeable dots. */
  icon: string;
}

export const FACILITY_RENDER: Record<string, FacilityRenderStyle> = {
  entrance: { color: '#191a17', radius: 9, icon: 'door' },
  bikeDock: { color: '#0f9d58', radius: 9, icon: 'bike' },
  elevator: { color: '#5b5c57', radius: 9, icon: 'elevator' },
  building: { color: '#6d6e68', radius: 9, icon: 'square' },
  parkingLot: { color: '#9a9a92', radius: 9, icon: 'parking' },
  depot: { color: '#7b8188', radius: 9, icon: 'depot' },
  busBay: { color: '#b5651d', radius: 9, icon: 'bus' },
  platform: { color: '#3b6ea5', radius: 9, icon: 'platform' },
};

export function facilityRender(typeId: string): FacilityRenderStyle {
  return FACILITY_RENDER[typeId] ?? UNKNOWN_FACILITY_RENDER;
}

// ---- Physical footprints / platforms -------------------------------------------
// Station footprint & platform fill/stroke — Infrastructure-only physical
// planning detail, deliberately understated so route lines stay legible.
export const FOOTPRINT_FILL = '#191a17';
export const FOOTPRINT_FILL_OPACITY = 0.05;
export const FOOTPRINT_STROKE = '#9a9a92';
export const PLATFORM_FILL = '#191a17';
export const PLATFORM_FILL_OPACITY = 0.14;
export const PLATFORM_STROKE = '#5b5c57';
