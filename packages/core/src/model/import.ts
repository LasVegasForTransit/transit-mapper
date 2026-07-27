// P4 — import real infrastructure. The generalized model already accommodates
// this: a Way is a Way whether hand-drawn or pulled from OpenStreetMap, so
// importing is just another Way *producer* — a `source` marker is the only
// difference. Two layers, deliberately split for testability:
//  - pure, network-free transforms (classifyOsmWay, osmElementsToWays,
//    buildOverpassQuery) that fixture-based tests can exercise directly;
//  - importOsmWays, the one function that actually calls the network.
import { wayType, type ProfileTemplateLane } from "./catalog";
import { shortId } from "./ids";
import { defaultProfileFor, profileWithPrimaryLanes, MAX_PRIMARY_LANES, type ProfileEdges } from "./profile";
import type { CrossSection, LngLat, NamedWay, Node, Way, WayPointRef } from "./system";

export interface ImportBBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

// Which OSM tagging categories are importable — data-driven, so adding one is
// a catalog entry here, not new branching logic elsewhere.
export type ImportCategory = "road" | "heavyRail" | "lightRail" | "bike";

export const IMPORT_CATEGORY_ORDER: ImportCategory[] = ["road", "heavyRail", "lightRail", "bike"];

export const IMPORT_CATEGORY_LABELS: Record<ImportCategory, string> = {
  road: "Streets",
  heavyRail: "Heavy rail",
  lightRail: "Light rail / tram",
  bike: "Bike infrastructure",
};

// The Overpass QL clause selecting each category's OSM ways. `(bbox)` is
// substituted with the actual bounding box in buildOverpassQuery.
const CATEGORY_QUERY: Record<ImportCategory, string> = {
  road: `way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street)$"](bbox);`,
  heavyRail: `way["railway"~"^(rail|subway)$"](bbox);`,
  lightRail: `way["railway"~"^(light_rail|tram)$"](bbox);`,
  bike: `way["highway"="cycleway"](bbox);`,
};

/** Build an Overpass QL query for the given categories within a bounding box. */
export function buildOverpassQuery(bbox: ImportBBox, categories: ImportCategory[]): string {
  const bboxStr = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  const clauses = categories.map((c) => CATEGORY_QUERY[c].replace(/\(bbox\)/g, `(${bboxStr})`)).join("\n  ");
  return `[out:json][timeout:25];\n(\n  ${clauses}\n);\nout geom;`;
}

// v3's own road classes stand in for OSM's `highway` hierarchy — a rough but
// reasonable default; the user can always change a way's class after import.
const ROAD_CLASS_BY_HIGHWAY: Record<string, string> = {
  motorway: "transitway",
  trunk: "arterial",
  primary: "arterial",
  secondary: "arterial",
  tertiary: "collector",
  residential: "local",
  unclassified: "local",
  living_street: "local",
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
const TURN_ONLY_VALUES = new Set(["left", "right", "slight_left", "slight_right", "sharp_left", "sharp_right", "reverse"]);

/** A single `turn:lanes` entry (values within one lane are `;`-separated). */
function isTurnOnlyLane(entry: string): boolean {
  const values = entry.split(";").map((v) => v.trim()).filter(Boolean);
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
function osmOneway(tags: Record<string, string>): "forward" | "backward" | null {
  const v = tags.oneway;
  if (v === "yes" || v === "true" || v === "1") return "forward";
  if (v === "-1" || v === "reverse") return "backward";
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

function rawOsmLaneCounts(tags: Record<string, string>, classId: string | undefined): OsmLaneCounts {
  const oneway = osmOneway(tags);
  const centerTurn = (osmLaneCount(tags["lanes:both_ways"]) ?? 0) > 0 && oneway === null;
  const forwardTag = osmLaneCount(tags["lanes:forward"]);
  const backwardTag = osmLaneCount(tags["lanes:backward"]);
  const totalTag = osmLaneCount(tags.lanes);

  if (oneway) {
    // On a one-way way every lane runs the same direction, so a directional
    // tag is just a restatement of the total; take whichever OSM gave us.
    const n = totalTag ?? (oneway === "forward" ? forwardTag : backwardTag) ?? Math.ceil(classLanes(classId) / 2);
    const lanes = Math.max(1, n);
    return oneway === "forward" ? { backward: 0, forward: lanes, centerTurn: false } : { backward: lanes, forward: 0, centerTurn: false };
  }

  if (forwardTag !== undefined || backwardTag !== undefined) {
    // A directional tag on one side only implies the rest of `lanes` runs the
    // other way; with no total, assume the tagged side is matched.
    const remaining = totalTag === undefined ? undefined : Math.max(0, totalTag - (centerTurn ? 1 : 0));
    const forward = forwardTag ?? (remaining !== undefined && backwardTag !== undefined ? Math.max(0, remaining - backwardTag) : backwardTag!);
    const backward = backwardTag ?? (remaining !== undefined && forwardTag !== undefined ? Math.max(0, remaining - forwardTag) : forwardTag!);
    return { backward, forward, centerTurn };
  }

  const total = Math.max(1, (totalTag ?? classLanes(classId)) - (centerTurn ? 1 : 0));
  if (total === 1) return { backward: 0, forward: 0, centerTurn };
  const backward = Math.floor(total / 2);
  return { backward, forward: total - backward, centerTurn };
}

function classLanes(classId: string | undefined): number {
  return (classId && ROAD_LANES_BY_CLASS[classId]) || wayType("road").defaultCapacity;
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
function laneKindsForDirection(count: number, turns: string | undefined, reversed: boolean): string[] {
  const kinds = new Array<string>(count).fill("drive");
  if (!turns) return kinds;
  const entries = turns.split("|");
  if (entries.length !== count) return kinds;
  entries.forEach((entry, i) => {
    if (isTurnOnlyLane(entry)) kinds[reversed ? count - 1 - i : i] = "turnPocket";
  });
  return kinds;
}

/** Whether the way carries a sidewalk on each side, from OSM's sidewalk
 *  tags. `separate` means the footway is mapped as its own way, so drawing
 *  one here too would double it. Untagged keeps the catalog default. */
function osmSidewalks(tags: Record<string, string>): ProfileEdges {
  const has = (v: string | undefined): boolean | undefined =>
    v === undefined ? undefined : v !== "no" && v !== "none" && v !== "separate";
  const both = tags.sidewalk;
  const fromBoth =
    both === undefined
      ? { left: undefined, right: undefined }
      : both === "both"
        ? { left: true, right: true }
        : both === "left"
          ? { left: true, right: false }
          : both === "right"
            ? { left: false, right: true }
            : { left: has(both), right: has(both) };
  const left = has(tags["sidewalk:left"]) ?? fromBoth.left;
  const right = has(tags["sidewalk:right"]) ?? fromBoth.right;
  // Left-to-right facing forward: leading edge is the left side.
  return { leading: left, trailing: right };
}

/**
 * The cross-section an imported way starts with, read from OSM's own lane
 * tagging rather than defaulted from the way type.
 *
 * Only roads are read this way. `lanes`/`oneway`/`turn:lanes` are road
 * vocabulary; rail and bike ways keep their catalog defaults, where a single
 * bidirectional track or path is already right.
 *
 * Lane order assumes right-hand traffic, matching defaultProfileFor and
 * withLaneCount — backward lanes sit to the left. A left-hand-traffic import
 * comes in mirrored and needs flipping.
 */
export function profileFromOsmTags(typeId: string, classId: string | undefined, tags: Record<string, string> | undefined): CrossSection {
  if (typeId !== "road" || !tags) return defaultProfileFor(typeId);

  const oneway = osmOneway(tags);
  const { backward, forward, centerTurn } = osmLaneCounts(tags, classId);

  // A two-way street with a single lane is one shared bidirectional lane, not
  // a zero-lane one — matching defaultProfileFor's capacity-1 case.
  if (!oneway && backward === 0 && forward === 0) {
    const lanes: ProfileTemplateLane[] = [{ kindId: "drive", direction: "both" }];
    if (centerTurn) lanes.push({ kindId: "turnPocket", direction: "both" });
    return profileWithPrimaryLanes(typeId, lanes, osmSidewalks(tags));
  }

  const forwardTurns = tags["turn:lanes:forward"] ?? (oneway === "forward" ? tags["turn:lanes"] : undefined);
  const backwardTurns = tags["turn:lanes:backward"] ?? (oneway === "backward" ? tags["turn:lanes"] : undefined);

  const primary: ProfileTemplateLane[] = [
    ...laneKindsForDirection(backward, backwardTurns, true).map((kindId) => ({ kindId, direction: "backward" as const })),
    ...(centerTurn ? [{ kindId: "turnPocket", direction: "both" as const }] : []),
    ...laneKindsForDirection(forward, forwardTurns, false).map((kindId) => ({ kindId, direction: "forward" as const })),
  ];
  return profileWithPrimaryLanes(typeId, primary, osmSidewalks(tags));
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
function namedWaysFor(ways: Way[], nameByWayId: Map<string, string>): NamedWay[] {
  const groups = new Map<string, { name: string; wayIds: string[] }>();
  for (const way of ways) {
    const name = nameByWayId.get(way.id);
    if (!name) continue;
    const key = `${way.typeId} ${name}`;
    const group = groups.get(key);
    if (group) group.wayIds.push(way.id);
    else groups.set(key, { name, wayIds: [way.id] });
  }
  const named: NamedWay[] = [];
  for (const { name, wayIds } of groups.values()) {
    if (wayIds.length < 2) continue;
    named.push({ id: shortId(), name, wayIds });
  }
  return named;
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
}

/** An import's ways, the junctions between them, and the street identities
 *  spanning them. Returned together because ways alone are only half the
 *  imported data: OSM's node identity is the topology, and dropping it
 *  silently yields a network that looks right and routes wrong. */
export interface ImportedNetwork {
  ways: Way[];
  nodes: Node[];
  namedWays: NamedWay[];
}

/**
 * Map an OSM way's tags to a catalog way type + class, or null if it isn't
 * one of the importable categories. The one place OSM's tagging vocabulary
 * meets our catalog — pure and network-free, so fixture data can test it
 * directly without hitting Overpass.
 */
export function classifyOsmWay(tags: Record<string, string> | undefined): { typeId: string; classId?: string } | null {
  if (!tags) return null;
  const railway = tags.railway;
  if (railway === "rail" || railway === "subway") return { typeId: "heavyRail" };
  if (railway === "light_rail" || railway === "tram") return { typeId: "lightRail" };
  const highway = tags.highway;
  if (highway === "cycleway") return { typeId: "bike", classId: "path" };
  if (highway && ROAD_CLASS_BY_HIGHWAY[highway]) return { typeId: "road", classId: ROAD_CLASS_BY_HIGHWAY[highway] };
  return null;
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
export function osmElementsToNetwork(elements: OsmWayElement[]): ImportedNetwork {
  const ways: Way[] = [];
  // OSM node id -> every (way, control point) that node landed on.
  const refsByOsmNode = new Map<number, WayPointRef[]>();
  const coordByOsmNode = new Map<number, LngLat>();
  const nameByWayId = new Map<string, string>();

  for (const el of elements) {
    if (el.type !== "way" || !el.geometry || el.geometry.length < 2) continue;
    const kind = classifyOsmWay(el.tags);
    if (!kind) continue;
    const points: LngLat[] = el.geometry.map((g) => [g.lon, g.lat]);
    const way: Way = {
      id: shortId(),
      typeId: kind.typeId,
      points,
      geometry: "straight",
      grade: "atGrade",
      profile: profileFromOsmTags(kind.typeId, kind.classId, el.tags),
      classId: kind.classId,
      source: `osm:${el.id}`,
    };
    ways.push(way);
    const name = el.tags?.name?.trim();
    if (name) nameByWayId.set(way.id, name);

    // Index alignment is the whole mechanism: el.nodes[i] is the OSM node at
    // el.geometry[i], which became way.points[i]. A response where those
    // lengths disagree can't be aligned, so it contributes geometry but no
    // refs rather than mismatched ones.
    if (!el.nodes || el.nodes.length !== points.length) continue;
    el.nodes.forEach((osmNodeId, i) => {
      const refs = refsByOsmNode.get(osmNodeId);
      if (refs) refs.push({ wayId: way.id, pointIndex: i });
      else refsByOsmNode.set(osmNodeId, [{ wayId: way.id, pointIndex: i }]);
      coordByOsmNode.set(osmNodeId, points[i]);
    });
  }

  // Only shared nodes are junctions. A Node per vertex would be both wrong
  // (a bend in one street is not a junction) and enormous.
  const nodes: Node[] = [];
  for (const [osmNodeId, refs] of refsByOsmNode) {
    if (refs.length < 2) continue;
    nodes.push({ id: shortId(), coord: coordByOsmNode.get(osmNodeId)!, refs });
  }
  return { ways, nodes, namedWays: namedWaysFor(ways, nameByWayId) };
}

/** The ways of an import, without its junctions — kept for callers that only
 *  need the geometry. Prefer osmElementsToNetwork, which also returns the
 *  topology OSM gave us. */
export function osmElementsToWays(elements: OsmWayElement[]): Way[] {
  return osmElementsToNetwork(elements).ways;
}

/** Fetch OSM ways for the given categories within a bounding box from the
 *  public Overpass API and convert them to catalog-typed Ways plus the
 *  junctions and street identities between them. The only function here that
 *  touches the network. */
export async function importOsmWays(bbox: ImportBBox, categories: ImportCategory[]): Promise<ImportedNetwork> {
  if (categories.length === 0) return { ways: [], nodes: [], namedWays: [] };
  const query = buildOverpassQuery(bbox, categories);
  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: query,
  });
  if (!res.ok) throw new Error(`OSM import failed (${res.status}).`);
  const data = (await res.json()) as { elements?: OsmWayElement[] };
  return osmElementsToNetwork(data.elements ?? []);
}
