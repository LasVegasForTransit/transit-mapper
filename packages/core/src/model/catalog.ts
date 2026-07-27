// The single source of *kinds* in the app. Everything the model, tools, and
// inspector know about way types, service modes, grades, and facility
// classes lives here as DATA — not as union types baked into logic. This is
// pure domain data: what exists, what's compatible with what, what it's
// measured in. How it's drawn is a separate concern — see style/catalogStyle.ts.
//
// Adding a new way type (monorail guideway, gondola span, ferry route) or a new
// mode (funicular, trolleybus) is a catalog entry here, never a type or switch
// change elsewhere. Records in system.ts reference these by string id.

// ---- Facility classes ------------------------------------------------------
// A per-way-type refinement of the physical right-of-way: a road's arterial vs.
// local, a bike way's protected vs. painted.

export interface FacilityClass {
  id: string;
  label: string;
}

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

const FT = 0.3048;

export const LANE_KINDS: Record<string, LaneKindDef> = {
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
};

export function laneKind(id: string): LaneKindDef {
  // Own-property lookup, not `??` — see the accessor block near the bottom of
  // this file for why an inherited member reaching a caller is not theoretical.
  return Object.hasOwn(LANE_KINDS, id) ? LANE_KINDS[id] : LANE_KINDS.drive;
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
}

export const WAY_TYPES: Record<string, WayType> = {
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
    capacityLabel: 'lanes',
    defaultCapacity: 4,
    // A street we only know because a bus route traces it: assume the modest
    // two-lane case rather than the four a deliberately-drawn road starts with.
    importedCapacity: 2,
    defaultClassId: 'arterial',
    classes: [
      { id: 'transitway', label: 'Transitway' },
      { id: 'arterial', label: 'Arterial' },
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
};

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

// ---- Profile presets --------------------------------------------------------
// One-click cross-sections offered when drawing or editing a way — "pick a
// preset and drag" is the turnkey path; the lane editor refines from there.

export interface ProfilePreset {
  id: string;
  label: string;
  wayTypeId: string;
  /** Facility class a way gets when this preset is applied, if any. */
  classId?: string;
  lanes: ProfileTemplateLane[];
}

const SIDEWALK: ProfileTemplateLane = { kindId: 'sidewalk', direction: 'both' };
const DRIVE_F: ProfileTemplateLane = { kindId: 'drive', direction: 'forward' };
const DRIVE_B: ProfileTemplateLane = { kindId: 'drive', direction: 'backward' };

export const PROFILE_PRESETS: Record<string, ProfilePreset> = {
  roadLocal2: {
    id: 'roadLocal2',
    label: '2-lane local',
    wayTypeId: 'road',
    classId: 'local',
    lanes: [
      SIDEWALK,
      { kindId: 'parking', direction: 'none' },
      DRIVE_B,
      DRIVE_F,
      { kindId: 'parking', direction: 'none' },
      SIDEWALK,
    ],
  },
  roadCollector3: {
    id: 'roadCollector3',
    label: '3-lane w/ center turn',
    wayTypeId: 'road',
    classId: 'collector',
    lanes: [
      SIDEWALK,
      { kindId: 'bike', direction: 'backward' },
      DRIVE_B,
      { kindId: 'turnPocket', direction: 'both' },
      DRIVE_F,
      { kindId: 'bike', direction: 'forward' },
      SIDEWALK,
    ],
  },
  roadArterial4: {
    id: 'roadArterial4',
    label: '4-lane arterial',
    wayTypeId: 'road',
    classId: 'arterial',
    lanes: [SIDEWALK, DRIVE_B, DRIVE_B, DRIVE_F, DRIVE_F, SIDEWALK],
  },
  roadArterial5: {
    id: 'roadArterial5',
    label: '5-lane w/ center turn',
    wayTypeId: 'road',
    classId: 'arterial',
    lanes: [
      SIDEWALK,
      DRIVE_B,
      DRIVE_B,
      { kindId: 'turnPocket', direction: 'both' },
      DRIVE_F,
      DRIVE_F,
      SIDEWALK,
    ],
  },
  roadBoulevard: {
    id: 'roadBoulevard',
    label: 'Divided boulevard',
    wayTypeId: 'road',
    classId: 'arterial',
    lanes: [
      SIDEWALK,
      { kindId: 'bike', direction: 'backward' },
      DRIVE_B,
      DRIVE_B,
      { kindId: 'median', direction: 'none', widthM: 16 * FT },
      DRIVE_F,
      DRIVE_F,
      { kindId: 'bike', direction: 'forward' },
      SIDEWALK,
    ],
  },
  roadOneWay3: {
    id: 'roadOneWay3',
    label: '3-lane one-way',
    wayTypeId: 'road',
    classId: 'arterial',
    lanes: [
      SIDEWALK,
      { kindId: 'parking', direction: 'none' },
      DRIVE_F,
      DRIVE_F,
      DRIVE_F,
      SIDEWALK,
    ],
  },
  roadTransitway: {
    id: 'roadTransitway',
    label: 'Transitway',
    wayTypeId: 'road',
    classId: 'transitway',
    lanes: [
      SIDEWALK,
      { kindId: 'bus', direction: 'backward' },
      { kindId: 'bus', direction: 'forward' },
      SIDEWALK,
    ],
  },
  railSingle: {
    id: 'railSingle',
    label: 'Single track',
    wayTypeId: 'heavyRail',
    lanes: [{ kindId: 'track', direction: 'both' }],
  },
  railDouble: {
    id: 'railDouble',
    label: 'Double track',
    wayTypeId: 'heavyRail',
    lanes: [
      { kindId: 'track', direction: 'backward' },
      { kindId: 'track', direction: 'forward' },
    ],
  },
  railQuad: {
    id: 'railQuad',
    label: 'Quad track',
    wayTypeId: 'heavyRail',
    lanes: [
      { kindId: 'track', direction: 'backward' },
      { kindId: 'track', direction: 'backward' },
      { kindId: 'track', direction: 'forward' },
      { kindId: 'track', direction: 'forward' },
    ],
  },
};

export const PROFILE_PRESET_ORDER: string[] = [
  'roadLocal2',
  'roadCollector3',
  'roadArterial4',
  'roadArterial5',
  'roadBoulevard',
  'roadOneWay3',
  'roadTransitway',
  'railSingle',
  'railDouble',
  'railQuad',
];

/** Presets for a way type, in catalog order. */
export function profilePresetsForWayType(typeId: string): ProfilePreset[] {
  return PROFILE_PRESET_ORDER.map((id) => PROFILE_PRESETS[id]).filter(
    (p) => p.wayTypeId === typeId,
  );
}

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
   *  with any match wins. Falls back to any direction-matching lane when
   *  unset or none of the preferred kinds are present on this way. See
   *  geometry/vehicleLane.ts's selectVehicleLane. */
  preferredLaneKindIds?: string[];
  /** Approximate true-world size, in meters — rail-family modes share
   *  dimensions with their nearest real-world equivalent; exact figures
   *  aren't load-bearing (a per-system custom VehicleKind, when assigned,
   *  overrides this entirely). */
  defaultFootprintM: VehicleFootprint;
}

export const MODES: Record<string, Mode> = {
  // Heavy rail: subway and commuter rail are operationally different services
  // but ride the same track standard, so both are compatible with heavyRail.
  subway: {
    id: 'subway',
    label: 'Subway / metro',
    wayTypeIds: ['heavyRail'],
    defaultFootprintM: { widthM: 2.65, lengthM: 22 },
  },
  commuterRail: {
    id: 'commuterRail',
    label: 'Commuter rail',
    wayTypeIds: ['heavyRail'],
    defaultFootprintM: { widthM: 2.9, lengthM: 25 },
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
  },
  tram: {
    id: 'tram',
    label: 'Tram / streetcar',
    wayTypeIds: ['lightRail', 'road'],
    preferredLaneKindIds: ['track', 'drive'],
    defaultFootprintM: { widthM: 2.4, lengthM: 18 },
  },
  monorail: {
    id: 'monorail',
    label: 'Monorail',
    wayTypeIds: ['monorail'],
    defaultFootprintM: { widthM: 3, lengthM: 12 },
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
    defaultFootprintM: { widthM: 2, lengthM: 3 },
  },
  ferry: {
    id: 'ferry',
    label: 'Ferry',
    wayTypeIds: ['water'],
    defaultFootprintM: { widthM: 6, lengthM: 20 },
  },
};

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

// ---- Grade -----------------------------------------------------------------
// Vertical alignment of a way: below ground, at grade, or elevated.

export type Grade = 'underground' | 'atGrade' | 'elevated';

export interface GradeInfo {
  label: string;
}

export const GRADES: Record<Grade, GradeInfo> = {
  underground: { label: 'Underground' },
  atGrade: { label: 'At grade' },
  elevated: { label: 'Elevated' },
};

export const GRADE_ORDER: Grade[] = ['underground', 'atGrade', 'elevated'];

// ---- Facility types ---------------------------------------------------------
// Catalog-typed point/area features that aren't ways or stations in their own
// right: a bike dock, a station entrance, a depot/yard. `geometryKind` says
// whether a placed Facility is a single point or an area (polygon) — not to
// be confused with `FacilityClass` above, which refines a WAY's right-of-way
// (arterial vs. local), a different axis entirely.

export type FacilityGeometryKind = 'point' | 'area';

export interface FacilityType {
  id: string;
  label: string;
  geometryKind: FacilityGeometryKind;
  /**
   * Half-width, in meters, of the square an AREA facility is created as when
   * it's click-placed rather than drawn to shape. Null for point kinds, which
   * have no footprint to size.
   *
   * Required rather than optional so adding a facility type forces the
   * question to be answered here, in the catalog, instead of being answered
   * by whatever code happens to place one. Enforced by a check in verify.ts.
   */
  defaultHalfExtentM: number | null;
}

// The click-placed extents below all carry the single 15m half-extent every
// area facility was hardcoded to before these moved into the catalog, so
// placement is unchanged. They are per-type now so they CAN diverge — a
// platform and a depot have no business being the same size — but retuning
// them is a deliberate design pass, not a side effect of relocating them.
export const FACILITY_TYPES: Record<string, FacilityType> = {
  entrance: { id: 'entrance', label: 'Entrance', geometryKind: 'point', defaultHalfExtentM: null },
  bikeDock: { id: 'bikeDock', label: 'Bike dock', geometryKind: 'point', defaultHalfExtentM: null },
  elevator: { id: 'elevator', label: 'Elevator', geometryKind: 'point', defaultHalfExtentM: null },
  // A station building / terminal / headhouse — the general-purpose drawn
  // structure that sits on station land alongside platforms and bus bays.
  building: { id: 'building', label: 'Building', geometryKind: 'area', defaultHalfExtentM: 15 },
  parkingLot: { id: 'parkingLot', label: 'Parking', geometryKind: 'area', defaultHalfExtentM: 15 },
  depot: { id: 'depot', label: 'Depot / yard', geometryKind: 'area', defaultHalfExtentM: 15 },
  // A bus's curbside stopping bay and a boarding platform (rail/tram/BRT
  // alike) both have a real footprint — placed inside a facility boundary
  // the same way a station's platforms sit inside its own footprint.
  busBay: { id: 'busBay', label: 'Bus bay', geometryKind: 'area', defaultHalfExtentM: 15 },
  platform: { id: 'platform', label: 'Platform', geometryKind: 'area', defaultHalfExtentM: 15 },
};

export const FACILITY_TYPE_ORDER: string[] = [
  'entrance',
  'bikeDock',
  'elevator',
  'building',
  'busBay',
  'platform',
  'parkingLot',
  'depot',
];

export function facilityType(id: string): FacilityType {
  return Object.hasOwn(FACILITY_TYPES, id) ? FACILITY_TYPES[id] : FACILITY_TYPES.entrance;
}

// ---- Accessors -------------------------------------------------------------
//
// Tolerant of unknown ids, so bad data never crashes — but `X[id] ?? fallback`
// was not enough to deliver that. `??` only fires on null/undefined, and a
// plain object lookup finds inherited members: `WAY_TYPES["constructor"]` is
// the `Object` function, not undefined, so it was returned as though it were a
// way type. Callers then read `.defaultProfile` off it and threw inside
// `parseSystem`, or worse read `.defaultWidthM` off `Object.prototype.toString`
// and got `undefined`, which became a `NaN` width and a way that silently
// rendered as nothing.
//
// Ids reach here straight from `JSON.parse` of a shared document, so this is
// hostile input, not merely unknown input. `Object.hasOwn` is the check that
// makes "unknown id" mean what the fallbacks assume it means.
function fromCatalog<T>(table: Record<string, T>, id: string, fallback: T): T {
  return Object.hasOwn(table, id) ? table[id] : fallback;
}

export function wayType(id: string): WayType {
  return fromCatalog(WAY_TYPES, id, WAY_TYPES.lightRail);
}

export function mode(id: string): Mode {
  return fromCatalog(MODES, id, MODES.bus);
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

// Default colors offered when seeding a new system's line palette. Lives here
// (not in the web app's style module) because serialize.ts's createEmptySystem
// needs it — a domain module can't reach into presentation code.
export const LINE_COLORS: string[] = [
  '#e4572e',
  '#2e86e4',
  '#2ea44f',
  '#8b5cf6',
  '#f59e0b',
  '#db2777',
  '#0891b2',
  '#65a30d',
  '#dc2626',
  '#4f46e5',
];
