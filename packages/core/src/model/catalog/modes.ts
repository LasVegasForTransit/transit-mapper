import { fromCatalog } from './from-catalog';
// Part of the kind catalog. See ../catalog.ts for what this data is and why
// it is data rather than union types baked into logic.

// ---- Service modes ---------------------------------------------------------
// A colored service that people ride. `wayTypeIds` are the way types this mode
// can run over — so the mode picker for a way type shows only compatible modes,
// and a service can span any way of a compatible type.

/** A mode's approximate true-world footprint, in meters — the physical fact
 *  a vehicle is sized from, not a paint property (that's RenderStyle, in
 *  style/catalogStyle.ts). Drives the rotated-rectangle polygon Infrastructure
 *  view renders, and is the fallback a VehicleKind assignment overrides. */
export interface VehicleFootprint {
  widthM: number;
  lengthM: number;
}

export interface Mode {
  id: string;
  label: string;
  /** Way types this mode is compatible with. */
  wayTypeIds: string[];
  /** Lane kinds this mode prefers when a way offers more than one lane
   *  going its direction — e.g. a bus prefers a dedicated bus lane over a
   *  general drive lane when one exists. Checked in order; first kind
   *  with any match wins. Falls back to the curb lane in the travel
   *  direction when none of the preferred kinds are present on this way.
   *  Read by model/geo/serviceLane.ts's preferredLaneKinds, which is the
   *  single answer to "which lane does this service ride". */
  preferredLaneKindIds?: string[];
  /** Approximate true-world size, in meters — rail-family modes share
   *  dimensions with their nearest real-world equivalent; exact figures
   *  aren't load-bearing (a per-system custom VehicleKind, when assigned,
   *  overrides this entirely). */
  defaultFootprintM: VehicleFootprint;
  /**
   * How far a drawn line may sit from existing infrastructure and still count
   * as running along it, in meters. This is a physical fact about the mode,
   * not a UI preference: a train either is on the track or is not, so rail is
   * tight; a bus is somewhere in a carriageway that is itself ~20 m wide, so
   * anywhere in it means the same road.
   *
   * Too tight and drawing along a street mints a second street beside it. Too
   * loose and a line drawn deliberately beside an existing one gets swallowed
   * by it. Unset falls back to CONFLATION_TOLERANCE_M, which is the
   * road-width figure already tuned against real GTFS data.
   */
  corridorToleranceM?: number;
}

/** A track is a precise line: two rail alignments a few metres apart are two
 *  tracks, not one. Well below the road-width default, and still generous
 *  against the hand-drawing accuracy of a mouse at city zoom. */
const RAIL_CORRIDOR_TOLERANCE_M = 6;

const MODES_BY_ID = {
  // Heavy rail: subway and commuter rail are operationally different services
  // but ride the same track standard, so both are compatible with heavyRail.
  subway: {
    id: 'subway',
    label: 'Subway / metro',
    wayTypeIds: ['heavyRail'],
    preferredLaneKindIds: ['track'],
    defaultFootprintM: { widthM: 2.65, lengthM: 22 },
    corridorToleranceM: RAIL_CORRIDOR_TOLERANCE_M,
  },
  commuterRail: {
    id: 'commuterRail',
    label: 'Commuter rail',
    wayTypeIds: ['heavyRail'],
    preferredLaneKindIds: ['track'],
    defaultFootprintM: { widthM: 2.9, lengthM: 25 },
    corridorToleranceM: RAIL_CORRIDOR_TOLERANCE_M,
  },
  // Light rail & trams share the light-rail track standard — trams typically
  // run shorter, city-center alignments and more often street-run in a road's
  // right-of-way, which is why both also list "road" as compatible.
  lightRail: {
    id: 'lightRail',
    label: 'Light rail',
    wayTypeIds: ['lightRail', 'road'],
    preferredLaneKindIds: ['track', 'drive'],
    defaultFootprintM: { widthM: 2.65, lengthM: 27 },
    corridorToleranceM: RAIL_CORRIDOR_TOLERANCE_M,
  },
  tram: {
    id: 'tram',
    label: 'Tram / streetcar',
    wayTypeIds: ['lightRail', 'road'],
    preferredLaneKindIds: ['track', 'drive'],
    defaultFootprintM: { widthM: 2.4, lengthM: 18 },
    corridorToleranceM: RAIL_CORRIDOR_TOLERANCE_M,
  },
  monorail: {
    id: 'monorail',
    label: 'Monorail',
    wayTypeIds: ['monorail'],
    preferredLaneKindIds: ['track'],
    defaultFootprintM: { widthM: 3, lengthM: 12 },
    corridorToleranceM: RAIL_CORRIDOR_TOLERANCE_M,
  },
  brt: {
    id: 'brt',
    label: 'BRT',
    wayTypeIds: ['road'],
    preferredLaneKindIds: ['bus', 'drive'],
    defaultFootprintM: { widthM: 2.6, lengthM: 12 },
  },
  bus: {
    id: 'bus',
    label: 'Bus',
    wayTypeIds: ['road'],
    preferredLaneKindIds: ['bus', 'drive'],
    defaultFootprintM: { widthM: 2.6, lengthM: 12 },
  },
  gondola: {
    id: 'gondola',
    label: 'Gondola / aerial',
    wayTypeIds: ['aerial'],
    preferredLaneKindIds: ['channel'],
    defaultFootprintM: { widthM: 2, lengthM: 3 },
  },
  ferry: {
    id: 'ferry',
    label: 'Ferry',
    wayTypeIds: ['water'],
    preferredLaneKindIds: ['channel'],
    defaultFootprintM: { widthM: 6, lengthM: 20 },
  },
} satisfies Record<string, Mode>;

/** Every mode the catalog defines. See LaneKindId for why this exists. */
export type ModeId = keyof typeof MODES_BY_ID;

export const MODES: Record<string, Mode> = MODES_BY_ID;

/** A mode's approximate true-world footprint — falls back to the bus
 *  footprint for an unknown mode id, same convention as mode(). */
export function vehicleFootprint(modeId: string): VehicleFootprint {
  return mode(modeId).defaultFootprintM;
}

export const MODE_ORDER: string[] = [
  'subway',
  'lightRail',
  'tram',
  'monorail',
  'brt',
  'bus',
  'commuterRail',
  'gondola',
  'ferry',
];

/** Modes compatible with a way type, in catalog order. */
export function modesForWayType(typeId: string): Mode[] {
  return MODE_ORDER.map((id) => MODES[id]).filter((m) => m.wayTypeIds.includes(typeId));
}

export function mode(id: string): Mode {
  return fromCatalog(MODES, id, MODES.bus);
}
