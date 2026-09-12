import { fromCatalog } from './from-catalog';
// Part of the kind catalog. See ../catalog.ts for what this data is and why
// it is data rather than union types baked into logic.

// ---- Lane kinds ------------------------------------------------------------
// One element of a way's cross-section, left-to-right: a drive lane, a rail
// track, a median, a sidewalk. Like way types, lane kinds are catalog DATA —
// a way's profile references them by id, and adding a new kind (e.g. a
// transit-only queue-jump lane) is an entry here, never a union change.
// Widths are stored in meters; the UI presents feet.

/** What a lane element does in the cross-section: carries moving traffic
 *  (vehicles, trains, bikes, pedestrians), separates other lanes (median,
 *  buffer), or sits at the edge of the traveled way (parking, shoulder). */
export type LaneRole = 'travel' | 'separator' | 'edge';

export interface LaneKindDef {
  id: string;
  label: string;
  role: LaneRole;
  defaultWidthM: number;
  /** Common widths offered as one-click presets, in meters. */
  widthPresetsM: number[];
  /** Whether lanes of this kind count toward the way's headline capacity
   *  (a road's "lanes", a railway's "tracks"). Sidewalks and medians don't. */
  countsAsCapacity: boolean;
  /** Whether one-way/flip operations steer this kind's direction. Drive
   *  lanes and tracks are directional; a one-way street's sidewalks stay
   *  bidirectional for the people on them. */
  directional: boolean;
}

/** Feet to metres. Lane widths in the US are authored in feet. */
export const FT = 0.3048;

const LANE_KINDS_BY_ID = {
  drive: {
    id: 'drive',
    label: 'Drive lane',
    role: 'travel',
    defaultWidthM: 11 * FT,
    widthPresetsM: [10 * FT, 11 * FT, 12 * FT],
    countsAsCapacity: true,
    directional: true,
  },
  bus: {
    id: 'bus',
    label: 'Bus lane',
    role: 'travel',
    defaultWidthM: 12 * FT,
    widthPresetsM: [11 * FT, 12 * FT],
    countsAsCapacity: true,
    directional: true,
  },
  turnPocket: {
    id: 'turnPocket',
    label: 'Turn lane',
    role: 'travel',
    defaultWidthM: 10 * FT,
    widthPresetsM: [10 * FT, 11 * FT],
    countsAsCapacity: false,
    directional: true,
  },
  bike: {
    id: 'bike',
    label: 'Bike lane',
    role: 'travel',
    defaultWidthM: 6 * FT,
    widthPresetsM: [5 * FT, 6 * FT, 8 * FT],
    countsAsCapacity: true,
    directional: true,
  },
  sidewalk: {
    id: 'sidewalk',
    label: 'Sidewalk',
    role: 'travel',
    defaultWidthM: 6 * FT,
    widthPresetsM: [5 * FT, 6 * FT, 10 * FT],
    countsAsCapacity: false,
    directional: false,
  },
  parking: {
    id: 'parking',
    label: 'Parking',
    role: 'edge',
    defaultWidthM: 8 * FT,
    widthPresetsM: [7 * FT, 8 * FT, 10 * FT],
    countsAsCapacity: false,
    directional: false,
  },
  shoulder: {
    id: 'shoulder',
    label: 'Shoulder',
    role: 'edge',
    defaultWidthM: 6 * FT,
    widthPresetsM: [4 * FT, 6 * FT, 10 * FT],
    countsAsCapacity: false,
    directional: false,
  },
  median: {
    id: 'median',
    label: 'Median',
    role: 'separator',
    defaultWidthM: 4 * FT,
    widthPresetsM: [2 * FT, 4 * FT, 10 * FT, 16 * FT],
    countsAsCapacity: false,
    directional: false,
  },
  track: {
    id: 'track',
    label: 'Track',
    role: 'travel',
    defaultWidthM: 4,
    widthPresetsM: [3.5, 4, 4.5],
    countsAsCapacity: true,
    directional: true,
  },
  platform: {
    id: 'platform',
    label: 'Platform',
    role: 'separator',
    defaultWidthM: 6,
    widthPresetsM: [3, 6, 9],
    countsAsCapacity: false,
    directional: false,
  },
  // Aerial ropeway span / navigable water lane — one operating channel.
  channel: {
    id: 'channel',
    label: 'Channel',
    role: 'travel',
    defaultWidthM: 15,
    widthPresetsM: [10, 15, 30],
    countsAsCapacity: true,
    directional: true,
  },
} satisfies Record<string, LaneKindDef>;

/** Every lane kind the catalog defines. Tables that must cover the catalog —
 * paint, chiefly — key off this so a new kind without an entry fails to
 * compile. */
export type LaneKindId = keyof typeof LANE_KINDS_BY_ID;

/** The wide view. A stored document carries whatever ID it was written with,
 * so a lookup takes a plain string and may find nothing. */
export const LANE_KINDS: Record<string, LaneKindDef> = LANE_KINDS_BY_ID;

export function laneKind(id: string): LaneKindDef {
  return fromCatalog(LANE_KINDS, id, LANE_KINDS.drive);
}
