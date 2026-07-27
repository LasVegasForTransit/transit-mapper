// P4 — import real infrastructure. The generalized model already accommodates
// this: a Way is a Way whether hand-drawn or pulled from OpenStreetMap, so
// importing is just another Way *producer* — a `source` marker is the only
// difference. Two layers, deliberately split for testability:
//  - pure, network-free transforms (classifyOsmWay, osmElementsToWays,
//    buildOverpassQuery) that fixture-based tests can exercise directly;
//  - importOsmWays, the one function that actually calls the network.
import { shortId } from "./ids";
import { defaultProfileFor } from "./profile";
import type { LngLat, Node, Way, WayPointRef } from "./system";

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

/** An import's ways plus the junctions between them. Returned together
 *  because ways alone are only half the imported data: OSM's node identity
 *  is the topology, and dropping it silently yields a network that looks
 *  right and routes wrong. */
export interface ImportedNetwork {
  ways: Way[];
  nodes: Node[];
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
      profile: defaultProfileFor(kind.typeId),
      classId: kind.classId,
      source: `osm:${el.id}`,
    };
    ways.push(way);

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
  return { ways, nodes };
}

/** The ways of an import, without its junctions — kept for callers that only
 *  need the geometry. Prefer osmElementsToNetwork, which also returns the
 *  topology OSM gave us. */
export function osmElementsToWays(elements: OsmWayElement[]): Way[] {
  return osmElementsToNetwork(elements).ways;
}

/** Fetch OSM ways for the given categories within a bounding box from the
 *  public Overpass API and convert them to catalog-typed Ways plus the
 *  junctions between them. The only function here that touches the network. */
export async function importOsmWays(bbox: ImportBBox, categories: ImportCategory[]): Promise<ImportedNetwork> {
  if (categories.length === 0) return { ways: [], nodes: [] };
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
