import type { FeatureCollection, Feature, LineString, Point, Polygon } from 'geojson';
import { wayType } from '@transitmapper/core/model/catalog';
import {
  facilityRender,
  gradeFlags,
  laneRender,
  modeRender,
  showWayWhenServed,
  wayRender,
} from '../style/catalogStyle';
import {
  nearestOnPath,
  legRange,
  pathLengthMeters,
  resolveWayPath,
  serviceCoversWayAt,
  serviceHasPartialLeg,
  PATTERN_RUNS,
  patternRunLegs,
  serviceLaneOnWay,
  serviceRangesOnWay,
  slicePathByT,
  pointAtT,
  wayById,
  patternRunSegments,
} from '../model/geo';
import { nearWaysForStops, servicesByWay, visibleWaysFor } from './featureMemo';
import { nodesForWays, waysInBoundsFor } from './way-bounds-index';
import {
  importedCenterlineFeature,
  isOsmImportedWay,
  shouldProjectWayLabel,
  showsTopologyWay,
} from './infrastructure-detail';
import { mergeAdjacentServiceLines } from './mergeServiceLines';
import { directionalLanes, isOneWay, wayCapacity } from '../model/profile';
import { wayIntersectsBounds, wayLaneGeometry } from '../geometry/streets';
import {
  collectWayTrims,
  connectorCurves,
  junctionGeometry,
  type JunctionGeometry,
  type WayTrims,
} from '../geometry/junctions';
import { iconName } from './iconName';
import type {
  PatternLeg,
  RunDirection,
  Way,
  LngLat,
  Pattern,
  Service,
  TransitSystem,
} from '../model/system';
import { HANDLE_ICON, widthPxAtZ14 } from './constants';
import { lineForService, linesByServiceId, servicePattern } from '../model/line-service';

/** What the renderer needs to know about the current selection: which single
 *  object is highlighted, if any. Deliberately structural rather than an
 *  import of the editor's own `Selection` union — selection is an editor
 *  concept, and a rendering module in core has no business knowing the full
 *  vocabulary of things the editor can select. The editor's `Selection`
 *  satisfies this shape as-is, so call sites pass it unchanged. */
export type Highlight = { kind: string; id: string } | null;

const NEUTRAL_STATION = '#4b5563';
// A dedicated-guideway/aerial/water way with no service riding it yet reads as
// unassigned infrastructure — a faint dashed placeholder, not its real color.
// Roads and bike ways are real surfaces independent of any service, so they
// always show their actual catalog style, served or not.
const UNASSIGNED_COLOR = '#b9b9b2';
const UNASSIGNED_WIDTH = 2;
const UNASSIGNED_FAMILIES = new Set(['guideway', 'aerial', 'water']);
const BUNDLE_SPACING_PX = 5; // perpendicular gap between parallel services (Network schematic bundle)
const LANE_SPACING_PX = 3; // perpendicular gap between a way's own capacity lanes/tracks
const WITHIN_LANE_SPACING_PX = 1.5; // gap between services sharing ONE lane in Infrastructure lane-detail
const SERVICE_LANE_FRACTION = 0.6; // a service overlay fills ~60% of its lane's width (leaves the lane markings visible)

function serviceColor(system: TransitSystem, service: Service): string {
  return lineForService(system, service.id)?.color ?? UNASSIGNED_COLOR;
}

// Continuity-aware bundle offsets. Each public Line gets ONE constant offset
// slot across the union of its Services — chosen greedily as the
// smallest-magnitude slot free on EVERY way it rides — so a Line keeps a
// single offset end to end (no
// sideways "jog" where a shared stretch begins or ends, which is what made two
// connected lines read as not intersecting) while services sharing a segment
// still fan apart. Slot order 0, +1, -1, +2, -2… keeps a bundle roughly
// centered; a lone service stays at 0 (centered), unchanged from before.
// Deterministic (services processed in byWay's stable creation order) and
// memoized on both route geometry and Line membership identity.
const bundleSlotCache = new WeakMap<
  Map<string, Service[]>,
  WeakMap<TransitSystem['lines'], Map<string, number>>
>();
function bundleSlots(
  byWay: Map<string, Service[]>,
  lines: TransitSystem['lines'],
): Map<string, number> {
  let byLines = bundleSlotCache.get(byWay);
  if (!byLines) {
    byLines = new WeakMap();
    bundleSlotCache.set(byWay, byLines);
  }
  const cached = byLines.get(lines);
  if (cached) return cached;
  const ownership = linesByServiceId(lines);
  const entityWays = new Map<string, Set<string>>();
  const servicesByEntity = new Map<string, string[]>();
  const order: string[] = [];
  for (const [wayId, svcs] of byWay) {
    for (const s of svcs) {
      const entityId = ownership.get(s.id)?.id ?? `service:${s.id}`;
      let ways = entityWays.get(entityId);
      if (!ways) {
        ways = new Set();
        entityWays.set(entityId, ways);
        order.push(entityId);
      }
      ways.add(wayId);
      const serviceIds = servicesByEntity.get(entityId) ?? [];
      if (!serviceIds.includes(s.id)) serviceIds.push(s.id);
      servicesByEntity.set(entityId, serviceIds);
    }
  }
  const nthSlot = (k: number): number => (k === 0 ? 0 : k % 2 === 1 ? (k + 1) / 2 : -k / 2); // 0,+1,-1,+2,-2,…
  const occupied = new Map<string, Set<number>>();
  const slots = new Map<string, number>();
  for (const entityId of order) {
    const ways = [...(entityWays.get(entityId) ?? [])];
    let slot: number;
    for (let k = 0; ; k++) {
      const cand = nthSlot(k);
      if (ways.every((w) => !occupied.get(w)?.has(cand))) {
        slot = cand;
        break;
      }
    }
    for (const serviceId of servicesByEntity.get(entityId) ?? []) slots.set(serviceId, slot);
    for (const w of ways) {
      let set = occupied.get(w);
      if (!set) {
        set = new Set();
        occupied.set(w, set);
      }
      set.add(slot);
    }
  }
  byLines.set(lines, slots);
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
  /** The way this leg leads on to in ride order, if any — what the turn out
   *  of this junction is, and so which lanes may legally be in. */
  nextWayId?: string;
  /** RIDE direction for the one direction of service this entry stands for.
   *  One entry per (leg × direction that rides it): a leg both directions
   *  share yields two, with opposite `forward`, which is how a two-way service
   *  claims both curbs. A leg only one direction rides yields one. */
  forward: boolean;
}

/** One rendered pass through a way. A transparent hit feature keeps this
 * identity for editing while the painted line can still merge through bends. */
interface ServiceWayOccurrence {
  patternId: string;
  run: RunDirection;
  legIndex: number;
  range: [number, number];
  /** Shared sections present the same leg object in both runs; one visual
   * feature is enough because editing either occurrence changes both. */
  leg: PatternLeg;
}

function serviceWayOccurrences(service: Service, wayId: string): ServiceWayOccurrence[] {
  const occurrences: ServiceWayOccurrence[] = [];
  const pattern = servicePattern(service);
  for (const run of PATTERN_RUNS) {
    patternRunLegs(pattern, run).forEach(({ leg }, legIndex) => {
      if (leg.wayId !== wayId) return;
      occurrences.push({ patternId: pattern.id, run, legIndex, range: legRange(leg), leg });
    });
  }
  return occurrences;
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
      const pattern = servicePattern(svc);
      // Walked per direction rather than over the flat leg list, so the
      // entries say which lanes are ACTUALLY ridden. The list used to be
      // walked once and each leg drawn on both curbs, which is right for a
      // two-way street and wrong for a one-way couplet — it would paint the
      // outward street's return curb with a line no vehicle ever runs on.
      for (const run of PATTERN_RUNS) {
        const ordered = patternRunLegs(pattern, run);
        ordered.forEach(({ leg, index: wayIdx, forward }, i) => {
          let arr = index.get(leg.wayId);
          if (!arr) index.set(leg.wayId, (arr = []));
          const next = ordered[i + 1]?.leg.wayId;
          arr.push({ svc, pattern, wayIdx, forward, ...(next ? { nextWayId: next } : {}) });
        });
      }
    }
  }
  wayPatternIndexCache.set(byWay, index);
  return index;
}

/**
 * The stretches of `wayId` that some service rides in one direction only, each
 * already oriented the way that service travels it.
 *
 * "One direction only" is a property of the LINE, not the street: a couplet
 * drawn along two ordinary two-way streets has each half ridden one way, and a
 * planner looking at the schematic has nothing else to tell them which. A leg
 * both directions share yields nothing here, because an arrow on it would be
 * a lie in one of the two directions.
 *
 * Deduplicated by geometry start/end so repeated legs of one Service on the
 * same one-directional stretch do not stack arrows.
 */
function oneDirectionalStretches(
  system: TransitSystem,
  waysById: Map<string, Way>,
  services: Service[],
  wayId: string,
): { path: LngLat[]; color: string }[] {
  const out: { path: LngLat[]; color: string }[] = [];
  const seen = new Set<string>();
  for (const svc of services) {
    const pattern = servicePattern(svc);
    // Which stretches this pattern rides BOTH ways, whatever sections they
    // sit in. An arrow means "one-way as far as this line is concerned", so
    // a stretch the line also comes back along must not get one — and after
    // a couplet's two streets are merged into one, the split section's two
    // sides land on that one street and would otherwise draw opposing
    // chevrons on it. Asked of the resolved runs rather than of the section
    // kinds, so it holds however the sections got that way.
    const ridden = new Map<string, number>();
    for (const run of PATTERN_RUNS) {
      for (const { leg } of patternRunLegs(pattern, run)) {
        ridden.set(leg.wayId, (ridden.get(leg.wayId) ?? 0) | (run === 'outbound' ? 1 : 2));
      }
    }
    const bothWays = (wayIdOn: string) => ridden.get(wayIdOn) === 3;
    if (bothWays(wayId)) continue;
    for (const section of pattern.sections) {
      if (section.kind === 'shared') continue;
      const sides: { legs: PatternLeg[]; run: RunDirection }[] =
        section.kind === 'split'
          ? [
              { legs: section.outbound, run: 'outbound' },
              { legs: section.inbound, run: 'inbound' },
            ]
          : [{ legs: section.legs, run: 'outbound' }];
      for (const side of sides) {
        const wanted = new Set(side.legs.filter((l) => l.wayId === wayId));
        if (wanted.size === 0) continue;
        for (const seg of patternRunSegments(waysById, pattern, side.run)) {
          if (!wanted.has(seg.leg) || seg.path.length < 2) continue;
          const key = `${seg.path[0].join()}>${seg.path[seg.path.length - 1].join()}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ path: seg.path, color: serviceColor(system, svc) });
        }
      }
    }
  }
  return out;
}

export interface SystemFeatures {
  ways: FeatureCollection<LineString>;
  services: FeatureCollection<LineString>;
  stops: FeatureCollection<Point>;
  handles: FeatureCollection<Point>;
  /** Route-owned ends, intentionally distinct from physical corridor controls. */
  serviceTermini: FeatureCollection<Point>;
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
  /** Travel arrows for stretches only ONE direction of a Service rides.
   *  Carries the public Line colour, because these sit on top of the line
   *  rather than on the asphalt beneath it. */
  serviceArrows: FeatureCollection<LineString>;
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

/** Draggable control points for the ways currently showing handles.
 *
 *  Split out of buildFeatures because it is the ONLY thing (with
 *  buildPhysicalHandles) that a selection change actually alters. Selecting an
 *  object used to run the entire fourteen-collection build — allocating a
 *  feature and a Set for all ~3,787 stops at RTC scale — and then throw
 *  twelve of the collections away. Its inputs are exactly its parameters, so a
 *  caller can drive it directly and pay only for what changed.
 *
 *  A way's first/last control point is marked `endpoint`: it renders and
 *  behaves differently from an interior reshape handle (see LYR_WAY_ENDPOINTS)
 *  — dragging it extends the way with a new point instead of moving it. */
export function buildHandles(
  waysById: Map<string, TransitSystem['ways'][number]>,
  handleWayIds: string[],
): Feature<Point>[] {
  const handles: Feature<Point>[] = [];
  for (const wid of handleWayIds) {
    const way = waysById.get(wid);
    way?.points.forEach((p, i) => {
      const endpoint = i === 0 || i === way.points.length - 1;
      handles.push({
        type: 'Feature',
        properties: { wayId: wid, index: i, endpoint, icon: HANDLE_ICON },
        geometry: { type: 'Point', coordinates: p },
      });
    });
  }
  return handles;
}

/** Footprint/platform vertices of the one Station and/or group being edited.
 *
 *  Takes the RESOLVED records rather than their ids on purpose: a footprint
 *  drag changes the geometry while the id stays put, so anything keyed on the
 *  id alone would serve a stale shape — the exact failure a memo layer must not
 *  have. Resolving also makes this O(1) in the number of Stations, where the
 *  inline version scanned every Station to find the one match. */
export function buildPhysicalHandles(
  station: TransitSystem['stations'][number] | null | undefined,
  group: TransitSystem['groups'][number] | null | undefined,
): Feature<Point>[] {
  const physicalHandles: Feature<Point>[] = [];
  if (station) {
    station.footprint?.forEach((p, i) => {
      physicalHandles.push({
        type: 'Feature',
        properties: { kind: 'footprint', stationId: station.id, index: i, icon: HANDLE_ICON },
        geometry: { type: 'Point', coordinates: p },
      });
    });
    for (const pf of station.platforms ?? []) {
      pf.points.forEach((p, i) => {
        physicalHandles.push({
          type: 'Feature',
          properties: {
            kind: 'platform',
            stationId: station.id,
            platformId: pf.id,
            index: i,
            icon: HANDLE_ICON,
          },
          geometry: { type: 'Point', coordinates: p },
        });
      });
    }
  }
  if (group) {
    group.footprint?.forEach((p, i) => {
      physicalHandles.push({
        type: 'Feature',
        properties: { kind: 'groupFootprint', groupId: group.id, index: i, icon: HANDLE_ICON },
        geometry: { type: 'Point', coordinates: p },
      });
    });
  }
  return physicalHandles;
}

export interface ViewOptions {
  /** Network = stylized, service-focused, grade hidden. Infrastructure =
   *  physical, catalog-styled, grade shown (real cross-sections are P2).
   *  Diagram = schematic/octolinear, same physical-detail-hidden behavior as
   *  Network but fed a geometrically transformed system (see
   *  model/diagramLayout.ts) instead of the real one. */
  viewMode: 'network' | 'infrastructure' | 'diagram';
  /** Mode ids currently shown; a service whose mode isn't in this set is hidden. */
  visibleModes: Set<string>;
  /** Way-type ids currently shown; a way whose type isn't in this set is hidden. */
  visibleWayTypes: Set<string>;
  /** True at lane-detail zooms in the Infrastructure view — ways in view
   *  render as real per-lane geometry instead of the offset fan. */
  laneDetail?: boolean;
  /** Live map zoom used for semantic imported-infrastructure detail. */
  zoom?: number;
  /** Current viewport (with margin), so lane geometry only derives for ways
   *  actually on screen. Only consulted when laneDetail is set. */
  bounds?: [LngLat, LngLat];
}

export type SystemFeatureName = keyof SystemFeatures;

/** Deterministic attribution for the live map's projection work.
 *
 * These counters deliberately measure visits and phase entry rather than wall
 * time. They stay stable across machines, make partial-build regressions
 * testable, and can be sampled by the performance harness without adding a
 * second instrumented renderer. */
export interface FeatureBuildOperationCounts {
  featureCollectionBuildCount: number;
  featureTopologyPassCount: number;
  featureTopologyWayVisitCount: number;
  featureJunctionPassCount: number;
  featureJunctionNodeVisitCount: number;
  featureStopPassCount: number;
  featureStopVisitCount: number;
  featureHandlePassCount: number;
  featureHandleWayVisitCount: number;
  featurePhysicalPassCount: number;
  featurePhysicalStopVisitCount: number;
  featurePhysicalGroupVisitCount: number;
  featureFacilityPassCount: number;
  featureFacilityVisitCount: number;
  featureWayLabelPassCount: number;
  featureNamedWayVisitCount: number;
  featureLaneGeometryBuildCount: number;
}

export interface BuildFeaturesOptions {
  /** Omitted for exports, previews, and initial/style/view builds. The live
   * editor passes the exact collections whose MapLibre sources will upload,
   * so unrelated RTC-scale phases are never traversed just to discard them. */
  requestedFeatures?: readonly SystemFeatureName[];
  /** Restrict stop feature derivation to these stable ids. Live gesture
   * settlement uses this to avoid allocating and resolving service context
   * for every unchanged stop. */
  stopIds?: readonly string[];
  counts?: FeatureBuildOperationCounts;
  /** The branch that alone receives interaction at coincident termini. */
  activePatternId?: string | null;
  /** Exact endpoint armed for a one-way return gesture. Rendering reads this
   * ephemeral editor value only to distinguish that handle; it is never
   * written into the TransitSystem. */
  armedTerminus?: {
    serviceId: string;
    patternId: string;
    side: 'start' | 'end';
  } | null;
}

export function createFeatureBuildOperationCounts(): FeatureBuildOperationCounts {
  return {
    featureCollectionBuildCount: 0,
    featureTopologyPassCount: 0,
    featureTopologyWayVisitCount: 0,
    featureJunctionPassCount: 0,
    featureJunctionNodeVisitCount: 0,
    featureStopPassCount: 0,
    featureStopVisitCount: 0,
    featureHandlePassCount: 0,
    featureHandleWayVisitCount: 0,
    featurePhysicalPassCount: 0,
    featurePhysicalStopVisitCount: 0,
    featurePhysicalGroupVisitCount: 0,
    featureFacilityPassCount: 0,
    featureFacilityVisitCount: 0,
    featureWayLabelPassCount: 0,
    featureNamedWayVisitCount: 0,
    featureLaneGeometryBuildCount: 0,
  };
}

const SYSTEM_FEATURE_NAMES: readonly SystemFeatureName[] = [
  'ways',
  'services',
  'stops',
  'handles',
  'serviceTermini',
  'footprints',
  'platforms',
  'facilities',
  'physicalHandles',
  'lanes',
  'laneMarkings',
  'laneArrows',
  'serviceArrows',
  'junctions',
  'connectors',
  'wayLabels',
];

interface TopologyProjection {
  /** At least one way-derived collection is requested. */
  enabled: boolean;
  /** Lane geometry is needed for one of the requested topology collections. */
  needsLaneGeometry: boolean;
  ways: boolean;
  services: boolean;
  lanes: boolean;
  laneMarkings: boolean;
  laneArrows: boolean;
  serviceArrows: boolean;
}

interface JunctionProjection {
  /** Junction geometry is required either as output or to trim lane-detail ways. */
  needsGeometry: boolean;
  polygons: boolean;
  connectors: boolean;
}

interface PhysicalProjection {
  enabled: boolean;
  footprints: boolean;
  platforms: boolean;
  handles: boolean;
}

/** The requested collections grouped by the passes that can produce them.
 *
 * Keeping dependency decisions here makes the renderer read as a sequence of
 * named passes. A caller asking for one source should not force every pass to
 * rediscover which shared indexes or lane geometry that source needs. */
interface FeatureProjectionPlan {
  collectionCount: number;
  topology: TopologyProjection;
  junctions: JunctionProjection;
  stops: boolean;
  selectionHandles: boolean;
  serviceTermini: boolean;
  physical: PhysicalProjection;
  facilities: boolean;
  wayLabels: boolean;
  dependencies: {
    wayIndex: boolean;
    serviceIndex: boolean;
  };
  topologyPassEnabled: boolean;
}

function createFeatureProjectionPlan(
  requestedFeatures: readonly SystemFeatureName[] | undefined,
): FeatureProjectionPlan {
  const requested = requestedFeatures ? new Set<SystemFeatureName>(requestedFeatures) : null;
  const includes = (name: SystemFeatureName): boolean => requested === null || requested.has(name);

  const topologyOutputs = {
    ways: includes('ways'),
    services: includes('services'),
    lanes: includes('lanes'),
    laneMarkings: includes('laneMarkings'),
    laneArrows: includes('laneArrows'),
    serviceArrows: includes('serviceArrows'),
  };
  const topology: TopologyProjection = {
    ...topologyOutputs,
    enabled: Object.values(topologyOutputs).some(Boolean),
    needsLaneGeometry:
      topologyOutputs.ways ||
      topologyOutputs.services ||
      topologyOutputs.lanes ||
      topologyOutputs.laneMarkings ||
      topologyOutputs.laneArrows,
  };
  const junctionOutputs = {
    polygons: includes('junctions'),
    connectors: includes('connectors'),
  };
  const junctions: JunctionProjection = {
    ...junctionOutputs,
    needsGeometry:
      topology.needsLaneGeometry || junctionOutputs.polygons || junctionOutputs.connectors,
  };
  const physicalOutputs = {
    footprints: includes('footprints'),
    platforms: includes('platforms'),
    handles: includes('physicalHandles'),
  };
  const physical: PhysicalProjection = {
    ...physicalOutputs,
    enabled: Object.values(physicalOutputs).some(Boolean),
  };
  const stops = includes('stops');
  const selectionHandles = includes('handles');
  const serviceTermini = includes('serviceTermini');
  const facilities = includes('facilities');
  const wayLabels = includes('wayLabels');
  const topologyPassEnabled =
    topology.enabled || junctionOutputs.polygons || junctionOutputs.connectors;

  return {
    collectionCount: requested?.size ?? SYSTEM_FEATURE_NAMES.length,
    topology,
    junctions,
    stops,
    selectionHandles,
    serviceTermini,
    physical,
    facilities,
    wayLabels,
    dependencies: {
      wayIndex: topologyPassEnabled || stops || selectionHandles || serviceTermini || wayLabels,
      serviceIndex: topology.enabled || stops,
    },
    topologyPassEnabled,
  };
}

interface SharedProjectionIndexes {
  waysById: Map<string, Way>;
  servicesByWay: Map<string, Service[]>;
  serviceSlots: Map<string, number>;
}

function buildSharedProjectionIndexes(
  system: TransitSystem,
  view: ViewOptions,
  projection: FeatureProjectionPlan,
): SharedProjectionIndexes {
  const waysById = projection.dependencies.wayIndex ? wayById(system.ways) : new Map();
  const servicesByWayIndex = projection.dependencies.serviceIndex
    ? servicesByWay(system.services, view.visibleModes)
    : new Map<string, Service[]>();

  return {
    waysById,
    servicesByWay: servicesByWayIndex,
    serviceSlots: projection.topology.services
      ? bundleSlots(servicesByWayIndex, system.lines)
      : new Map<string, number>(),
  };
}

function projectStops(
  system: TransitSystem,
  stops: TransitSystem['stops'],
  view: ViewOptions,
  indexes: SharedProjectionIndexes,
  counts: FeatureBuildOperationCounts | undefined,
): Feature<Point>[] {
  if (counts) counts.featureStopPassCount++;
  const visibleWays = visibleWaysFor(system.ways, view.visibleWayTypes);
  // The interchange scan (servedWayIds per stop) is the single most expensive
  // part of this function at RTC scale — memoized on (stops, visibleWays) so a
  // selection/viewport rebuild reuses it instead of re-scanning ~3787 stops.
  const nearWaysByStop = nearWaysForStops(stops, visibleWays);
  // `servicesByWay` reports every service that touches a way, which over-reports
  // once a service can cover only part of one. Only trimmed services need the
  // more expensive position check.
  const trimmedServiceIds = new Set(
    system.services.filter(serviceHasPartialLeg).map((service) => service.id),
  );
  const reaches = (service: Service, wayId: string, coord: LngLat): boolean => {
    if (!trimmedServiceIds.has(service.id)) return true;
    const way = indexes.waysById.get(wayId);
    if (!way) return true;
    const near = nearestOnPath(resolveWayPath(way), coord);
    return near ? serviceCoversWayAt(service, wayId, near.t) : true;
  };
  const ownership = linesByServiceId(system.lines);

  return stops.map((stop, stopIndex) => {
    if (counts) counts.featureStopVisitCount++;
    const servingServiceSet = new Set<Service>();
    for (const wayId of nearWaysByStop[stopIndex]) {
      for (const service of indexes.servicesByWay.get(wayId) ?? []) {
        if (reaches(service, wayId, stop.coord)) servingServiceSet.add(service);
      }
    }
    const servingServices = [...servingServiceSet];
    // Every anchored way contributes service, not just one. A platform shared
    // between the two halves of a couplet belongs to the lines on both.
    const anchorServices = stop.anchors.length
      ? stop.anchors.flatMap((anchor) =>
          (indexes.servicesByWay.get(anchor.wayId) ?? []).filter((service) =>
            reaches(service, anchor.wayId, stop.coord),
          ),
        )
      : [];
    const color = anchorServices[0]
      ? serviceColor(system, anchorServices[0])
      : servingServices[0]
        ? serviceColor(system, servingServices[0])
        : NEUTRAL_STATION;
    const servingLineIds = new Set(
      servingServices.map((service) => ownership.get(service.id)?.id ?? `service:${service.id}`),
    );
    const interchange = servingLineIds.size > 1;
    return {
      type: 'Feature',
      properties: {
        id: stop.id,
        color,
        interchange,
        // Major and interchange labels enter at a lower zoom than ordinary
        // stops, avoiding thousands of simultaneous collision candidates.
        major: interchange || stop.majorStop === true,
        name: stop.name ?? '',
      },
      geometry: { type: 'Point', coordinates: stop.coord },
    };
  });
}

function projectSelectionHandles(
  indexes: SharedProjectionIndexes,
  handleWayIds: string[],
  counts: FeatureBuildOperationCounts | undefined,
): Feature<Point>[] {
  if (counts) {
    counts.featureHandlePassCount++;
    counts.featureHandleWayVisitCount += handleWayIds.length;
  }
  return buildHandles(indexes.waysById, handleWayIds);
}

function projectServiceTermini(
  system: TransitSystem,
  selection: Highlight,
  indexes: SharedProjectionIndexes,
  activePatternId: string | null | undefined,
  armedTerminus: BuildFeaturesOptions['armedTerminus'],
): Feature<Point>[] {
  if (selection?.kind !== 'service') return [];
  const service = system.services.find((candidate) => candidate.id === selection.id);
  if (!service) return [];
  const pattern = servicePattern(service);
  const interactivePatternId = pattern.id === activePatternId ? activePatternId : pattern.id;
  const pending: Array<Feature<Point> & { properties: Record<string, unknown> }> = [];
  const outbound = patternRunLegs(pattern, 'outbound');
  const ends: Array<{ side: 'start' | 'end'; entry: (typeof outbound)[number] | undefined }> = [
    { side: 'start', entry: outbound[0] },
    { side: 'end', entry: outbound[outbound.length - 1] },
  ];
  for (const { side, entry } of ends) {
    if (!entry) continue;
    const way = indexes.waysById.get(entry.leg.wayId);
    if (!way) continue;
    const [lo, hi] = legRange(entry.leg);
    const isStart = side === 'start';
    const t = isStart === entry.forward ? lo : hi;
    pending.push({
      type: 'Feature',
      properties: {
        serviceId: service.id,
        patternId: pattern.id,
        side,
        modeId: service.modeId,
        interactive: false,
        ...(armedTerminus?.serviceId === service.id &&
        armedTerminus.patternId === pattern.id &&
        armedTerminus.side === side
          ? { armedReturn: true }
          : {}),
      },
      geometry: { type: 'Point', coordinates: pointAtT(resolveWayPath(way), t) },
    });
  }
  const coincident = new Map<string, number>();
  for (const feature of pending) {
    const [lng, lat] = feature.geometry.coordinates;
    const key = `${lng},${lat}`;
    coincident.set(key, (coincident.get(key) ?? 0) + 1);
  }
  return pending.map((feature) => {
    const [lng, lat] = feature.geometry.coordinates;
    const multiple = (coincident.get(`${lng},${lat}`) ?? 0) > 1;
    return {
      ...feature,
      properties: {
        ...feature.properties,
        interactive: !multiple || feature.properties.patternId === interactivePatternId,
      },
    };
  });
}

interface PhysicalProjectionResult {
  footprints: Feature<Polygon>[];
  platforms: Feature<Polygon>[];
  handles: Feature<Point>[];
}

interface ProjectPhysicalFeaturesOptions {
  system: TransitSystem;
  projection: PhysicalProjection;
  network: boolean;
  physicalHandleStationId: string | null;
  physicalHandleGroupId: string | null;
  counts: FeatureBuildOperationCounts | undefined;
}

function projectPhysicalFeatures({
  system,
  projection,
  network,
  physicalHandleStationId,
  physicalHandleGroupId,
  counts,
}: ProjectPhysicalFeaturesOptions): PhysicalProjectionResult {
  if (counts) counts.featurePhysicalPassCount++;
  const footprints: Feature<Polygon>[] = [];
  const platforms: Feature<Polygon>[] = [];
  if (network) return { footprints, platforms, handles: [] };

  if (projection.footprints || projection.platforms) {
    for (const station of system.stations) {
      if (counts) counts.featurePhysicalStopVisitCount++;
      if (projection.footprints && station.footprint) {
        footprints.push({
          type: 'Feature',
          properties: { stationId: station.id },
          geometry: { type: 'Polygon', coordinates: [closeRing(station.footprint)] },
        });
      }
      if (projection.platforms) {
        for (const platform of station.platforms ?? []) {
          platforms.push({
            type: 'Feature',
            properties: { stationId: station.id, platformId: platform.id },
            geometry: { type: 'Polygon', coordinates: [closeRing(platform.points)] },
          });
        }
      }
    }
    if (projection.footprints) {
      for (const group of system.groups) {
        if (counts) counts.featurePhysicalGroupVisitCount++;
        if (!group.footprint) continue;
        footprints.push({
          type: 'Feature',
          properties: { groupId: group.id, ...(group.color ? { color: group.color } : {}) },
          geometry: { type: 'Polygon', coordinates: [closeRing(group.footprint)] },
        });
      }
    }
  }

  if (!projection.handles) return { footprints, platforms, handles: [] };

  let handleStation: TransitSystem['stations'][number] | null = null;
  if (physicalHandleStationId) {
    for (const station of system.stations) {
      if (counts && !projection.footprints && !projection.platforms) {
        counts.featurePhysicalStopVisitCount++;
      }
      if (station.id !== physicalHandleStationId) continue;
      handleStation = station;
      break;
    }
  }
  let handleGroup: TransitSystem['groups'][number] | null = null;
  if (physicalHandleGroupId) {
    for (const group of system.groups) {
      if (counts && !projection.footprints) counts.featurePhysicalGroupVisitCount++;
      if (group.id !== physicalHandleGroupId) continue;
      handleGroup = group;
      break;
    }
  }

  return {
    footprints,
    platforms,
    handles: buildPhysicalHandles(handleStation, handleGroup),
  };
}

function projectWayLabels(
  system: TransitSystem,
  selection: Highlight,
  view: ViewOptions,
  indexes: SharedProjectionIndexes,
  network: boolean,
  counts: FeatureBuildOperationCounts | undefined,
): Feature<LineString>[] {
  if (counts) counts.featureWayLabelPassCount++;
  if (network) return [];

  const labels: Feature<LineString>[] = [];
  for (const namedWay of system.namedWays) {
    if (counts) counts.featureNamedWayVisitCount++;
    labels.push(...namedWayLabelFeatures(namedWay, indexes, view, selection));
  }
  return labels;
}

function namedWayLabelFeatures(
  namedWay: TransitSystem['namedWays'][number],
  indexes: SharedProjectionIndexes,
  view: ViewOptions,
  selection: Highlight,
): Feature<LineString>[] {
  if (!namedWay.name) return [];
  return namedWay.wayIds.flatMap((wayId) => {
    const way = indexes.waysById.get(wayId);
    if (!shouldProjectWayLabel(way, view, selection?.kind === 'way' ? selection.id : null)) {
      return [];
    }
    const path = resolveWayPath(way);
    return path.length < 2
      ? []
      : [
          {
            type: 'Feature',
            properties: { name: namedWay.name },
            geometry: { type: 'LineString', coordinates: path },
          },
        ];
  });
}

function emitImportedOrDetailedWay(options: {
  way: Way;
  path: LngLat[];
  color: string;
  width: number;
  dashed: boolean;
  zoom?: number;
  ways: Feature<LineString>[];
  detailed: () => void;
}): void {
  const { way, path, color, width, dashed, zoom, ways, detailed } = options;
  if (!isOsmImportedWay(way) || (zoom ?? 15) >= 15) {
    detailed();
    return;
  }
  ways.push(importedCenterlineFeature({ way, path, color, width, dashed }));
}

function requiredMapValue<K, V>(map: Map<K, V>, key: K): V {
  const value = map.get(key);
  if (value === undefined) throw new Error('Expected a projection index entry.');
  return value;
}

function projectFacilities(
  system: TransitSystem,
  network: boolean,
  counts: FeatureBuildOperationCounts | undefined,
): Feature<Point>[] {
  if (counts) counts.featureFacilityPassCount++;
  if (network) return [];

  return system.facilities.map((facility) => {
    if (counts) counts.featureFacilityVisitCount++;
    const render = facilityRender(facility.typeId);
    const coord: LngLat = Array.isArray(facility.geometry[0])
      ? (facility.geometry as LngLat[])[0]
      : (facility.geometry as LngLat);
    return {
      type: 'Feature',
      properties: {
        id: facility.id,
        typeId: facility.typeId,
        color: render.color,
        radius: render.radius,
        icon: iconName(render.icon, render.color),
        name: facility.name ?? '',
      },
      geometry: { type: 'Point', coordinates: coord },
    };
  });
}

interface TopologyProjectionResult {
  ways: Feature<LineString>[];
  services: Feature<LineString>[];
  lanes: Feature<LineString>[];
  laneMarkings: Feature<LineString>[];
  laneArrows: Feature<LineString>[];
  serviceArrows: Feature<LineString>[];
  junctions: Feature<Polygon>[];
  connectors: Feature<LineString>[];
}

interface ProjectTopologyFeaturesOptions {
  system: TransitSystem;
  selection: Highlight;
  view: ViewOptions;
  projection: FeatureProjectionPlan;
  indexes: SharedProjectionIndexes;
  network: boolean;
  counts: FeatureBuildOperationCounts | undefined;
}

/** Build the collections derived from ways, services, lanes, and junctions.
 *
 * These collections deliberately share one pass: lane-detail services need
 * the same trimmed geometry as ways, while junction footprints provide those
 * trims. Splitting them into independent loops would make partial projection
 * easier to read but would repeat the RTC-scale topology traversal. */
function projectTopologyFeatures({
  system,
  selection,
  view,
  projection,
  indexes,
  network,
  counts,
}: ProjectTopologyFeaturesOptions): TopologyProjectionResult {
  const selId = selection?.id ?? null;
  const { waysById, servicesByWay: byWay, serviceSlots: slots } = indexes;
  const selectedWayId = selection?.kind === 'way' ? selId : null;
  const topologyWays =
    !network && view.bounds
      ? waysInBoundsFor(system.ways, view.bounds, selectedWayId ?? undefined)
      : system.ways;

  // A way's own infra line, fanned out into `way.capacity` parallel lanes/
  // tracks in the Infrastructure view — a real physical cross-section instead
  // of one representative line. Network view always collapses to one line
  // (capacity is physical-planning detail, out of place on the schematic map).
  const emitCrossSection = (
    way: TransitSystem['ways'][number],
    path: LngLat[],
    color: string,
    width: number,
    dashed: boolean,
  ) => {
    if (!projection.topology.ways) return;
    const lanes = network ? 1 : Math.max(1, wayCapacity(way));
    const laneWidth = lanes > 1 ? Math.max(1.5, width / lanes + 0.75) : width;
    for (let i = 0; i < lanes; i++) {
      ways.push({
        type: 'Feature',
        properties: {
          id: way.id,
          color,
          width: laneWidth,
          dashed,
          offset: (i - (lanes - 1) / 2) * LANE_SPACING_PX,
        },
        geometry: { type: 'LineString', coordinates: path },
      });
    }
  };

  const ways: Feature<LineString>[] = [];
  const services: Feature<LineString>[] = [];
  const serviceHits: Feature<LineString>[] = [];
  const lanes: Feature<LineString>[] = [];
  const laneMarkings: Feature<LineString>[] = [];
  const laneArrows: Feature<LineString>[] = [];
  const serviceArrows: Feature<LineString>[] = [];

  // True-scale per-lane rendering for one way: lane surfaces at their real
  // metric widths (w14 + the exponential zoom expression in LANE_WIDTH_EXPR),
  // painted dividers, thin-line lanes (tracks), and direction arrows. Replaces
  // the emitCrossSection fan for that way at lane-detail zooms.
  const emitLaneDetail = (way: TransitSystem['ways'][number]) => {
    // wayTrims is populated by the junction pass below before any call here.
    const trims = wayTrims.get(way.id) ?? { start: 0, end: 0 };
    if (counts) counts.featureLaneGeometryBuildCount++;
    const g = wayLaneGeometry(way, trims.start, trims.end);
    const lat = way.points[0]?.[1] ?? 36;
    for (const lane of g.lanes) {
      const r = laneRender(lane.kindId);
      if (r.surface && projection.topology.lanes) {
        lanes.push({
          type: 'Feature',
          properties: {
            id: way.id,
            kindId: lane.kindId,
            color: r.color,
            w14: widthPxAtZ14(lane.widthM, lat),
          },
          geometry: { type: 'LineString', coordinates: lane.path },
        });
      } else if (!r.surface && projection.topology.laneMarkings) {
        laneMarkings.push({
          type: 'Feature',
          properties: { kind: 'thinLane', color: r.color },
          geometry: { type: 'LineString', coordinates: lane.path },
        });
      }
    }
    if (projection.topology.laneMarkings) {
      for (const d of g.dividers) {
        laneMarkings.push({
          type: 'Feature',
          properties: { kind: d.kind },
          geometry: { type: 'LineString', coordinates: d.path },
        });
      }
    }
    if (projection.topology.laneArrows) {
      for (const a of g.arrows) {
        laneArrows.push({
          type: 'Feature',
          properties: { id: way.id },
          geometry: { type: 'LineString', coordinates: a.path },
        });
      }
    }
    // A lane-rendered way has no fan feature to carry its selection halo, so
    // emit one centerline stand-in per lane-detailed way. It's invisible unless
    // selected: LYR_WAY_SELECTED is driven by feature-state (set on selection in
    // MapCanvas), and LYR_WAYS_SOLID/DASHED filter haloOnly out. Emitted
    // unconditionally (not only when selected) so the selection fast path can
    // light it via feature-state without a full rebuild.
    if (projection.topology.ways) {
      ways.push({
        type: 'Feature',
        properties: {
          id: way.id,
          color: '#191a17',
          width: 10,
          dashed: false,
          offset: 0,
          haloOnly: true,
        },
        geometry: { type: 'LineString', coordinates: resolveWayPath(way) },
      });
    }
  };

  // A way renders at lane detail when we're zoomed in enough (view.laneDetail),
  // it's on screen, and it isn't a tunnel (underground stays a dashed fan —
  // drawing asphalt for a bored tube would misread).
  const wantsLaneDetail = (way: TransitSystem['ways'][number]) =>
    !network &&
    view.laneDetail === true &&
    way.grade !== 'underground' &&
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
  const needsJunctionGeometry =
    !network && view.laneDetail === true && projection.junctions.needsGeometry;
  if (needsJunctionGeometry) {
    if (counts) counts.featureJunctionPassCount++;
    const laneNodes: { node: TransitSystem['nodes'][number]; g: JunctionGeometry }[] = [];
    const junctionCandidates = view.bounds
      ? nodesForWays(system.nodes, topologyWays)
      : system.nodes;
    for (const node of junctionCandidates) {
      if (counts) counts.featureJunctionNodeVisitCount++;
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
      if (projection.junctions.polygons && g.polygon.length >= 3) {
        junctionFeatures.push({
          type: 'Feature',
          properties: {
            nodeId: node.id,
            selected: selection?.kind === 'node' && selId === node.id,
          },
          geometry: { type: 'Polygon', coordinates: [closeRing(g.polygon)] },
        });
      }
      // Per-lane turn guides are editing detail for ONE junction. Emitting them
      // for every junction turns a complex interchange (dense OSM import) into a
      // star-burst of dozens of lane-to-lane connectors converging on each node
      // — so only draw them for the SELECTED node. The junction footprint +
      // carriageway trims above still render for every junction (that's the
      // paved road surface, not clutter).
      if (projection.junctions.connectors && selection?.kind === 'node' && selId === node.id) {
        for (const c of connectorCurves(node, waysById, wayTrims, system.turnRestrictions)) {
          connectorFeatures.push({
            type: 'Feature',
            properties: { nodeId: node.id },
            geometry: { type: 'LineString', coordinates: c.path },
          });
        }
      }
    }
  }

  if (projection.topology.enabled) {
    for (const way of topologyWays) {
      if (counts) counts.featureTopologyWayVisitCount++;
      if (!view.visibleWayTypes.has(way.typeId)) continue;
      const path = resolveWayPath(way);
      if (path.length < 2) continue;
      const bundle = byWay.get(way.id) ?? [];
      const showsWay = showsTopologyWay(way, view, selectedWayId);
      // Semantic detail governs the imported infrastructure feature, not the
      // transit service using it. A local street can disappear at metro zoom
      // while its bus line remains part of the network the user is planning.
      if (!showsWay && bundle.length === 0) continue;
      const base = wayRender(way.typeId, way.classId);
      const laneDetail = wantsLaneDetail(way);

      if (bundle.length === 0) {
        // Network view is service-focused — bare/unassigned infrastructure with
        // no rider only makes sense as physical-planning context (Infrastructure).
        if (network) continue;
        if (laneDetail) {
          if (projection.topology.needsLaneGeometry) emitLaneDetail(way);
          continue;
        }
        if (!projection.topology.ways) continue;
        const unassigned = UNASSIGNED_FAMILIES.has(wayType(way.typeId).family);
        const color = unassigned ? UNASSIGNED_COLOR : base.color;
        const width = unassigned ? UNASSIGNED_WIDTH : base.width;
        const dashed = unassigned || !!base.dashed;
        emitImportedOrDetailedWay({
          way,
          path,
          color,
          width,
          dashed,
          zoom: view.zoom,
          ways,
          detailed: () => emitCrossSection(way, path, color, width, dashed),
        });
        continue;
      }

      if (laneDetail && showsWay) {
        if (
          projection.topology.ways ||
          projection.topology.lanes ||
          projection.topology.laneMarkings ||
          projection.topology.laneArrows
        ) {
          emitLaneDetail(way);
        }
      } else if (
        showsWay &&
        projection.topology.ways &&
        !network &&
        showWayWhenServed(way.typeId)
      ) {
        emitImportedOrDetailedWay({
          way,
          path,
          color: base.color,
          width: base.width,
          dashed: !!base.dashed,
          zoom: view.zoom,
          ways,
          detailed: () => emitCrossSection(way, path, base.color, base.width, !!base.dashed),
        });
      }

      // One-way infrastructure reads as one-way in the SCHEMATIC too:
      // chevrons along the served line, pointing with travel — otherwise
      // Network view silently hides direction, and a one-way couplet looks
      // like two ordinary parallel lines.
      const wayIsOneWay = isOneWay(way.profile);
      if (projection.topology.laneArrows && network && wayIsOneWay) {
        const backward = directionalLanes(way.profile).every((l) => l.direction === 'backward');
        laneArrows.push({
          type: 'Feature',
          properties: { id: way.id },
          geometry: { type: 'LineString', coordinates: backward ? [...path].reverse() : path },
        });
      }
      // A stretch only ONE direction of a line rides is one-way as far as that
      // line is concerned, whatever the street underneath permits. Without this
      // a couplet drawn along two-way streets reads as two ordinary parallel
      // lines and nothing says which way round either half runs.
      //
      // Skipped when the way itself is one-way, because the chevrons above
      // already say it and two sets of arrows on one line is noise.
      if (projection.topology.serviceArrows && network && !wayIsOneWay) {
        for (const one of oneDirectionalStretches(
          system,
          waysById,
          byWay.get(way.id) ?? [],
          way.id,
        )) {
          serviceArrows.push({
            type: 'Feature',
            properties: { id: way.id, color: one.color },
            geometry: { type: 'LineString', coordinates: one.path },
          });
        }
      }

      if (!projection.topology.services) continue;

      // Network view is the clean schematic map — grade (tunnel/viaduct styling)
      // is physical-alignment detail that belongs to the Infrastructure view.
      const { underground, elevated } = network
        ? { underground: false, elevated: false }
        : gradeFlags(way.grade);
      const svcFeature = (
        svc: Service,
        coords: LngLat[],
        offset: number,
        w14?: number,
        occurrence?: ServiceWayOccurrence,
        hitTarget?: boolean,
      ): Feature<LineString> => ({
        type: 'Feature',
        // w14 present ⇒ a lane-detail overlay: the service layer grows it with
        // zoom, clamped to a sensible min/max (SERVICE_WIDTH_EXPR); absent ⇒ the
        // schematic fixed `width` is used (Network view).
        properties: {
          serviceId: svc.id,
          wayId: way.id,
          color: serviceColor(system, svc),
          width: modeRender(svc.modeId).width,
          underground,
          elevated,
          offset,
          ...(w14 !== undefined ? { w14 } : {}),
          ...(occurrence
            ? {
                patternId: occurrence.patternId,
                run: occurrence.run,
                legIndex: occurrence.legIndex,
              }
            : {}),
          // MapLibre's boolean filters do not coerce an absent property:
          // `!get(hitTarget)` receives null and rejects the painted feature.
          // Keep the paint/hit partition explicit on both sides.
          hitTarget: hitTarget === true,
        },
        geometry: { type: 'LineString', coordinates: coords },
      });
      const addServiceHitFeatures = (
        svc: Service,
        on: LngLat[],
        offset: number,
        w14: number | undefined,
        tOnPath: (t: number) => number = (t) => t,
      ) => {
        const occurrences = serviceWayOccurrences(svc, way.id);
        if (occurrences.length === 0) return;
        for (const occurrence of occurrences) {
          const piece = slicePathByT(
            on,
            tOnPath(occurrence.range[0]),
            tOnPath(occurrence.range[1]),
          );
          if (piece.length >= 2)
            serviceHits.push(svcFeature(svc, piece, offset, w14, occurrence, true));
        }
      };
      // Constant per-service offset on the CENTERLINE — no jog at shared-segment
      // boundaries (see bundleSlots). This is the Network schematic and the
      // lane-detail fallback when a lane can't be resolved.
      //
      // One feature per stretch of this way the service actually runs over, not
      // one per way it merely touches: a line that terminates mid-block has to
      // stop being drawn there. A service covering the whole way — still the
      // common case — takes the untouched path and emits exactly one feature, so
      // a system nobody has trimmed produces byte-identical output.
      const centerlineFeatures = (svc: Service, on: LngLat[] = path): Feature<LineString>[] => {
        const offset = (slots.get(svc.id) ?? 0) * BUNDLE_SPACING_PX;
        addServiceHitFeatures(svc, on, offset, undefined);
        const ranges = serviceRangesOnWay(svc, way.id);
        if (ranges.length === 1 && ranges[0][0] <= 0 && ranges[0][1] >= 1)
          return [svcFeature(svc, on, offset)];
        return ranges
          .map(([lo, hi]) => slicePathByT(on, lo, hi))
          .filter((p) => p.length >= 2)
          .map((p) => svcFeature(svc, p, offset));
      };

      if (laneDetail) {
        // INFRASTRUCTURE lane detail: draw each service on the ACTUAL lane it
        // uses — the curb lane for its travel direction, or its track — instead
        // of the schematic centerline. wayLaneGeometry is memoized on the same
        // trims emitLaneDetail already computed above, so this is a cache hit.
        const trims = wayTrims.get(way.id) ?? { start: 0, end: 0 };
        if (counts) counts.featureLaneGeometryBuildCount++;
        const laneById = new Map(
          wayLaneGeometry(way, trims.start, trims.end).lanes.map((l) => [l.laneId, l] as const),
        );
        const lat = way.points[0]?.[1] ?? 36;
        // Which lane(s) each service rides here — both directions of every
        // pattern that traverses this way, so a two-way service claims both
        // curbs. Group services by lane so services sharing a lane can fan
        // slightly instead of overprinting. wayPatternIndex is pre-built once
        // for the whole system — O(1) here, not a re-scan of every rider's full
        // pattern list per way.
        const byLane = new Map<string, Service[]>();
        const resolved = new Set<string>();
        for (const { svc, pattern, wayIdx, forward, nextWayId } of wayPatternIndex(byWay).get(
          way.id,
        ) ?? []) {
          const laneId = serviceLaneOnWay(
            pattern,
            wayIdx,
            waysById,
            svc.modeId,
            forward,
            nextWayId ? { nextWayId, turnRestrictions: system.turnRestrictions } : undefined,
          );
          if (!laneId || !laneById.has(laneId)) continue;
          resolved.add(svc.id);
          let arr = byLane.get(laneId);
          if (!arr) byLane.set(laneId, (arr = []));
          // A service can land on the SAME lane twice — via two of its own
          // patterns, or because a single track (or a pinned leg) carries both
          // its directions. Don't double-emit it there.
          if (!arr.some((s) => s.id === svc.id)) arr.push(svc);
        }
        // A bundle rider with no lane resolved anywhere on this way (a lane-less
        // profile) falls back to the centerline.
        bundle.forEach((svc) => {
          if (!resolved.has(svc.id)) services.push(...centerlineFeatures(svc));
        });
        // A lane path is the centerline carved back at each junction footprint,
        // so a position measured against the untrimmed way sits further along
        // it. Convert once per way rather than slicing against the wrong ruler.
        const wayMeters = pathLengthMeters(path);
        const laneMeters = Math.max(1e-9, wayMeters - trims.start - trims.end);
        const ontoLane = (t: number): number =>
          Math.max(0, Math.min(1, (t * wayMeters - trims.start) / laneMeters));
        for (const [laneId, svcs] of byLane) {
          const lane = requiredMapValue(laneById, laneId);
          // w14 = the lane's overlay half-width in z14 px; today it only FLAGS a
          // lane-detail overlay (the layer's zoom-clamped SERVICE_WIDTH_EXPR draws
          // the band), but it carries the metric so a per-lane width can use it later.
          const w14 = widthPxAtZ14(lane.widthM * SERVICE_LANE_FRACTION, lat);
          const n = svcs.length; // lone service sits dead-centre on its lane
          svcs.forEach((svc, i) => {
            const offset = (i - (n - 1) / 2) * WITHIN_LANE_SPACING_PX;
            addServiceHitFeatures(svc, lane.path, offset, w14, ontoLane);
            const ranges = serviceRangesOnWay(svc, way.id);
            if (ranges.length === 1 && ranges[0][0] <= 0 && ranges[0][1] >= 1) {
              services.push(svcFeature(svc, lane.path, offset, w14));
              return;
            }
            for (const [lo, hi] of ranges) {
              const piece = slicePathByT(lane.path, ontoLane(lo), ontoLane(hi));
              if (piece.length >= 2) services.push(svcFeature(svc, piece, offset, w14));
            }
          });
        }
      } else {
        bundle.forEach((svc) => services.push(...centerlineFeatures(svc)));
      }
    }
  }

  return {
    ways,
    // Paint stays continuity-merged through bends. Only the transparent hit
    // surface remains per-occurrence, so an ambiguous right-click is exact.
    services: [...mergeAdjacentServiceLines(services), ...serviceHits],
    lanes,
    laneMarkings,
    laneArrows,
    serviceArrows,
    junctions: junctionFeatures,
    connectors: connectorFeatures,
  };
}

function emptyTopologyProjection(): TopologyProjectionResult {
  return {
    ways: [],
    services: [],
    lanes: [],
    laneMarkings: [],
    laneArrows: [],
    serviceArrows: [],
    junctions: [],
    connectors: [],
  };
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
  /** The Station whose footprint/platform vertices should render as
   *  draggable handles right now (its own edit context, not tied to
   *  `selection` directly since a platform can be mid-edit independently). */
  physicalHandleStationId: string | null = null,
  /** Same, for a group's (facility-complex's) own footprint vertices. */
  physicalHandleGroupId: string | null = null,
  options: BuildFeaturesOptions = {},
): SystemFeatures {
  const projection = createFeatureProjectionPlan(options.requestedFeatures);
  const counts = options.counts;
  if (counts) {
    counts.featureCollectionBuildCount += projection.collectionCount;
    if (projection.topologyPassEnabled) counts.featureTopologyPassCount++;
  }

  // Diagram shares Network's schematic behavior. Only Infrastructure includes
  // physical planning detail such as footprints and facilities.
  const network = view.viewMode !== 'infrastructure';
  const indexes = buildSharedProjectionIndexes(system, view, projection);
  const topology = projection.topologyPassEnabled
    ? projectTopologyFeatures({
        system,
        selection,
        view,
        projection,
        indexes,
        network,
        counts,
      })
    : emptyTopologyProjection();
  const requestedStopIds = options.stopIds ? new Set(options.stopIds) : null;
  const stopsToProject = requestedStopIds
    ? system.stops.filter((stop) => requestedStopIds.has(stop.id))
    : system.stops;
  const stops = projection.stops ? projectStops(system, stopsToProject, view, indexes, counts) : [];
  const handles =
    projection.selectionHandles && !(network && selection?.kind === 'service')
      ? projectSelectionHandles(indexes, handleWayIds, counts)
      : [];
  const serviceTermini =
    projection.serviceTermini && view.viewMode !== 'diagram'
      ? projectServiceTermini(
          system,
          selection,
          indexes,
          options.activePatternId,
          options.armedTerminus,
        )
      : [];
  const physical = projection.physical.enabled
    ? projectPhysicalFeatures({
        system,
        projection: projection.physical,
        network,
        physicalHandleStationId,
        physicalHandleGroupId,
        counts,
      })
    : { footprints: [], platforms: [], handles: [] };
  const wayLabels = projection.wayLabels
    ? projectWayLabels(system, selection, view, indexes, network, counts)
    : [];
  const facilities = projection.facilities ? projectFacilities(system, network, counts) : [];

  return {
    ways: { type: 'FeatureCollection', features: topology.ways },
    services: { type: 'FeatureCollection', features: topology.services },
    stops: { type: 'FeatureCollection', features: stops },
    footprints: { type: 'FeatureCollection', features: physical.footprints },
    platforms: { type: 'FeatureCollection', features: physical.platforms },
    facilities: { type: 'FeatureCollection', features: facilities },
    physicalHandles: { type: 'FeatureCollection', features: physical.handles },
    handles: { type: 'FeatureCollection', features: handles },
    serviceTermini: { type: 'FeatureCollection', features: serviceTermini },
    lanes: { type: 'FeatureCollection', features: topology.lanes },
    laneMarkings: { type: 'FeatureCollection', features: topology.laneMarkings },
    laneArrows: { type: 'FeatureCollection', features: topology.laneArrows },
    serviceArrows: { type: 'FeatureCollection', features: topology.serviceArrows },
    junctions: { type: 'FeatureCollection', features: topology.junctions },
    connectors: { type: 'FeatureCollection', features: topology.connectors },
    wayLabels: { type: 'FeatureCollection', features: wayLabels },
  };
}
