// P4 — import real infrastructure. The generalized model already accommodates
// this: a Way is a Way whether hand-drawn or pulled from OpenStreetMap, so
// importing is just another Way *producer* — a `source` marker is the only
// difference. This module is deliberately network-free: query construction,
// response conversion and seam reconciliation run in both browser workers
// and workerd, while the Cloudflare gateway owns all upstream I/O.
import { wayType, type Grade, type ProfileTemplateLane } from './catalog';
import { haversineMeters, nearestOnPath } from './geo';
import { junctionGroupOf, wayTypeIndex, withSingleTypeArms } from './junctions';
import { shortId } from './ids';
import {
  defaultProfileFor,
  profileWidthM,
  profileWithPrimaryLanes,
  MAX_PRIMARY_LANES,
  type ProfileEdges,
} from './profile';
import type {
  CrossSection,
  DrivingSide,
  LaneDirection,
  LngLat,
  Median,
  NamedWay,
  Node,
  NodeControl,
  TurnRestriction,
  Way,
  WayPointRef,
} from './system';

export interface ImportBBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

// Which OSM tagging categories are importable — data-driven, so adding one is
// a catalog entry here, not new branching logic elsewhere.
export type ImportCategory = 'road' | 'heavyRail' | 'lightRail' | 'bike';

export const IMPORT_CATEGORY_ORDER: ImportCategory[] = ['road', 'heavyRail', 'lightRail', 'bike'];

export const IMPORT_CATEGORY_LABELS: Record<ImportCategory, string> = {
  road: 'Streets',
  heavyRail: 'Heavy rail',
  lightRail: 'Light rail / tram',
  bike: 'Bike infrastructure',
};

// The Overpass QL clause selecting each category's OSM ways. `(bbox)` is
// substituted with the actual bounding box in buildOverpassQuery.
const CATEGORY_QUERY: Record<ImportCategory, string> = {
  road: `way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street)$"](bbox);`,
  heavyRail: `way["railway"~"^(rail|subway)$"](bbox);`,
  lightRail: `way["railway"~"^(light_rail|tram)$"](bbox);`,
  bike: `way["highway"="cycleway"](bbox);`,
};

// Junction control lives on OSM *nodes*, so it needs its own clause — the
// way clauses above return node ids but never node tags. Fetched only with
// roads, the one category whose junctions this app controls.
const CONTROL_NODE_QUERY = `node["highway"~"^(traffic_signals|stop)$"](bbox);`;

// Turn bans are relations, not tags on either way, so they need their own
// clause. `>>` pulls in each relation's member ways, which may reach outside
// the box — without them a ban names ways the import never saw.
const RESTRICTION_QUERY = `relation["type"="restriction"](bbox);`;

/** Build an Overpass QL query for the given categories within a bounding box. */
export function buildOverpassQuery(bbox: ImportBBox, categories: ImportCategory[]): string {
  const bboxStr = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  const wantsRoads = categories.includes('road');
  const parts = [
    ...categories.map((c) => CATEGORY_QUERY[c]),
    ...(wantsRoads ? [CONTROL_NODE_QUERY, RESTRICTION_QUERY] : []),
  ];
  const clauses = parts.map((q) => q.replace(/\(bbox\)/g, `(${bboxStr})`)).join('\n  ');
  return `[out:json][timeout:25];\n(\n  ${clauses}\n);\nout geom;`;
}

// v3's own road classes stand in for OSM's `highway` hierarchy — a rough but
// reasonable default; the user can always change a way's class after import.
const ROAD_CLASS_BY_HIGHWAY: Record<string, string> = {
  motorway: 'transitway',
  trunk: 'arterial',
  primary: 'arterial',
  secondary: 'arterial',
  tertiary: 'collector',
  residential: 'local',
  unclassified: 'local',
  living_street: 'local',
};

// How many travel lanes a road of each class has when OSM doesn't say. The
// catalog's road type has one defaultProfile for every class, so without this
// a residential street imports as wide as an arterial — the single biggest
// source of implausible-looking imports. These are two-way totals; a one-way
// way is treated as one carriageway of such a street (see osmLaneCounts).
const ROAD_LANES_BY_CLASS: Record<string, number> = {
  transitway: 4,
  arterial: 4,
  collector: 2,
  local: 2,
};

// OSM turn:lanes values that mean "you cannot continue straight from this
// lane" — the ones that map onto the catalog's turnPocket kind. Combination
// values containing `through` (e.g. "through;right") stay ordinary travel
// lanes: they still carry through traffic, which is what turnPocket denies.
// merge_to_* is deliberately absent — a merging lane is a travel lane.
const TURN_ONLY_VALUES = new Set([
  'left',
  'right',
  'slight_left',
  'slight_right',
  'sharp_left',
  'sharp_right',
  'reverse',
]);

/** A single `turn:lanes` entry (values within one lane are `;`-separated). */
function isTurnOnlyLane(entry: string): boolean {
  const values = entry
    .split(';')
    .map((v) => v.trim())
    .filter(Boolean);
  // An empty entry ("left||right") means "unspecified", not "turn only".
  if (values.length === 0) return false;
  return values.every((v) => TURN_ONLY_VALUES.has(v));
}

/** Parse an OSM lane-count tag. Anything non-numeric, negative, or absurd is
 *  treated as absent — these values are user-entered free text. */
function osmLaneCount(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.min(MAX_PRIMARY_LANES, Math.round(n));
}

/** Which way traffic runs relative to the way's point order, or null for a
 *  two-way street. `-1`/`reverse` mean the way is drawn against its traffic. */
function osmOneway(tags: Record<string, string>): 'forward' | 'backward' | null {
  const v = tags.oneway;
  if (v === 'yes' || v === 'true' || v === '1') return 'forward';
  if (v === '-1' || v === 'reverse') return 'backward';
  return null;
}

interface OsmLaneCounts {
  backward: number;
  forward: number;
  /** A shared centre turn lane (`lanes:both_ways`), between the directions. */
  centerTurn: boolean;
}

/**
 * Hold a split to MAX_PRIMARY_LANES *in total*.
 *
 * osmLaneCount clamps each tag on its own, which is not the same guarantee:
 * `lanes:forward=999` plus `lanes:backward=999` clamps to 32 apiece and then
 * allocates 64 lanes, defeating the ceiling that exists precisely because
 * these numbers come from untrusted free text and become the allocation size
 * (see MAX_PRIMARY_LANES in profile.ts). Scaled proportionally rather than
 * truncated on one side, so an over-large split stays the shape OSM
 * described; a direction that had any lanes keeps at least one.
 */
function clampLaneSplit({ backward, forward, centerTurn }: OsmLaneCounts): OsmLaneCounts {
  const centre = centerTurn ? 1 : 0;
  if (backward + forward + centre <= MAX_PRIMARY_LANES) return { backward, forward, centerTurn };
  const budget = MAX_PRIMARY_LANES - centre;
  const scale = budget / (backward + forward);
  const scaled = (n: number): number => (n > 0 ? Math.max(1, Math.round(n * scale)) : 0);
  const b = Math.min(scaled(backward), budget);
  return { backward: b, forward: Math.min(scaled(forward), budget - b), centerTurn };
}

/**
 * How many travel lanes run each way, from OSM's lane tags.
 *
 * `lanes` counts every marked through-traffic lane including a shared centre
 * turn lane, so the centre lane is subtracted before splitting. When only a
 * total is known the split follows defaultProfileFor's convention (the extra
 * lane of an odd count runs forward). When OSM says nothing, the way's class
 * supplies a total — halved for a one-way way, which is normally one
 * carriageway of a street that wide.
 */
function osmLaneCounts(tags: Record<string, string>, classId: string | undefined): OsmLaneCounts {
  return clampLaneSplit(rawOsmLaneCounts(tags, classId));
}

function rawOsmLaneCounts(
  tags: Record<string, string>,
  classId: string | undefined,
): OsmLaneCounts {
  const oneway = osmOneway(tags);
  const centerTurn = (osmLaneCount(tags['lanes:both_ways']) ?? 0) > 0 && oneway === null;
  const forwardTag = osmLaneCount(tags['lanes:forward']);
  const backwardTag = osmLaneCount(tags['lanes:backward']);
  const totalTag = osmLaneCount(tags.lanes);

  if (oneway) {
    // On a one-way way every lane runs the same direction, so a directional
    // tag is just a restatement of the total; take whichever OSM gave us.
    const n =
      totalTag ??
      (oneway === 'forward' ? forwardTag : backwardTag) ??
      Math.ceil(classLanes(classId) / 2);
    const lanes = Math.max(1, n);
    return oneway === 'forward'
      ? { backward: 0, forward: lanes, centerTurn: false }
      : { backward: lanes, forward: 0, centerTurn: false };
  }

  if (forwardTag !== undefined || backwardTag !== undefined) {
    // A directional tag on one side only implies the rest of `lanes` runs the
    // other way; with no total, assume the tagged side is matched.
    const remaining =
      totalTag === undefined ? undefined : Math.max(0, totalTag - (centerTurn ? 1 : 0));
    const forward =
      forwardTag ??
      (remaining !== undefined && backwardTag !== undefined
        ? Math.max(0, remaining - backwardTag)
        : backwardTag!);
    const backward =
      backwardTag ??
      (remaining !== undefined && forwardTag !== undefined
        ? Math.max(0, remaining - forwardTag)
        : forwardTag!);
    return { backward, forward, centerTurn };
  }

  const total = Math.max(1, (totalTag ?? classLanes(classId)) - (centerTurn ? 1 : 0));
  if (total === 1) return { backward: 0, forward: 0, centerTurn };
  const backward = Math.floor(total / 2);
  return { backward, forward: total - backward, centerTurn };
}

function classLanes(classId: string | undefined): number {
  return (classId && ROAD_LANES_BY_CLASS[classId]) || wayType('road').defaultCapacity;
}

/**
 * Assign each lane of one direction its catalog kind, applying `turn:lanes`
 * when it lines up. Entries are listed left-to-right *as the driver sees
 * them*, so for backward lanes — stored left-to-right facing forward — the
 * list maps on reversed. A count that doesn't match the lanes we have is
 * ignored outright rather than truncated or padded: misaligned turn data
 * would silently put the pocket in the wrong place, and in real OSM the
 * mismatch usually means the tag describes a different segment.
 */
function laneKindsForDirection(
  count: number,
  turns: string | undefined,
  reversed: boolean,
): string[] {
  const kinds = new Array<string>(count).fill('drive');
  if (!turns) return kinds;
  const entries = turns.split('|');
  if (entries.length !== count) return kinds;
  entries.forEach((entry, i) => {
    if (isTurnOnlyLane(entry)) kinds[reversed ? count - 1 - i : i] = 'turnPocket';
  });
  return kinds;
}

/** Whether the way carries a sidewalk on each side, from OSM's sidewalk
 *  tags. `separate` means the footway is mapped as its own way, so drawing
 *  one here too would double it. Untagged keeps the catalog default. */
function osmSidewalks(tags: Record<string, string>): ProfileEdges {
  const has = (v: string | undefined): boolean | undefined =>
    v === undefined ? undefined : v !== 'no' && v !== 'none' && v !== 'separate';
  const both = tags.sidewalk;
  const fromBoth =
    both === undefined
      ? { left: undefined, right: undefined }
      : both === 'both'
        ? { left: true, right: true }
        : both === 'left'
          ? { left: true, right: false }
          : both === 'right'
            ? { left: false, right: true }
            : { left: has(both), right: has(both) };
  const left = has(tags['sidewalk:left']) ?? fromBoth.left;
  const right = has(tags['sidewalk:right']) ?? fromBoth.right;
  // Left-to-right facing forward: leading edge is the left side.
  return { leading: left, trailing: right };
}

/** Whether a side-of-the-road feature is present on each side, from OSM's
 *  `key` / `key:both` / `key:left` / `key:right` family. A side-specific tag
 *  wins over the both-sides one; absent means absent, since these tags are
 *  only sporadically mapped and inventing a lane from silence would widen
 *  every street that simply hasn't been surveyed. */
function osmSidePresence(
  tags: Record<string, string>,
  prefix: string,
  present: (value: string) => boolean,
): { left: boolean; right: boolean } {
  const read = (key: string): boolean | undefined => {
    const v = tags[key];
    return v === undefined ? undefined : present(v);
  };
  const both = read(prefix) ?? read(`${prefix}:both`);
  return {
    left: read(`${prefix}:left`) ?? both ?? false,
    right: read(`${prefix}:right`) ?? both ?? false,
  };
}

/** OSM `busway` values that mean a bus lane physically exists on that side.
 *  `opposite_lane` is a contraflow bus lane on a one-way street — still a
 *  lane, just running against the general direction. */
const BUSWAY_PRESENT = new Set(['lane', 'opposite_lane', 'share_busway', 'opposite_share_busway']);

/** Parking values that mean cars are actually stored at that kerb. OSM has
 *  two live schemes — the older `parking:lane:<side>=parallel` and the newer
 *  `parking:<side>=lane` — so both are read; everything else in the
 *  vocabulary (`no`, `no_stopping`, `separate`, …) means no parking lane. */
const PARKING_PRESENT = new Set([
  'parallel',
  'diagonal',
  'perpendicular',
  'marked',
  'yes',
  'lane',
  'street_side',
  'on_street',
]);

/** `cycleway` values that mean a bike lane runs along this roadway. A
 *  mapper who instead drew the cycleway as its own way tags `separate` or
 *  `no` here, and that separate way imports on its own — reading those as a
 *  lane would draw the same bike lane twice. `share_busway` is deliberately
 *  absent: that is bikes in the bus lane, not a lane of its own. */
const CYCLEWAY_PRESENT = new Set(['lane', 'track', 'opposite_lane', 'opposite_track', 'sidepath']);

/**
 * The lanes that sit outboard of the travel lanes on each side, ordered
 * from the kerb inwards. OSM tags these as side-of-the-road attributes
 * rather than entries in `lanes`, so they are additional to the lane count,
 * not carved out of it.
 */
function osmSideLanes(
  tags: Record<string, string>,
  oneway: 'forward' | 'backward' | null,
  drivingSide: DrivingSide,
): { left: ProfileTemplateLane[]; right: ProfileTemplateLane[] } {
  const left: ProfileTemplateLane[] = [];
  const right: ProfileTemplateLane[] = [];
  // A kerb lane runs with the traffic beside it, which is the only thing here
  // that depends on the driving side: on a two-way street the left kerb
  // carries backward traffic under right-hand traffic and forward under
  // left-hand. Which kerb each lane sits at does NOT depend on it — see
  // profileFromOsmTags.
  const leftDirection: LaneDirection = oneway ?? (drivingSide === 'left' ? 'forward' : 'backward');
  const rightDirection: LaneDirection = oneway ?? (drivingSide === 'left' ? 'backward' : 'forward');

  // Kerb outwards-in: parking sits outboard of a bus lane.
  const parkingOld = osmSidePresence(tags, 'parking:lane', (v) => PARKING_PRESENT.has(v));
  const parkingNew = osmSidePresence(tags, 'parking', (v) => PARKING_PRESENT.has(v));
  if (parkingOld.left || parkingNew.left) left.push({ kindId: 'parking', direction: 'none' });
  if (parkingOld.right || parkingNew.right) right.push({ kindId: 'parking', direction: 'none' });

  const bike = osmSidePresence(tags, 'cycleway', (v) => CYCLEWAY_PRESENT.has(v));
  if (bike.left) left.push({ kindId: 'bike', direction: leftDirection });
  if (bike.right) right.push({ kindId: 'bike', direction: rightDirection });

  const bus = osmSidePresence(tags, 'busway', (v) => BUSWAY_PRESENT.has(v));
  if (bus.left) left.push({ kindId: 'bus', direction: leftDirection });
  if (bus.right) right.push({ kindId: 'bus', direction: rightDirection });

  return { left, right };
}

/**
 * The cross-section an imported way starts with, read from OSM's own lane
 * tagging rather than defaulted from the way type.
 *
 * Only roads are read this way. `lanes`/`oneway`/`turn:lanes` are road
 * vocabulary; rail and bike ways keep their catalog defaults, where a single
 * bidirectional track or path is already right.
 *
 * Lanes are ordered left-to-right facing the way's own forward direction.
 * That frame is fixed by the way, not by the country, and OSM's `:left` /
 * `:right` suffixes and `turn:lanes` ordering are defined against the same
 * forward direction everywhere — so a sidewalk, bike lane, bus lane, parking
 * lane or turn pocket read from tags sits at the side OSM named, under either
 * driving side.
 *
 * The one thing that does depend on driving side is which half of a two-way
 * street carries forward traffic: the right half under right-hand traffic,
 * the left half under left-hand. Only the travel-lane blocks swap; the kerbs
 * stay where the tags put them.
 */
export function profileFromOsmTags(
  typeId: string,
  classId: string | undefined,
  tags: Record<string, string> | undefined,
  drivingSide: DrivingSide = 'right',
): CrossSection {
  if (typeId !== 'road' || !tags) return defaultProfileFor(typeId);

  const oneway = osmOneway(tags);
  const { backward, forward, centerTurn } = osmLaneCounts(tags, classId);

  // A two-way street with a single lane is one shared bidirectional lane, not
  // a zero-lane one — matching defaultProfileFor's capacity-1 case.
  const side = osmSideLanes(tags, oneway, drivingSide);

  if (!oneway && backward === 0 && forward === 0) {
    const lanes: ProfileTemplateLane[] = [{ kindId: 'drive', direction: 'both' }];
    if (centerTurn) lanes.push({ kindId: 'turnPocket', direction: 'both' });
    // Right-side lanes read kerb-inwards, so they reverse into left-to-right.
    return profileWithPrimaryLanes(
      typeId,
      [...side.left, ...lanes, ...[...side.right].reverse()],
      osmSidewalks(tags),
    );
  }

  const forwardTurns =
    tags['turn:lanes:forward'] ?? (oneway === 'forward' ? tags['turn:lanes'] : undefined);
  const backwardTurns =
    tags['turn:lanes:backward'] ?? (oneway === 'backward' ? tags['turn:lanes'] : undefined);

  // `turn:lanes` lists lanes left-to-right as the DRIVER sees them, so the
  // backward block maps on reversed — it is travelling the other way. That
  // follows from the lane's own direction and is the same under either
  // driving side.
  const backwardLanes = laneKindsForDirection(backward, backwardTurns, true).map((kindId) => ({
    kindId,
    direction: 'backward' as const,
  }));
  const forwardLanes = laneKindsForDirection(forward, forwardTurns, false).map((kindId) => ({
    kindId,
    direction: 'forward' as const,
  }));
  const [nearLeftKerb, nearRightKerb] =
    drivingSide === 'left' ? [forwardLanes, backwardLanes] : [backwardLanes, forwardLanes];

  const primary: ProfileTemplateLane[] = [
    ...side.left,
    ...nearLeftKerb,
    ...(centerTurn ? [{ kindId: 'turnPocket', direction: 'both' as const }] : []),
    ...nearRightKerb,
    ...[...side.right].reverse(),
  ];
  return profileWithPrimaryLanes(typeId, primary, osmSidewalks(tags));
}

/**
 * Vertical alignment from OSM's grade-separation tagging. `tunnel`/`bridge`
 * are the explicit signals; `layer` is the fallback for ways that record
 * only their stacking order. This is what keeps a freeway overpass from
 * reading as a missing junction with the street beneath it — the crossing
 * check skips pairs at different grades (see validate.ts).
 */
export function gradeFromOsmTags(tags: Record<string, string> | undefined): Grade {
  if (!tags) return 'atGrade';
  const no = (v: string | undefined): boolean => v === undefined || v === 'no';
  if (!no(tags.tunnel)) return 'underground';
  if (!no(tags.bridge)) return 'elevated';
  const layer = Number(tags.layer);
  if (Number.isFinite(layer) && layer !== 0) return layer < 0 ? 'underground' : 'elevated';
  return 'atGrade';
}

/**
 * How far apart two carriageways of one street may sit, centreline to
 * centreline. Real divided arterials run roughly 12-19 m apart; 45 m is
 * generous enough for a boulevard with a wide planted median while still
 * rejecting the next street over.
 */
const MAX_CARRIAGEWAY_SEPARATION_M = 45;

/** How antiparallel two carriageways must run: cos of the angle between
 *  their travel directions, so -0.7 is within ~45 deg of exactly opposite. */
const MAX_CARRIAGEWAY_ALIGNMENT = -0.7;

/** The direction a one-way way's traffic travels, as a unit vector in
 *  degrees space — good enough for comparing two nearby ways' headings. */
function travelVector(way: Way): [number, number] | null {
  const dirs = new Set(
    way.profile.lanes
      .filter((l) => l.direction === 'forward' || l.direction === 'backward')
      .map((l) => l.direction),
  );
  if (dirs.size !== 1) return null;
  const first = way.points[0];
  const last = way.points[way.points.length - 1];
  const [dx, dy] = dirs.has('forward')
    ? [last[0] - first[0], last[1] - first[1]]
    : [first[0] - last[0], first[1] - last[1]];
  const len = Math.hypot(dx, dy);
  return len === 0 ? null : [dx / len, dy / len];
}

/** Mean distance from one way's points to the other's path, in metres —
 *  the lateral gap between two roughly parallel carriageways. */
function meanSeparationM(a: Way, b: Way): number {
  let total = 0;
  let n = 0;
  for (const p of a.points) {
    const on = nearestOnPath(b.points, p);
    if (on) {
      total += on.distMeters;
      n++;
    }
  }
  return n === 0 ? Infinity : total / n;
}

/**
 * Detect which same-named one-way ways are the two carriageways of one
 * divided street, so each pair becomes its own two-member NamedWay — the
 * shape `combineCarriageways` needs — with the median it is physically
 * separated by captured alongside it.
 *
 * Pairing is mutual-best-match: each way's partner must also choose it, so a
 * frontage road or a slip lane running alongside a boulevard cannot claim a
 * carriageway that has a better match. Ways with no partner keep the ordinary
 * whole-street identity, which is why a street OSM has split into many
 * unaligned segments simply doesn't produce pairs rather than producing wrong
 * ones.
 */
function carriagewayPairs(ways: Way[]): [Way, Way][] {
  const oriented = ways
    .map((w) => ({ way: w, dir: travelVector(w) }))
    .filter((o): o is { way: Way; dir: [number, number] } => o.dir !== null);
  const best = new Map<string, { partner: Way; separation: number }>();
  for (const a of oriented) {
    for (const b of oriented) {
      if (a.way.id === b.way.id) continue;
      if (a.dir[0] * b.dir[0] + a.dir[1] * b.dir[1] > MAX_CARRIAGEWAY_ALIGNMENT) continue;
      const separation = meanSeparationM(a.way, b.way);
      if (separation > MAX_CARRIAGEWAY_SEPARATION_M) continue;
      const current = best.get(a.way.id);
      if (!current || separation < current.separation)
        best.set(a.way.id, { partner: b.way, separation });
    }
  }
  const pairs: [Way, Way][] = [];
  const taken = new Set<string>();
  for (const [id, { partner }] of best) {
    if (taken.has(id) || taken.has(partner.id)) continue;
    if (best.get(partner.id)?.partner.id !== id) continue; // must be mutual
    taken.add(id);
    taken.add(partner.id);
    pairs.push([ways.find((w) => w.id === id)!, partner]);
  }
  return pairs;
}

/**
 * Group imported ways that are one named facility into NamedWays — OSM
 * splits a street into a way per block, per junction, and per direction, all
 * carrying the same `name`, which is exactly the identity NamedWay exists to
 * hold ("Decatur Avenue"). Without this an import reads as "Road 1 … Road
 * 439" in the UI.
 *
 * Keyed by name *and* way type: a street and the tram line running along it
 * often share a name in OSM but are not one facility. A name matching only
 * one way gets no NamedWay — the identity would add nothing over the way.
 */
function namedWaysFor(
  ways: Way[],
  nameByWayId: Map<string, string>,
): { namedWays: NamedWay[]; medians: { id: string; median: Median }[] } {
  const groups = new Map<string, { name: string; ways: Way[] }>();
  for (const way of ways) {
    const name = nameByWayId.get(way.id);
    if (!name) continue;
    const key = `${way.typeId}\u0000${name}`;
    const group = groups.get(key);
    if (group) group.ways.push(way);
    else groups.set(key, { name, ways: [way] });
  }

  const namedWays: NamedWay[] = [];
  const medians: { id: string; median: Median }[] = [];
  for (const { name, ways: group } of groups.values()) {
    // A divided street's two carriageways become their own identity, so the
    // combine/separate tooling — which works on exactly two members — can act
    // on them. Whatever is left over keeps the ordinary whole-street identity.
    const pairs = carriagewayPairs(group);
    const paired = new Set(pairs.flat().map((w) => w.id));
    for (const [a, b] of pairs) {
      const id = shortId();
      namedWays.push({ id, name, wayIds: [a.id, b.id] });
      // The gap between the carriageways IS the median: their separation less
      // the half-widths they each occupy. A non-positive result means the two
      // ribbons already touch, so there is no median to capture.
      const gap =
        meanSeparationM(a, b) - profileWidthM(a.profile) / 2 - profileWidthM(b.profile) / 2;
      if (gap > 0) medians.push({ id, median: { widthM: gap, kindId: 'median' } });
    }
    const rest = group.filter((w) => !paired.has(w.id));
    if (rest.length >= 2) namedWays.push({ id: shortId(), name, wayIds: rest.map((w) => w.id) });
  }
  return { namedWays, medians };
}

export interface OsmWayElement {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
  /** The way's OSM node ids, index-aligned with `geometry`. Overpass returns
   *  this alongside the coordinates for `out geom;` (which is `out body
   *  geom;` — `body` carries the node ids, `geom` resolves them to
   *  coordinates), and it is what makes junction derivation exact rather
   *  than a coordinate-proximity guess. Optional so a response without it
   *  still imports ways, just unconnected — see osmElementsToNetwork. */
  nodes?: number[];
  /** Relation members, for `type=restriction` relations. */
  members?: { type: string; ref: number; role: string }[];
}

function validOsmGeometry(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every((point) => {
      if (point === null || typeof point !== 'object') return false;
      const fields = point as Record<string, unknown>;
      return (
        typeof fields.lat === 'number' &&
        Number.isFinite(fields.lat) &&
        fields.lat >= -90 &&
        fields.lat <= 90 &&
        typeof fields.lon === 'number' &&
        Number.isFinite(fields.lon) &&
        fields.lon >= -180 &&
        fields.lon <= 180
      );
    })
  );
}

function validOsmMembers(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every((member) => {
      if (member === null || typeof member !== 'object') return false;
      const fields = member as Record<string, unknown>;
      return (
        typeof fields.type === 'string' &&
        ['node', 'way', 'relation'].includes(fields.type) &&
        typeof fields.ref === 'number' &&
        Number.isSafeInteger(fields.ref) &&
        fields.ref > 0 &&
        typeof fields.role === 'string'
      );
    })
  );
}

function validOsmNodes(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every((node) => typeof node === 'number' && Number.isSafeInteger(node) && node > 0)
  );
}

function validOsmTags(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.values(value).every((tag) => typeof tag === 'string')
  );
}

function validOsmElement(value: unknown): value is OsmWayElement {
  if (value === null || typeof value !== 'object') return false;
  const element = value as Record<string, unknown>;
  if (
    typeof element.type !== 'string' ||
    !['node', 'way', 'relation'].includes(element.type) ||
    typeof element.id !== 'number' ||
    !Number.isSafeInteger(element.id) ||
    element.id <= 0
  ) {
    return false;
  }
  if (element.geometry !== undefined && !validOsmGeometry(element.geometry)) return false;
  if (element.nodes !== undefined && !validOsmNodes(element.nodes)) return false;
  if (element.tags !== undefined && !validOsmTags(element.tags)) return false;
  return element.members === undefined || validOsmMembers(element.members);
}

/** Validate the untrusted `elements` array shared by the gateway and browser Worker. */
export function parseOsmElementsPayload(value: unknown): OsmWayElement[] {
  if (!Array.isArray(value) || !value.every(validOsmElement)) {
    throw new Error('Invalid OpenStreetMap response.');
  }
  return value;
}

/** OSM restriction values this import understands. `no_*` forbids one
 *  movement; `only_*` permits one and forbids the rest. Anything outside this
 *  vocabulary — including typos, which do occur — is ignored rather than
 *  guessed at. */
const NO_RESTRICTIONS = new Set([
  'no_left_turn',
  'no_right_turn',
  'no_straight_on',
  'no_u_turn',
  'no_entry',
  'no_exit',
]);
const ONLY_RESTRICTIONS = new Set([
  'only_left_turn',
  'only_right_turn',
  'only_straight_on',
  'only_u_turn',
]);

/** An import's ways, the junctions between them, and the street identities
 *  spanning them. Returned together because ways alone are only half the
 *  imported data: OSM's node identity is the topology, and dropping it
 *  silently yields a network that looks right and routes wrong. */
export interface ImportedNetwork {
  ways: Way[];
  nodes: Node[];
  namedWays: NamedWay[];
  /** Captured medians for the identities that are a carriageway pair, keyed
   *  by NamedWay id — the same component separateCarriageways writes. */
  medians: { id: string; median: Median }[];
  /** Turn bans from OSM restriction relations, keyed by laneRefKey. */
  turnRestrictions: { key: string; restriction: TurnRestriction }[];
}

/**
 * Map an OSM way's tags to a catalog way type + class, or null if it isn't
 * one of the importable categories. The one place OSM's tagging vocabulary
 * meets our catalog — pure and network-free, so fixture data can test it
 * directly without hitting Overpass.
 */
export function classifyOsmWay(
  tags: Record<string, string> | undefined,
): { typeId: string; classId?: string } | null {
  if (!tags) return null;
  const railway = tags.railway;
  if (railway === 'rail' || railway === 'subway') return { typeId: 'heavyRail' };
  if (railway === 'light_rail' || railway === 'tram') return { typeId: 'lightRail' };
  const highway = tags.highway;
  if (highway === 'cycleway') return { typeId: 'bike', classId: 'path' };
  if (highway && ROAD_CLASS_BY_HIGHWAY[highway])
    return { typeId: 'road', classId: ROAD_CLASS_BY_HIGHWAY[highway] };
  return null;
}

/** OSM node tags that map onto the catalog's junction controls. `stop` is
 *  approximate: OSM puts `highway=stop` on the specific approach that must
 *  stop, while Node.control describes the whole junction (ApproachControl
 *  holds per-arm control, but the import can't tell which arm the sign
 *  faces). */
function controlFromOsmNodeTags(tags: Record<string, string> | undefined): NodeControl | undefined {
  const highway = tags?.highway;
  if (highway === 'traffic_signals') return 'signal';
  if (highway === 'stop') return 'stop';
  return undefined;
}

/** Which control wins when a junction is described more than once — a
 *  signalized roundabout is a signal, and a junction with any signalized
 *  approach is signalized regardless of what the other arms say. */
const CONTROL_RANK: Record<NodeControl, number> = {
  // controlFromOsmNodeTags never returns 'levelCrossing' — OSM import builds
  // no guideway/road junctions at all, so this value is unreachable through
  // this path today. Ranked above every real vote so a future import that
  // does derive one (e.g. from railway=level_crossing) isn't silently
  // outranked by a signal tag on the same node.
  levelCrossing: 4,
  signal: 3,
  stop: 2,
  roundabout: 1,
  uncontrolled: 0,
};

/**
 * How far back from a junction a stop line may sit and still be that
 * junction's control.
 *
 * OSM almost never puts `highway=traffic_signals` on the shared junction
 * node: it goes on the approach way at the stop line. Measured over the
 * streets around Flamingo and Las Vegas Boulevard, none of 37 control nodes
 * were on a junction node and the ones that were on an imported way sat a
 * median of 15 m from theirs (p90 55 m). 40 m claims 25 of 28 while
 * excluding a 229 m outlier that plainly governs something else.
 *
 * The search follows the way the sign sits on rather than taking the nearest
 * junction by straight-line distance, which matters here specifically: two
 * carriageways of one boulevard run about 15–20 m apart, the same order as
 * this distance, so a straight-line match would routinely signalize the
 * junction on the opposite carriageway.
 */
const CONTROL_STOPLINE_METERS = 40;

/**
 * The junction a stop-line control node governs: the nearest junction along
 * its own way, in either direction, within CONTROL_STOPLINE_METERS. Walking
 * the way rather than searching by straight-line distance is what keeps a
 * signal off the parallel carriageway a few metres away.
 */
function junctionAlongWay(
  entry: { way: Way; osmNodes: number[] },
  startIndex: number,
  isJunction: (osmNodeId: number) => boolean,
): number | undefined {
  let best: number | undefined;
  let bestDistance = Infinity;
  for (const step of [1, -1]) {
    let distance = 0;
    for (let i = startIndex; ; i += step) {
      const next = i + step;
      if (next < 0 || next >= entry.osmNodes.length) break;
      distance += haversineMeters(entry.way.points[i], entry.way.points[next]);
      if (distance > CONTROL_STOPLINE_METERS) break;
      if (isJunction(entry.osmNodes[next])) {
        if (distance < bestDistance) {
          bestDistance = distance;
          best = entry.osmNodes[next];
        }
        break;
      }
    }
  }
  return best;
}

/**
 * Turn parsed Overpass `elements` into Ways plus the junctions between them.
 *
 * Each Way is tagged with its OSM source (`osm:<wayId>`) so an imported way
 * is always distinguishable from a hand-drawn one. Elements that aren't a
 * recognized category are skipped, and their node ids never enter the map —
 * so a street meeting an unimported footpath yields no junction, correctly.
 *
 * Junctions come from OSM node *identity*, not coordinate proximity. Two
 * ways share a Node exactly when OSM says they share a node, which means no
 * tolerance to tune and — the case that actually bites this app, since it
 * imports several categories at once — a tram line drawn down the middle of
 * a street never gets welded to the roadway it merely overlaps. Structurally
 * this mirrors serialize.ts's deriveNodesFromWays (group refs by a key, emit
 * a Node where a key has 2+); only the key differs, an OSM node id instead
 * of a rounded coordinate.
 */
/**
 * Turn bans from OSM `type=restriction` relations.
 *
 * A relation names a `from` way, a `via` node, and a `to` way. This model
 * expresses the same thing per lane, as the set of ways a lane may still
 * feed, so a ban becomes: every arm at the via junction except the forbidden
 * one. `only_*` is the inverse and yields just the named target.
 *
 * Only via-NODE restrictions are read. A via-WAY restriction describes a
 * movement through a whole link (a slip road), which has no expression in a
 * per-lane allowedTargets set at a single junction, and guessing one would
 * ban movements the sign never mentions.
 *
 * The ban lands only on lanes that can actually drive the movement — drive
 * and bus lanes on the approach. Without that filter it lands on whichever
 * lane is outermost, which on a street with a kerbside cycleway is the bike
 * lane, so a no-right-turn for cars would forbid only the bicycle.
 */
function turnRestrictionsFrom(
  elements: OsmWayElement[],
  wayByOsmId: Map<number, Way>,
  armsByOsmNode: Map<number, Set<string>>,
  osmNodeOfWayPoint: Map<string, number>,
): { key: string; restriction: TurnRestriction }[] {
  const out: { key: string; restriction: TurnRestriction }[] = [];
  for (const el of elements) {
    if (el.type !== 'relation' || !el.members || el.tags?.type !== 'restriction') continue;
    const value = el.tags.restriction;
    const isOnly = value !== undefined && ONLY_RESTRICTIONS.has(value);
    if (!value || (!isOnly && !NO_RESTRICTIONS.has(value))) continue;

    const from = el.members.find((m) => m.role === 'from' && m.type === 'way');
    const to = el.members.find((m) => m.role === 'to' && m.type === 'way');
    const via = el.members.find((m) => m.role === 'via');
    if (!from || !to || !via || via.type !== 'node') continue;

    const fromWay = wayByOsmId.get(from.ref);
    const toWay = wayByOsmId.get(to.ref);
    const arms = armsByOsmNode.get(via.ref);
    // Every part must have survived the import: a ban naming a way we skipped
    // (a service road, a link road) would otherwise permit-list around a gap.
    if (!fromWay || !toWay || !arms || !arms.has(fromWay.id) || !arms.has(toWay.id)) continue;

    const others = [...arms].filter((id) => id !== fromWay.id);
    const allowedTargets = isOnly ? [toWay.id] : others.filter((id) => id !== toWay.id);

    // Only the approach lanes that reach this junction, and only ones that
    // could make the turn.
    for (const lane of fromWay.profile.lanes) {
      if (lane.kindId !== 'drive' && lane.kindId !== 'bus' && lane.kindId !== 'turnPocket')
        continue;
      if (
        lane.direction !== 'forward' &&
        lane.direction !== 'backward' &&
        lane.direction !== 'both'
      )
        continue;
      const endIndex = lane.direction === 'backward' ? 0 : fromWay.points.length - 1;
      if (osmNodeOfWayPoint.get(`${fromWay.id}:${endIndex}`) !== via.ref) continue;
      out.push({ key: `${fromWay.id}:${lane.id}`, restriction: { allowedTargets } });
    }
  }
  return out;
}

export function osmElementsToNetwork(
  elements: OsmWayElement[],
  drivingSide: DrivingSide = 'right',
): ImportedNetwork {
  const ways: Way[] = [];
  // OSM node id -> every (way, control point) that node landed on.
  const refsByOsmNode = new Map<number, WayPointRef[]>();
  const coordByOsmNode = new Map<number, LngLat>();
  const nameByWayId = new Map<string, string>();
  // Junction control, from standalone node elements and from roundabout ways.
  const controlByOsmNode = new Map<number, NodeControl>();
  const roundaboutOsmNodes = new Set<number>();
  // Each imported way's OSM node ids, kept so a stop-line control node can be
  // walked along its own way to the junction it governs.
  const osmNodesByWayId = new Map<string, { way: Way; osmNodes: number[] }>();
  // For turn restrictions: which imported way each OSM way became, which ways
  // meet each OSM node, and which OSM node each way-end sits on.
  const wayByOsmId = new Map<number, Way>();
  const armsByOsmNode = new Map<number, Set<string>>();
  const osmNodeOfWayPoint = new Map<string, number>();

  for (const el of elements) {
    // A control node is matched to its junction by id alone — its own
    // coordinates are never needed, since the ways already carry the
    // coordinate for every node id they pass through.
    if (el.type === 'node') {
      const control = controlFromOsmNodeTags(el.tags);
      if (control) controlByOsmNode.set(el.id, control);
      continue;
    }
    if (el.type !== 'way' || !el.geometry || el.geometry.length < 2) continue;
    const kind = classifyOsmWay(el.tags);
    if (!kind) continue;
    const points: LngLat[] = el.geometry.map((g) => [g.lon, g.lat]);
    const way: Way = {
      id: shortId(),
      typeId: kind.typeId,
      points,
      geometry: 'straight',
      grade: gradeFromOsmTags(el.tags),
      profile: profileFromOsmTags(kind.typeId, kind.classId, el.tags, drivingSide),
      classId: kind.classId,
      source: `osm:${el.id}`,
    };
    ways.push(way);
    wayByOsmId.set(el.id, way);
    const name = el.tags?.name?.trim();
    if (name) nameByWayId.set(way.id, name);

    // Index alignment is the whole mechanism: el.nodes[i] is the OSM node at
    // el.geometry[i], which became way.points[i]. A response where those
    // lengths disagree can't be aligned, so it contributes geometry but no
    // refs rather than mismatched ones.
    if (!el.nodes || el.nodes.length !== points.length) continue;
    osmNodesByWayId.set(way.id, { way, osmNodes: el.nodes });
    // A roundabout is a way in OSM, not a node, so its junctions inherit the
    // control from the circulatory way they sit on.
    const isRoundabout = el.tags?.junction === 'roundabout';
    el.nodes.forEach((osmNodeId, i) => {
      const refs = refsByOsmNode.get(osmNodeId);
      if (refs) refs.push({ wayId: way.id, pointIndex: i });
      else refsByOsmNode.set(osmNodeId, [{ wayId: way.id, pointIndex: i }]);
      coordByOsmNode.set(osmNodeId, points[i]);
      osmNodeOfWayPoint.set(`${way.id}:${i}`, osmNodeId);
      const arms = armsByOsmNode.get(osmNodeId);
      if (arms) arms.add(way.id);
      else armsByOsmNode.set(osmNodeId, new Set([way.id]));
      if (isRoundabout) roundaboutOsmNodes.add(osmNodeId);
    });
  }

  // Only shared nodes are junctions. A Node per vertex would be both wrong
  // (a bend in one street is not a junction) and enormous.
  const isJunction = (osmNodeId: number): boolean =>
    (refsByOsmNode.get(osmNodeId)?.length ?? 0) >= 2;

  // Resolve every control claim onto a junction, strongest claim winning.
  const controlByJunction = new Map<number, NodeControl>();
  const claim = (osmNodeId: number, control: NodeControl): void => {
    const current = controlByJunction.get(osmNodeId);
    if (!current || CONTROL_RANK[control] > CONTROL_RANK[current])
      controlByJunction.set(osmNodeId, control);
  };
  for (const osmNodeId of roundaboutOsmNodes)
    if (isJunction(osmNodeId)) claim(osmNodeId, 'roundabout');
  for (const [osmNodeId, control] of controlByOsmNode) {
    if (isJunction(osmNodeId)) {
      claim(osmNodeId, control);
      continue;
    }
    // The usual case: a stop line partway along one approach. Walk that way
    // to the junction it governs — see CONTROL_STOPLINE_METERS.
    const ref = refsByOsmNode.get(osmNodeId)?.[0];
    const entry = ref && osmNodesByWayId.get(ref.wayId);
    if (!ref || !entry) continue;
    const governed = junctionAlongWay(entry, ref.pointIndex, isJunction);
    if (governed !== undefined) claim(governed, control);
  }

  const nodes: Node[] = [];
  for (const [osmNodeId, refs] of refsByOsmNode) {
    if (refs.length < 2) continue;
    const control = controlByJunction.get(osmNodeId);
    nodes.push({
      id: shortId(),
      coord: coordByOsmNode.get(osmNodeId)!,
      refs,
      ...(control ? { control } : {}),
    });
  }
  const named = namedWaysFor(ways, nameByWayId);
  return {
    ways,
    // OSM shares node ids between a street-running tram and the road it runs
    // down, and between a bike path and the street it crosses. Those are one
    // OSM node but not one junction — a junction is a lane graph, and these
    // ways have no lanes in common. See model/junctions.ts.
    nodes: withSingleTypeArms(nodes, wayTypeIndex(ways)),
    namedWays: named.namedWays,
    medians: named.medians,
    turnRestrictions: turnRestrictionsFrom(elements, wayByOsmId, armsByOsmNode, osmNodeOfWayPoint),
  };
}

/** The ways of an import, without its junctions — kept for callers that only
 *  need the geometry. Prefer osmElementsToNetwork, which also returns the
 *  topology OSM gave us. */
export function osmElementsToWays(
  elements: OsmWayElement[],
  drivingSide: DrivingSide = 'right',
): Way[] {
  return osmElementsToNetwork(elements, drivingSide).ways;
}

/** An import filtered against what a system already holds, plus how much was
 *  dropped — the dialog reports it, since "imported 0 ways" and "all 149 of
 *  these are already here" mean very different things to someone who just
 *  clicked the button twice. */
export interface DedupedImport {
  network: ImportedNetwork;
  /** Ways skipped because that OSM way is already in the system. */
  duplicateWays: number;
  /** Existing street identities that gain members from this import, rather
   *  than a second identity being created alongside them. Apply these to the
   *  system's own namedWays before appending `network.namedWays`. */
  identityAdditions: { id: string; wayIds: string[] }[];
  /** Existing junctions that gain an arm from this import, for the same
   *  reason — a junction the system already has must not be duplicated when
   *  a new way joins it. */
  junctionAdditions: { id: string; refs: WayPointRef[] }[];
}

/**
 * Drop the parts of an import the system already has, and re-point what's
 * left at the copies it kept.
 *
 * Import is additive, and re-importing is easy to do by accident: click the
 * button twice, or import a second viewport that overlaps the first —
 * Overpass returns a way whole whenever any of it falls in the box, so
 * neighbouring imports share their boundary streets. Without this, every
 * repeat silently doubled the geometry into overlapping ways that look like
 * one street and behave like two.
 *
 * The re-pointing is what makes a second import *join* the first rather than
 * merely not duplicate it: a junction between a way already present and a
 * newly imported one survives, with its ref aimed at the existing way. That
 * is the same exact node-identity join used within a single import, so it
 * still needs no proximity tolerance.
 *
 * A way the user has since edited (its point count no longer matches OSM's)
 * is still recognised as a duplicate and dropped, but refs into it are NOT
 * re-pointed: the indices no longer mean what OSM meant by them, and a
 * junction placed on the wrong vertex of someone's edited street is worse
 * than a junction they can add back themselves.
 */
export function withoutAlreadyImported(
  network: ImportedNetwork,
  existingWays: Way[],
  existingNamedWays: NamedWay[] = [],
  existingNodes: Node[] = [],
): DedupedImport {
  const existingBySource = new Map<string, Way>();
  for (const way of existingWays) if (way.source) existingBySource.set(way.source, way);

  const keptWays: Way[] = [];
  // New way id -> the already-present way it duplicates, when refs into it
  // can still be trusted to line up.
  const rePointTo = new Map<string, string>();
  const dropped = new Set<string>();
  let duplicateWays = 0;

  for (const way of network.ways) {
    const existing = way.source ? existingBySource.get(way.source) : undefined;
    if (!existing) {
      keptWays.push(way);
      continue;
    }
    duplicateWays++;
    dropped.add(way.id);
    if (existing.points.length === way.points.length) rePointTo.set(way.id, existing.id);
  }

  const keptWayIds = new Set(keptWays.map((w) => w.id));
  const resolve = (wayId: string): string | undefined =>
    keptWayIds.has(wayId) ? wayId : rePointTo.get(wayId);

  const typeOfWay = new Map<string, string>();
  for (const w of existingWays) typeOfWay.set(w.id, w.typeId);
  for (const w of keptWays) typeOfWay.set(w.id, w.typeId);
  const groupOfWay = (wayId: string | undefined): string | undefined => {
    const typeId = wayId === undefined ? undefined : typeOfWay.get(wayId);
    return typeId === undefined ? undefined : junctionGroupOf(typeId);
  };

  // Which existing junction, if any, an incoming one already is — matched by
  // a shared (way, point) arm, which is exact and needs no coordinates.
  const existingNodeByArm = new Map<string, Node>();
  for (const node of existingNodes) {
    for (const ref of node.refs) existingNodeByArm.set(`${ref.wayId}:${ref.pointIndex}`, node);
  }

  const nodes: Node[] = [];
  const junctionAdditions: { id: string; refs: WayPointRef[] }[] = [];
  for (const node of network.nodes) {
    const refs: WayPointRef[] = [];
    for (const ref of node.refs) {
      const wayId = resolve(ref.wayId);
      if (wayId) refs.push({ ...ref, wayId });
    }
    if (refs.length < 2) continue;

    // Reuse the existing junction: moveWayPoint and setNodeControl address one
    // Node, so a coincident rival would leave half the junction behind.
    const existing = refs
      .map((r) => existingNodeByArm.get(`${r.wayId}:${r.pointIndex}`))
      .find((n) => n !== undefined);
    if (existing) {
      const known = new Set(existing.refs.map((r) => `${r.wayId}:${r.pointIndex}`));
      // An arm may only join a junction whose other arms are of a compatible
      // kind of way — the same rule withSingleTypeArms enforces on whole
      // junctions, applied one arm at a time, so that importing a tram line
      // down an existing street cannot wire its track into that street's lane
      // graph by increments. A cycleway meeting the same street still joins:
      // both are in the street junction group.
      const existingGroup = groupOfWay(existing.refs[0]?.wayId);
      const additions = refs.filter(
        (r) => !known.has(`${r.wayId}:${r.pointIndex}`) && groupOfWay(r.wayId) === existingGroup,
      );
      if (additions.length > 0) junctionAdditions.push({ id: existing.id, refs: additions });
      continue;
    }

    // Every arm already in the system, and no existing junction recognises
    // any of them: nothing new to record.
    if (!refs.some((r) => keptWayIds.has(r.wayId))) continue;
    nodes.push({ ...node, refs });
  }

  // A street that straddles two imports must end up in ONE identity. Without
  // this, the overlapping-import case creates a second "West Flamingo Road"
  // and puts the shared boundary way in both — the way is then renamed by one
  // identity and not the other, and the member count that gates the
  // carriageway tools counts it twice.
  const identityKey = (name: string, wayIds: string[]): string =>
    `${typeOfWay.get(wayIds[0]) ?? ''}\u0000${name}`;
  const existingByKey = new Map<string, NamedWay>();
  for (const identity of existingNamedWays) {
    if (identity.wayIds.length > 0)
      existingByKey.set(identityKey(identity.name, identity.wayIds), identity);
  }

  const namedWays: NamedWay[] = [];
  const identityAdditions: { id: string; wayIds: string[] }[] = [];
  for (const identity of network.namedWays) {
    const wayIds = identity.wayIds.map(resolve).filter((id): id is string => id !== undefined);
    if (wayIds.length < 2) continue;
    const existing = existingByKey.get(identityKey(identity.name, wayIds));
    if (existing) {
      const additions = wayIds.filter((id) => !existing.wayIds.includes(id));
      if (additions.length > 0) identityAdditions.push({ id: existing.id, wayIds: additions });
      continue;
    }
    // Same reasoning as junctions: an identity spanning only ways that were
    // already here was already created when they were.
    if (!wayIds.some((id) => keptWayIds.has(id))) continue;
    namedWays.push({ ...identity, wayIds });
  }

  const keptIds = new Set(namedWays.map((n) => n.id));
  return {
    network: {
      ways: keptWays,
      // Every import lands here, not only OSM's — a hand-built network, or a
      // document imported into another, gets the junction rule applied at the
      // same choke point rather than trusting whoever built the input.
      nodes: withSingleTypeArms(nodes, typeOfWay),
      namedWays,
      medians: network.medians.filter((m) => keptIds.has(m.id)),
      // A restriction on a way this import didn't keep is already recorded
      // against the copy that is present.
      turnRestrictions: network.turnRestrictions.filter((t) =>
        keptWayIds.has(t.key.slice(0, t.key.indexOf(':'))),
      ),
    },
    duplicateWays,
    identityAdditions,
    junctionAdditions,
  };
}
