import type { FeatureCollection, Feature, LineString, Point, Polygon } from "geojson";
import { wayType } from "@transitmapper/core/model/catalog";
import { facilityRender, gradeFlags, laneRender, modeRender, showWayWhenServed, wayRender } from "../style/catalogStyle";
import { resolveWayPath, serviceLaneOnWay, wayById } from "../model/geo";
import { nearWaysForStations, servicesByWay, visibleWaysFor } from "./featureMemo";
import { directionalLanes, isOneWay, wayCapacity } from "../model/profile";
import { wayIntersectsBounds, wayLaneGeometry } from "../geometry/streets";
import { collectWayTrims, connectorCurves, junctionGeometry, type JunctionGeometry, type WayTrims } from "../geometry/junctions";
import { iconName } from "./iconName";
import type { LngLat, Pattern, Service, TransitSystem } from "../model/system";
import { HANDLE_ICON, widthPxAtZ14 } from "./constants";

/** What the renderer needs to know about the current selection: which single
 *  object is highlighted, if any. Deliberately structural rather than an
 *  import of the editor's own `Selection` union — selection is an editor
 *  concept, and a rendering module in core has no business knowing the full
 *  vocabulary of things the editor can select. The editor's `Selection`
 *  satisfies this shape as-is, so call sites pass it unchanged. */
export type Highlight = { kind: string; id: string } | null;

const NEUTRAL_STATION = "#4b5563";
// A dedicated-guideway/aerial/water way with no service riding it yet reads as
// unassigned infrastructure — a faint dashed placeholder, not its real color.
// Roads and bike ways are real surfaces independent of any service, so they
// always show their actual catalog style, served or not.
const UNASSIGNED_COLOR = "#b9b9b2";
const UNASSIGNED_WIDTH = 2;
const UNASSIGNED_FAMILIES = new Set(["guideway", "aerial", "water"]);
const BUNDLE_SPACING_PX = 5; // perpendicular gap between parallel services (Network schematic bundle)
const LANE_SPACING_PX = 3; // perpendicular gap between a way's own capacity lanes/tracks
const WITHIN_LANE_SPACING_PX = 1.5; // gap between services sharing ONE lane in Infrastructure lane-detail
const SERVICE_LANE_FRACTION = 0.6; // a service overlay fills ~60% of its lane's width (leaves the lane markings visible)

// Continuity-aware bundle offsets. Each service gets ONE constant offset slot
// for its entire path — chosen greedily as the smallest-magnitude slot free on
// EVERY way it rides — so a through-line keeps a single offset end to end (no
// sideways "jog" where a shared stretch begins or ends, which is what made two
// connected lines read as not intersecting) while services sharing a segment
// still fan apart. Slot order 0, +1, -1, +2, -2… keeps a bundle roughly
// centered; a lone service stays at 0 (centered), unchanged from before.
// Deterministic (services processed in byWay's stable creation order) and
// memoized on the byWay Map identity (itself memoized on system.services), so
// selection/viewport rebuilds reuse it.
const bundleSlotCache = new WeakMap<Map<string, Service[]>, Map<string, number>>();
function bundleSlots(byWay: Map<string, Service[]>): Map<string, number> {
  const cached = bundleSlotCache.get(byWay);
  if (cached) return cached;
  const serviceWays = new Map<string, string[]>();
  const order: string[] = []; // stable: each service the first time it appears
  for (const [wayId, svcs] of byWay) {
    for (const s of svcs) {
      let ws = serviceWays.get(s.id);
      if (!ws) {
        ws = [];
        serviceWays.set(s.id, ws);
        order.push(s.id);
      }
      ws.push(wayId);
    }
  }
  const nthSlot = (k: number): number => (k === 0 ? 0 : k % 2 === 1 ? (k + 1) / 2 : -k / 2); // 0,+1,-1,+2,-2,…
  const occupied = new Map<string, Set<number>>();
  const slots = new Map<string, number>();
  for (const sid of order) {
    const ways = serviceWays.get(sid) ?? [];
    let slot = 0;
    for (let k = 0; ; k++) {
      const cand = nthSlot(k);
      if (ways.every((w) => !occupied.get(w)?.has(cand))) {
        slot = cand;
        break;
      }
    }
    slots.set(sid, slot);
    for (const w of ways) {
      let set = occupied.get(w);
      if (!set) {
        set = new Set();
        occupied.set(w, set);
      }
      set.add(slot);
    }
  }
  bundleSlotCache.set(byWay, slots);
  return slots;
}

/** One service's one pattern touching a way, at that pattern's wayIds index —
 *  everything serviceLaneOnWay needs to resolve the lane, pre-indexed by way
 *  so the lane-detail render (below) is O(1) per way instead of re-scanning
 *  every rider service's full pattern list for every way it's ever on. Built
 *  once per system.services (memoized on byWay's identity, same contract as
 *  bundleSlots) — O(total pattern-way entries) regardless of how many ways
 *  are actually in view. */
interface WayPatternEntry {
  svc: Service;
  pattern: Pattern;
  wayIdx: number;
}
const wayPatternIndexCache = new WeakMap<Map<string, Service[]>, Map<string, WayPatternEntry[]>>();
function wayPatternIndex(byWay: Map<string, Service[]>): Map<string, WayPatternEntry[]> {
  const cached = wayPatternIndexCache.get(byWay);
  if (cached) return cached;
  const seen = new Set<string>();
  const index = new Map<string, WayPatternEntry[]>();
  for (const svcs of byWay.values()) {
    for (const svc of svcs) {
      if (seen.has(svc.id)) continue;
      seen.add(svc.id);
      for (const pattern of svc.patterns) {
        pattern.wayIds.forEach((wid, wayIdx) => {
          let arr = index.get(wid);
          if (!arr) index.set(wid, (arr = []));
          arr.push({ svc, pattern, wayIdx });
        });
      }
    }
  }
  wayPatternIndexCache.set(byWay, index);
  return index;
}

export interface SystemFeatures {
  ways: FeatureCollection<LineString>;
  services: FeatureCollection<LineString>;
  stations: FeatureCollection<Point>;
  handles: FeatureCollection<Point>;
  footprints: FeatureCollection<Polygon>;
  platforms: FeatureCollection<Polygon>;
  facilities: FeatureCollection<Point>;
  physicalHandles: FeatureCollection<Point>;
  /** Lane-detail street rendering (Infrastructure view at high zoom only —
   *  see LANE_DETAIL_MIN_ZOOM): lane surfaces, painted markings, direction
   *  arrows. Empty collections otherwise. */
  lanes: FeatureCollection<LineString>;
  laneMarkings: FeatureCollection<LineString>;
  laneArrows: FeatureCollection<LineString>;
  junctions: FeatureCollection<Polygon>;
  connectors: FeatureCollection<LineString>;
  /** Shared-identity (NamedWay) name labels along their member ways. */
  wayLabels: FeatureCollection<LineString>;
}

function closeRing(points: LngLat[]): LngLat[] {
  if (points.length === 0) return points;
  const first = points[0];
  const last = points[points.length - 1];
  return first[0] === last[0] && first[1] === last[1] ? points : [...points, first];
}

export interface ViewOptions {
  /** Network = stylized, service-focused, grade hidden. Infrastructure =
   *  physical, catalog-styled, grade shown (real cross-sections are P2).
   *  Diagram = schematic/octolinear, same physical-detail-hidden behavior as
   *  Network but fed a geometrically transformed system (see
   *  model/diagramLayout.ts) instead of the real one. */
  viewMode: "network" | "infrastructure" | "diagram";
  /** Mode ids currently shown; a service whose mode isn't in this set is hidden. */
  visibleModes: Set<string>;
  /** Way-type ids currently shown; a way whose type isn't in this set is hidden. */
  visibleWayTypes: Set<string>;
  /** True at lane-detail zooms in the Infrastructure view — ways in view
   *  render as real per-lane geometry instead of the offset fan. */
  laneDetail?: boolean;
  /** Current viewport (with margin), so lane geometry only derives for ways
   *  actually on screen. Only consulted when laneDetail is set. */
  bounds?: [LngLat, LngLat];
}

/** Project the system into GeoJSON. Ways carrying multiple services are
 *  emitted as several offset service features so MapLibre draws parallel
 *  colored lines; the infra line itself is styled from the way-type/class
 *  catalog (style/catalogStyle.ts) and hidden under exclusive-use services.
 *  `view` narrows what's drawn (per-mode/per-type filters) and how (Network
 *  shows only clean bundled service lines with grade hidden; Infrastructure
 *  also shows bare/unassigned infrastructure and grade styling). */
export function buildFeatures(
  system: TransitSystem,
  selection: Highlight,
  handleWayIds: string[],
  view: ViewOptions,
  /** The station whose footprint/platform vertices should render as
   *  draggable handles right now (its own edit context, not tied to
   *  `selection` directly since a platform can be mid-edit independently). */
  physicalHandleStationId: string | null = null,
  /** Same, for a group's (facility-complex's) own footprint vertices. */
  physicalHandleGroupId: string | null = null,
): SystemFeatures {
  const selId = selection?.id ?? null;
  // Diagram inherits Network's schematic behavior (grade/footprints/
  // facilities hidden, capacity collapsed to one line) — only Infrastructure
  // wants the physical-planning detail.
  const network = view.viewMode !== "infrastructure";
  // Reuse the WeakMap-cached way-by-id index (keyed on system.ways' identity)
  // instead of rebuilding a Map every call — reused below for the laneDetail
  // junction pass, the wayLabels loop, and the handle-ways loop.
  const waysById = wayById(system.ways);

  // services per way, in stable (creation) order, pre-filtered by visible mode
  // and deduplicated across a service's own patterns (two branches sharing a
  // trunk way still count as ONE service there). Memoized on (services,
  // visibleModes) so a selection/viewport rebuild reuses it — see featureMemo.
  const byWay = servicesByWay(system.services, view.visibleModes);
  // One stable offset slot per service, so a through-line never jogs sideways
  // where it enters/leaves a shared stretch (see bundleSlots).
  const slots = bundleSlots(byWay);

  // A way's own infra line, fanned out into `way.capacity` parallel lanes/
  // tracks in the Infrastructure view — a real physical cross-section instead
  // of one representative line. Network view always collapses to one line
  // (capacity is physical-planning detail, out of place on the schematic map).
  const emitCrossSection = (
    way: TransitSystem["ways"][number],
    path: LngLat[],
    color: string,
    width: number,
    dashed: boolean,
  ) => {
    const lanes = network ? 1 : Math.max(1, wayCapacity(way));
    const laneWidth = lanes > 1 ? Math.max(1.5, width / lanes + 0.75) : width;
    for (let i = 0; i < lanes; i++) {
      ways.push({
        type: "Feature",
        properties: {
          id: way.id,
          color,
          width: laneWidth,
          dashed,
          offset: (i - (lanes - 1) / 2) * LANE_SPACING_PX,
        },
        geometry: { type: "LineString", coordinates: path },
      });
    }
  };

  const ways: Feature<LineString>[] = [];
  const services: Feature<LineString>[] = [];
  const lanes: Feature<LineString>[] = [];
  const laneMarkings: Feature<LineString>[] = [];
  const laneArrows: Feature<LineString>[] = [];

  // True-scale per-lane rendering for one way: lane surfaces at their real
  // metric widths (w14 + the exponential zoom expression in LANE_WIDTH_EXPR),
  // painted dividers, thin-line lanes (tracks), and direction arrows. Replaces
  // the emitCrossSection fan for that way at lane-detail zooms.
  const emitLaneDetail = (way: TransitSystem["ways"][number]) => {
    // wayTrims is populated by the junction pass below before any call here.
    const trims = wayTrims.get(way.id) ?? { start: 0, end: 0 };
    const g = wayLaneGeometry(way, trims.start, trims.end);
    const lat = way.points[0]?.[1] ?? 36;
    for (const lane of g.lanes) {
      const r = laneRender(lane.kindId);
      if (r.surface) {
        lanes.push({
          type: "Feature",
          properties: { id: way.id, kindId: lane.kindId, color: r.color, w14: widthPxAtZ14(lane.widthM, lat) },
          geometry: { type: "LineString", coordinates: lane.path },
        });
      } else {
        laneMarkings.push({
          type: "Feature",
          properties: { kind: "thinLane", color: r.color },
          geometry: { type: "LineString", coordinates: lane.path },
        });
      }
    }
    for (const d of g.dividers) {
      laneMarkings.push({ type: "Feature", properties: { kind: d.kind }, geometry: { type: "LineString", coordinates: d.path } });
    }
    for (const a of g.arrows) {
      laneArrows.push({ type: "Feature", properties: { id: way.id }, geometry: { type: "LineString", coordinates: a.path } });
    }
    // A lane-rendered way has no fan feature to carry its selection halo, so
    // emit one centerline stand-in per lane-detailed way. It's invisible unless
    // selected: LYR_WAY_SELECTED is driven by feature-state (set on selection in
    // MapCanvas), and LYR_WAYS_SOLID/DASHED filter haloOnly out. Emitted
    // unconditionally (not only when selected) so the selection fast path can
    // light it via feature-state without a full rebuild.
    ways.push({
      type: "Feature",
      properties: { id: way.id, color: "#191a17", width: 10, dashed: false, offset: 0, haloOnly: true },
      geometry: { type: "LineString", coordinates: resolveWayPath(way) },
    });
  };

  // A way renders at lane detail when we're zoomed in enough (view.laneDetail),
  // it's on screen, and it isn't a tunnel (underground stays a dashed fan —
  // drawing asphalt for a bored tube would misread).
  const wantsLaneDetail = (way: TransitSystem["ways"][number]) =>
    !network &&
    view.laneDetail === true &&
    way.grade !== "underground" &&
    way.profile.lanes.length > 0 &&
    (!view.bounds || wayIntersectsBounds(way, view.bounds));

  // Junctions among lane-detailed ways: real footprint polygons whose trim
  // distances pull every arm's lane geometry back so carriageways stop at
  // the junction edge instead of overlapping through it (stage 2 feeding
  // stage 1 — see geometry/junctions.ts). Connector curves are the per-lane
  // turn guides through each footprint.
  const junctionFeatures: Feature<Polygon>[] = [];
  const connectorFeatures: Feature<LineString>[] = [];
  let wayTrims: WayTrims = new Map();
  if (!network && view.laneDetail === true) {
    const laneNodes: { node: TransitSystem["nodes"][number]; g: JunctionGeometry }[] = [];
    for (const node of system.nodes) {
      const relevant = node.refs.some((r) => {
        const w = waysById.get(r.wayId);
        return !!w && wantsLaneDetail(w);
      });
      if (!relevant) continue;
      const g = junctionGeometry(node, waysById);
      if (!g) continue;
      laneNodes.push({ node, g });
    }
    wayTrims = collectWayTrims(laneNodes.map((x) => x.g));
    for (const { node, g } of laneNodes) {
      if (g.polygon.length >= 3) {
        junctionFeatures.push({
          type: "Feature",
          properties: { nodeId: node.id, selected: selection?.kind === "node" && selId === node.id },
          geometry: { type: "Polygon", coordinates: [closeRing(g.polygon)] },
        });
      }
      // Per-lane turn guides are editing detail for ONE junction. Emitting them
      // for every junction turns a complex interchange (dense OSM import) into a
      // star-burst of dozens of lane-to-lane connectors converging on each node
      // — so only draw them for the SELECTED node. The junction footprint +
      // carriageway trims above still render for every junction (that's the
      // paved road surface, not clutter).
      if (selection?.kind === "node" && selId === node.id) {
        for (const c of connectorCurves(node, waysById, wayTrims, system.turnRestrictions)) {
          connectorFeatures.push({
            type: "Feature",
            properties: { nodeId: node.id },
            geometry: { type: "LineString", coordinates: c.path },
          });
        }
      }
    }
  }

  for (const way of system.ways) {
    if (!view.visibleWayTypes.has(way.typeId)) continue;
    const path = resolveWayPath(way);
    if (path.length < 2) continue;
    const bundle = byWay.get(way.id) ?? [];
    const base = wayRender(way.typeId, way.classId);
    const laneDetail = wantsLaneDetail(way);

    if (bundle.length === 0) {
      // Network view is service-focused — bare/unassigned infrastructure with
      // no rider only makes sense as physical-planning context (Infrastructure).
      if (network) continue;
      if (laneDetail) {
        emitLaneDetail(way);
        continue;
      }
      const unassigned = UNASSIGNED_FAMILIES.has(wayType(way.typeId).family);
      emitCrossSection(
        way,
        path,
        unassigned ? UNASSIGNED_COLOR : base.color,
        unassigned ? UNASSIGNED_WIDTH : base.width,
        unassigned ? true : !!base.dashed,
      );
      continue;
    }

    if (laneDetail) {
      emitLaneDetail(way);
    } else if (!network && showWayWhenServed(way.typeId)) {
      emitCrossSection(way, path, base.color, base.width, !!base.dashed);
    }

    // One-way infrastructure reads as one-way in the SCHEMATIC too:
    // chevrons along the served line, pointing with travel — otherwise
    // Network view silently hides direction, and a one-way couplet looks
    // like two ordinary parallel lines.
    if (network && isOneWay(way.profile)) {
      const backward = directionalLanes(way.profile).every((l) => l.direction === "backward");
      laneArrows.push({
        type: "Feature",
        properties: { id: way.id },
        geometry: { type: "LineString", coordinates: backward ? [...path].reverse() : path },
      });
    }

    // Network view is the clean schematic map — grade (tunnel/viaduct styling)
    // is physical-alignment detail that belongs to the Infrastructure view.
    const { underground, elevated } = network ? { underground: false, elevated: false } : gradeFlags(way.grade);
    const svcFeature = (svc: Service, coords: LngLat[], offset: number, w14?: number): Feature<LineString> => ({
      type: "Feature",
      // w14 present ⇒ a lane-detail overlay: the service layer grows it with
      // zoom, clamped to a sensible min/max (SERVICE_WIDTH_EXPR); absent ⇒ the
      // schematic fixed `width` is used (Network view).
      properties: { serviceId: svc.id, wayId: way.id, color: svc.color, width: modeRender(svc.modeId).width, underground, elevated, offset, ...(w14 !== undefined ? { w14 } : {}) },
      geometry: { type: "LineString", coordinates: coords },
    });
    // Constant per-service offset on the CENTERLINE — no jog at shared-segment
    // boundaries (see bundleSlots). This is the Network schematic and the
    // lane-detail fallback when a lane can't be resolved.
    const centerlineFeature = (svc: Service) => svcFeature(svc, path, (slots.get(svc.id) ?? 0) * BUNDLE_SPACING_PX);

    if (laneDetail) {
      // INFRASTRUCTURE lane detail: draw each service on the ACTUAL lane it
      // uses — the curb lane for its travel direction, or its track — instead
      // of the schematic centerline. wayLaneGeometry is memoized on the same
      // trims emitLaneDetail already computed above, so this is a cache hit.
      const trims = wayTrims.get(way.id) ?? { start: 0, end: 0 };
      const laneById = new Map(wayLaneGeometry(way, trims.start, trims.end).lanes.map((l) => [l.laneId, l] as const));
      const lat = way.points[0]?.[1] ?? 36;
      // Which lane(s) each service rides here — it may traverse the way in more
      // than one pattern/direction (both curbs). Group services by lane so
      // services sharing a lane can fan slightly instead of overprinting.
      // wayPatternIndex is pre-built once for the whole system — O(1) here,
      // not a re-scan of every rider's full pattern list per way.
      const byLane = new Map<string, Service[]>();
      const resolved = new Set<string>();
      for (const { svc, pattern, wayIdx } of wayPatternIndex(byWay).get(way.id) ?? []) {
        const laneId = serviceLaneOnWay(pattern, wayIdx, waysById, svc.modeId);
        if (!laneId || !laneById.has(laneId)) continue;
        resolved.add(svc.id);
        let arr = byLane.get(laneId);
        if (!arr) byLane.set(laneId, (arr = []));
        // A service can land on the SAME lane via two of its own patterns
        // (rare) — don't double-emit it there.
        if (!arr.some((s) => s.id === svc.id)) arr.push(svc);
      }
      // A bundle rider with no lane resolved anywhere on this way (a lane-less
      // profile) falls back to the centerline.
      bundle.forEach((svc) => {
        if (!resolved.has(svc.id)) services.push(centerlineFeature(svc));
      });
      for (const [laneId, svcs] of byLane) {
        const lane = laneById.get(laneId)!;
        // w14 = the lane's overlay half-width in z14 px; today it only FLAGS a
        // lane-detail overlay (the layer's zoom-clamped SERVICE_WIDTH_EXPR draws
        // the band), but it carries the metric so a per-lane width can use it later.
        const w14 = widthPxAtZ14(lane.widthM * SERVICE_LANE_FRACTION, lat);
        const n = svcs.length; // lone service sits dead-centre on its lane
        svcs.forEach((svc, i) => services.push(svcFeature(svc, lane.path, (i - (n - 1) / 2) * WITHIN_LANE_SPACING_PX, w14)));
      }
    } else {
      bundle.forEach((svc) => services.push(centerlineFeature(svc)));
    }
  }

  const visibleWays = visibleWaysFor(system.ways, view.visibleWayTypes);
  // The interchange scan (servedWayIds per station) is the single most expensive
  // part of this function at RTC scale — memoized on (stations, visibleWays) so a
  // selection/viewport rebuild reuses it instead of re-scanning ~3787 stations.
  const nearWaysByStation = nearWaysForStations(system.stations, visibleWays);
  const stations: Feature<Point>[] = system.stations.map((s, si) => {
    // `byWay` already maps a way to the (visible-mode) services riding it —
    // reuse it here instead of re-deriving each service's way ids per station.
    const nearWays = nearWaysByStation[si];
    const servingServiceSet = new Set<Service>();
    for (const wid of nearWays) for (const sv of byWay.get(wid) ?? []) servingServiceSet.add(sv);
    const servingServices = [...servingServiceSet];
    const anchorServices = s.anchor ? (byWay.get(s.anchor.wayId) ?? []) : [];
    const color = anchorServices[0]?.color ?? servingServices[0]?.color ?? NEUTRAL_STATION;
    const interchange = servingServices.length > 1;
    return {
      type: "Feature",
      properties: {
        id: s.id,
        color,
        interchange,
        // Label tier: interchanges (derived) and hand-flagged major stops label
        // from a lower zoom than ordinary stops (see LYR_STATION_LABELS_MAJOR /
        // LYR_STATION_LABELS in layerSpecs.ts). Keeps overview zooms from
        // resolving collisions over all ~3787 labels at once.
        major: interchange || s.majorStop === true,
        name: s.name ?? "",
      },
      geometry: { type: "Point", coordinates: s.coord },
    };
  });

  // A way's first/last control point is marked `endpoint` — it renders and
  // behaves differently from an interior reshape handle (see LYR_WAY_ENDPOINTS):
  // dragging it extends the way with a new point instead of moving it in place.
  const handles: Feature<Point>[] = [];
  for (const wid of handleWayIds) {
    const way = waysById.get(wid);
    way?.points.forEach((p, i) => {
      const endpoint = i === 0 || i === way.points.length - 1;
      handles.push({ type: "Feature", properties: { wayId: wid, index: i, endpoint, icon: HANDLE_ICON }, geometry: { type: "Point", coordinates: p } });
    });
  }

  // Physical planning detail (footprints, platforms, facilities) belongs to
  // the Infrastructure view — Network stays the clean schematic map.
  const footprints: Feature<Polygon>[] = [];
  const platforms: Feature<Polygon>[] = [];
  const physicalHandles: Feature<Point>[] = [];
  if (!network) {
    for (const st of system.stations) {
      if (st.footprint) {
        footprints.push({
          type: "Feature",
          properties: { stationId: st.id },
          geometry: { type: "Polygon", coordinates: [closeRing(st.footprint)] },
        });
      }
      for (const pf of st.platforms ?? []) {
        platforms.push({
          type: "Feature",
          properties: { stationId: st.id, platformId: pf.id },
          geometry: { type: "Polygon", coordinates: [closeRing(pf.points)] },
        });
      }
      if (st.id === physicalHandleStationId) {
        st.footprint?.forEach((p, i) => {
          physicalHandles.push({ type: "Feature", properties: { kind: "footprint", stationId: st.id, index: i, icon: HANDLE_ICON }, geometry: { type: "Point", coordinates: p } });
        });
        for (const pf of st.platforms ?? []) {
          pf.points.forEach((p, i) => {
            physicalHandles.push({
              type: "Feature",
              properties: { kind: "platform", stationId: st.id, platformId: pf.id, index: i, icon: HANDLE_ICON },
              geometry: { type: "Point", coordinates: p },
            });
          });
        }
      }
    }

    // Group footprints (facility complexes) share the same footprint
    // fill/stroke/handle rendering as a station's, except a complex carries
    // its own color (so several complexes on one map stay visually distinct)
    // — falls back to the shared default style when absent.
    for (const g of system.groups) {
      if (g.footprint) {
        footprints.push({
          type: "Feature",
          properties: { groupId: g.id, ...(g.color ? { color: g.color } : {}) },
          geometry: { type: "Polygon", coordinates: [closeRing(g.footprint)] },
        });
      }
      if (g.id === physicalHandleGroupId) {
        g.footprint?.forEach((p, i) => {
          physicalHandles.push({
            type: "Feature",
            properties: { kind: "groupFootprint", groupId: g.id, index: i, icon: HANDLE_ICON },
            geometry: { type: "Point", coordinates: p },
          });
        });
      }
    }
  }

  // NamedWay (street/line/trail) name labels along every member way — the
  // shared identity reads as ONE named street across junction-split segments
  // and separated carriageways. Infrastructure view only, like all physical
  // naming detail; MapLibre's own collision keeps repeats sparse.
  const wayLabels: Feature<LineString>[] = [];
  if (!network) {
    for (const nw of system.namedWays) {
      if (!nw.name) continue;
      for (const wid of nw.wayIds) {
        const w = waysById.get(wid);
        if (!w || !view.visibleWayTypes.has(w.typeId)) continue;
        const path = resolveWayPath(w);
        if (path.length < 2) continue;
        wayLabels.push({ type: "Feature", properties: { name: nw.name }, geometry: { type: "LineString", coordinates: path } });
      }
    }
  }

  const facilities: Feature<Point>[] = network
    ? []
    : system.facilities.map((f) => {
        const r = facilityRender(f.typeId);
        const coord: LngLat = Array.isArray(f.geometry[0]) ? (f.geometry as LngLat[])[0] : (f.geometry as LngLat);
        return {
          type: "Feature",
          properties: {
            id: f.id,
            typeId: f.typeId,
            color: r.color,
            radius: r.radius,
            icon: iconName(r.icon, r.color),
            name: f.name ?? "",
          },
          geometry: { type: "Point", coordinates: coord },
        };
      });

  return {
    ways: { type: "FeatureCollection", features: ways },
    services: { type: "FeatureCollection", features: services },
    stations: { type: "FeatureCollection", features: stations },
    footprints: { type: "FeatureCollection", features: footprints },
    platforms: { type: "FeatureCollection", features: platforms },
    facilities: { type: "FeatureCollection", features: facilities },
    physicalHandles: { type: "FeatureCollection", features: physicalHandles },
    handles: { type: "FeatureCollection", features: handles },
    lanes: { type: "FeatureCollection", features: lanes },
    laneMarkings: { type: "FeatureCollection", features: laneMarkings },
    laneArrows: { type: "FeatureCollection", features: laneArrows },
    junctions: { type: "FeatureCollection", features: junctionFeatures },
    connectors: { type: "FeatureCollection", features: connectorFeatures },
    wayLabels: { type: "FeatureCollection", features: wayLabels },
  };
}
