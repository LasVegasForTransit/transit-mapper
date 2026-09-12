import { fromCatalog } from './from-catalog';
// Part of the kind catalog. See ../catalog.ts for what this data is and why
// it is data rather than union types baked into logic.

// ---- Facility classes ------------------------------------------------------
// A per-way-type refinement of the physical right-of-way: a road's arterial vs.
// local, a bike way's protected vs. painted.

export interface FacilityClass {
  id: string;
  label: string;
  /** Whether crossing a way of this class is treated as needing grade
   *  separation by default when a physically-incompatible way (a guideway)
   *  is drawn across it — see crossing-edits.ts. Only meaningful for road
   *  classes; unset elsewhere. */
  major?: boolean;
}

// ---- Way types -------------------------------------------------------------
// The physical carrier. `family` groups types for the UI and view filters;
// `capacityLabel` names the unit a way of this type is measured in.

export type WayFamily = 'guideway' | 'roadway' | 'path' | 'aerial' | 'water';

// What a shared identity (NamedWay) across several ways of this family is
// called in the UI: two road carriageways form a "Street", two rail tracks a
// "Line", a walking/biking alignment a "Trail".
export interface WayFamilyInfo {
  identityNoun: string;
  /** What the family's DRAWING TOOL is called — the one-click "just draw a
   *  road / a track" buttons in the Infrastructure toolbar are generated
   *  from the families, one tool each. */
  toolLabel: string;
}

export const WAY_FAMILIES: Record<WayFamily, WayFamilyInfo> = {
  guideway: { identityNoun: 'Line', toolLabel: 'Track' },
  roadway: { identityNoun: 'Street', toolLabel: 'Road' },
  path: { identityNoun: 'Trail', toolLabel: 'Path' },
  aerial: { identityNoun: 'Line', toolLabel: 'Aerial' },
  water: { identityNoun: 'Route', toolLabel: 'Ferry' },
};

/** Way-type ids grouped by family, in WAY_TYPE_ORDER order — the source the
 *  toolbar's per-family drawing tools (and their variant flyouts) are
 *  generated from. */
export function wayTypesByFamily(): { family: WayFamily; typeIds: string[] }[] {
  const out: { family: WayFamily; typeIds: string[] }[] = [];
  for (const id of WAY_TYPE_ORDER) {
    const family = WAY_TYPES[id].family;
    let entry = out.find((e) => e.family === family);
    if (!entry) {
      entry = { family, typeIds: [] };
      out.push(entry);
    }
    entry.typeIds.push(id);
  }
  return out;
}

/** One lane in a catalog profile template — widths default from the lane
 *  kind; instances get ids when the template is built into a CrossSection
 *  (see model/profile.ts buildProfile). */
export interface ProfileTemplateLane {
  kindId: string;
  direction: 'forward' | 'backward' | 'both' | 'none';
  widthM?: number;
}

export interface WayType {
  id: string;
  label: string;
  family: WayFamily;
  /** Unit the way's derived capacity counts: "tracks", "lanes", "cabins/hr", … */
  capacityLabel: string;
  defaultCapacity: number;
  /** Facility classes for this type (may be empty). */
  classes: FacilityClass[];
  /** Default class id for a new way of this type, if the type has classes. */
  defaultClassId?: string;
  /** Lane kinds a way of this type may include in its cross-section. */
  laneKindIds: string[];
  /** The kind added/removed when capacity is stepped (drive, track, …). */
  primaryLaneKindId: string;
  /** Cross-section a new way of this type starts with. */
  defaultProfile: ProfileTemplateLane[];
  /**
   * Capacity to assume for a way SYNTHESIZED from an imported service trace,
   * where the real cross-section is unknown — as opposed to `defaultProfile`,
   * which is what someone gets when they deliberately draw one.
   *
   * Declared here because it is a judgement about the world ("a street we
   * only know carries a bus is probably two lanes, not the four a drawn road
   * starts with"), and the importer that needs it has no business making that
   * call itself. Left unset means "no reason to assume anything" — the type's
   * own defaultProfile stands.
   */
  importedCapacity?: number;
  /**
   * Which way types this one may share a JUNCTION with, named as a group.
   * Defaults to the type's own id — most types may only meet their own kind,
   * because a junction is a lane graph and, say, heavy rail and light rail
   * have neither a gauge nor a signalling system in common.
   *
   * Streets are the exception worth naming: a bike path meeting a road is a
   * real turn a real cyclist makes, and an OSM import records that junction
   * because someone surveyed it. Grouping them here is what keeps
   * model/junctions.ts from deleting it as impossible.
   *
   * This governs what may be KEPT, not what is formed. Drawing a way across
   * another still forms a junction only on an exact typeId match — see
   * formCrossingJunctions, which would rather form nothing than guess.
   */
  junctionGroupId?: string;
}

/** Roads, bike paths and footways all carry traffic that can turn from one
 *  into another at a junction, so they share a junction group. */
const STREET_JUNCTIONS = 'street';

const WAY_TYPES_BY_ID = {
  // Heavy rail and light rail are physically incompatible track standards —
  // different gauge/loading/signaling — so each is its own way type, never a
  // class of one "rail" type. Subway and commuter rail share heavy rail
  // trackage; light rail and trams/streetcars share light rail trackage;
  // monorail is a third, wholly separate guideway standard. Two of these can
  // run parallel alignments to save space, but can never be the same Way.
  heavyRail: {
    id: 'heavyRail',
    label: 'Heavy rail',
    family: 'guideway',
    capacityLabel: 'tracks',
    defaultCapacity: 2,
    classes: [],
    laneKindIds: ['track', 'platform'],
    primaryLaneKindId: 'track',
    defaultProfile: [
      { kindId: 'track', direction: 'backward' },
      { kindId: 'track', direction: 'forward' },
    ],
  },
  lightRail: {
    id: 'lightRail',
    label: 'Light rail / tram',
    family: 'guideway',
    capacityLabel: 'tracks',
    defaultCapacity: 1,
    classes: [],
    laneKindIds: ['track', 'platform'],
    primaryLaneKindId: 'track',
    defaultProfile: [{ kindId: 'track', direction: 'both', widthM: 3.5 }],
  },
  monorail: {
    id: 'monorail',
    label: 'Monorail',
    family: 'guideway',
    capacityLabel: 'beams',
    defaultCapacity: 1,
    classes: [],
    laneKindIds: ['track', 'platform'],
    primaryLaneKindId: 'track',
    defaultProfile: [{ kindId: 'track', direction: 'both', widthM: 2 }],
  },
  road: {
    id: 'road',
    label: 'Road',
    family: 'roadway',
    junctionGroupId: STREET_JUNCTIONS,
    capacityLabel: 'lanes',
    defaultCapacity: 4,
    // A street we only know because a bus route traces it: assume the modest
    // two-lane case rather than the four a deliberately-drawn road starts with.
    importedCapacity: 2,
    // Not 'arterial': combined with the auto-elevate branch in
    // formCrossingJunctions, defaulting a fresh sketch road to major would
    // force a viaduct the moment a rail line crossed it, before anyone had
    // told the tool anything about the road's real character. A road only
    // counts as major once someone (or a real OSM import) says so.
    defaultClassId: 'collector',
    classes: [
      { id: 'transitway', label: 'Transitway', major: true },
      { id: 'arterial', label: 'Arterial', major: true },
      { id: 'collector', label: 'Collector' },
      { id: 'local', label: 'Local' },
    ],
    laneKindIds: [
      'drive',
      'bus',
      'turnPocket',
      'bike',
      'parking',
      'shoulder',
      'median',
      'sidewalk',
      'track',
    ],
    primaryLaneKindId: 'drive',
    defaultProfile: [
      { kindId: 'sidewalk', direction: 'both' },
      { kindId: 'drive', direction: 'backward' },
      { kindId: 'drive', direction: 'backward' },
      { kindId: 'drive', direction: 'forward' },
      { kindId: 'drive', direction: 'forward' },
      { kindId: 'sidewalk', direction: 'both' },
    ],
  },
  bike: {
    id: 'bike',
    label: 'Bike',
    family: 'path',
    junctionGroupId: STREET_JUNCTIONS,
    capacityLabel: 'width',
    defaultCapacity: 1,
    defaultClassId: 'protected',
    classes: [
      { id: 'protected', label: 'Protected track' },
      { id: 'buffered', label: 'Buffered lane' },
      { id: 'painted', label: 'Painted lane' },
      { id: 'path', label: 'Off-street path' },
      { id: 'greenway', label: 'Neighborhood greenway' },
    ],
    laneKindIds: ['bike', 'sidewalk', 'median'],
    primaryLaneKindId: 'bike',
    defaultProfile: [{ kindId: 'bike', direction: 'both' }],
  },
  pedestrian: {
    id: 'pedestrian',
    label: 'Pedestrian',
    family: 'path',
    junctionGroupId: STREET_JUNCTIONS,
    capacityLabel: 'width',
    defaultCapacity: 1,
    defaultClassId: 'promenade',
    classes: [
      { id: 'promenade', label: 'Promenade / mall' },
      { id: 'pathway', label: 'Pathway' },
      { id: 'stairs', label: 'Stairs / passage' },
    ],
    laneKindIds: ['sidewalk', 'bike', 'median'],
    primaryLaneKindId: 'sidewalk',
    defaultProfile: [{ kindId: 'sidewalk', direction: 'both', widthM: 3 }],
  },
  aerial: {
    id: 'aerial',
    label: 'Aerial / gondola',
    family: 'aerial',
    capacityLabel: 'cabins/hr',
    defaultCapacity: 1,
    classes: [],
    laneKindIds: ['channel'],
    primaryLaneKindId: 'channel',
    defaultProfile: [{ kindId: 'channel', direction: 'both' }],
  },
  water: {
    id: 'water',
    label: 'Ferry route',
    family: 'water',
    capacityLabel: 'vessels',
    defaultCapacity: 1,
    classes: [],
    laneKindIds: ['channel'],
    primaryLaneKindId: 'channel',
    defaultProfile: [{ kindId: 'channel', direction: 'both' }],
  },
} satisfies Record<string, WayType>;

/** Every way type the catalog defines. See LaneKindId for why this exists. */
export type WayTypeId = keyof typeof WAY_TYPES_BY_ID;

export const WAY_TYPES: Record<string, WayType> = WAY_TYPES_BY_ID;

export const WAY_TYPE_ORDER: string[] = [
  'heavyRail',
  'lightRail',
  'monorail',
  'road',
  'bike',
  'pedestrian',
  'aerial',
  'water',
];

/**
 * What the drawing tools are armed with before the user has chosen anything.
 *
 * Declared here, in the catalog, because "which mode a blank document starts
 * on" is a product decision about the catalog's contents — not something the
 * editor store should settle by naming an id inline. It deliberately is NOT
 * derived from WAY_TYPE_ORDER[0] either: that order is a display ordering,
 * and quietly reusing it as the starting selection would couple two unrelated
 * decisions, so that reordering the toolbar silently changed what a new
 * document draws.
 */
export const INITIAL_DRAFT = {
  modeId: 'lightRail',
  wayTypeId: 'lightRail',
  geometry: 'curved',
  grade: 'atGrade',
} as const;

export function wayType(id: string): WayType {
  return fromCatalog(WAY_TYPES, id, WAY_TYPES.lightRail);
}

/** Facility class within a way type, or undefined if none/unknown. */
export function facilityClass(
  typeId: string,
  classId: string | undefined,
): FacilityClass | undefined {
  if (!classId) return undefined;
  return Object.hasOwn(WAY_TYPES, typeId)
    ? WAY_TYPES[typeId].classes.find((c) => c.id === classId)
    : undefined;
}

/** Whether a way's class is marked major — the trigger for auto-elevating a
 *  guideway that crosses it (see formCrossingJunctions). Derived entirely
 *  from `classId`, never a separate stored field. */
export function isMajorRoad(way: { typeId: string; classId?: string }): boolean {
  return facilityClass(way.typeId, way.classId)?.major === true;
}
