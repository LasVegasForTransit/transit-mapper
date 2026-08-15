import type {
  FeatureCollection,
  Feature,
  LineString,
  MultiLineString,
  Point,
  Polygon,
} from 'geojson';
import { wayType } from '@transitmapper/core/model/catalog';
import {
  facilityRender,
  gradeFlags,
  laneRender,
  modeRender,
  wayRender,
  type RenderStyle,
} from '../style/catalogStyle';
import {
  nearestOnPath,
  legRange,
  pathLengthMeters,
  resolveWayPath,
  resolveWayPathAtError,
  serviceCoversWayAt,
  serviceHasPartialLeg,
  PATTERN_RUNS,
  patternRunLegs,
  serviceRangesOnWay,
  slicePathByT,
  wayById,
  patternRunSegments,
} from '../model/geo';
import { linesByServiceId } from '../model/line-service';
import { nearWaysForStops, servicesByWay, visibleWaysFor } from './featureMemo';
import { mergeAdjacentServiceLines } from './mergeServiceLines';
import {
  serviceJunctionConnectors,
  type ServiceJunctionConnector,
} from './service-junction-connectors';
import {
  assignServicesToLanes,
  indexServicePatternsByWay,
  laneServiceAssignmentKey,
} from './service-lane-assignments';
import { directionalLanes, isOneWay, profileWidthM } from '../model/profile';
import {
  corridorSurfaceRing,
  railTrackGeometry,
  resolveWayLaneGeometry,
  STANDARD_RAIL_TIE_SPACING_M,
  type LanePath,
  type WayLaneGeometry,
} from '../geometry/streets';
import {
  collectWayTrims,
  junctionGeometry,
  type JunctionGeometry,
  type WayTrims,
} from '../geometry/junctions';
import {
  junctionControlledApproaches,
  junctionCrosswalks,
  junctionStopBars,
} from '../geometry/junction-markings';
import { iconName } from './iconName';
import type {
  PatternLeg,
  RunDirection,
  Way,
  LngLat,
  Pattern,
  Service,
  Stop,
  TransitSystem,
} from '../model/system';
import { HANDLE_ICON, widthPxAtZ14 } from './constants';
import { renderFeatureId, systemFeatureSourceId } from './render-identity';
import {
  metricErrorForDisplayedPixels,
  renderTierBlend,
  selectRenderTier,
  type RenderPresentation,
  type RenderTier,
  type RenderTierResolution,
  type RenderTierStateResolver,
} from './render-presentation';
import { type RenderViewportCategory } from './viewport-index';
import {
  renderViewportCandidateSets,
  type RenderViewportCandidateSets,
} from './render-viewport-candidates';
import type { RenderFeatureProjectionUnitScope } from './render-feature-projection-unit';
import {
  orderedIndexedValues,
  renderFacilitiesById,
  renderGroupsById,
  renderNamedWaysById,
  renderNodesById,
  renderServicesById,
  renderStationsById,
  renderStopsById,
} from './render-domain-indexes';
import type { RenderProjectionScope } from './render-projection-scope';
import {
  createFeatureBuildOperationCounts,
  type FeatureBuildOperationCounts,
} from './feature-build-operation-counts';

export { createFeatureBuildOperationCounts, type FeatureBuildOperationCounts };
import type { RenderPreparedSnapshot } from './render-preparation';
import { namedWayLabelDependencyId } from './dependency-identities';
import {
  facilityRenderCoordinate,
  groupFootprintPointRenderId,
  resolveServiceTerminus,
  serviceTerminusDescriptors,
  stationFootprintPointRenderId,
  stationPlatformPointRenderId,
  wayControlPointRenderId,
  type ServiceTerminusDescriptor,
} from './viewport-feature-identities';

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
const WITHIN_LANE_SPACING_PX = 1.5; // gap between services sharing ONE lane in Infrastructure lane-detail
const SERVICE_LANE_FRACTION = 0.6; // a service overlay fills ~60% of its lane's width (leaves the lane markings visible)
const DISPLAYED_CURVE_ERROR_PX = 0.35;
const DISPLAYED_RAIL_TIE_SPACING_PX = 3;

/** Rendering controls approximation density, while geometry owns the actual
 * physical arc. This keeps display scale out of the domain model. */
function renderedWayPath(way: Way, presentation: RenderPresentation): LngLat[] {
  const latitude = way.points[0]?.[1] ?? 0;
  return resolveWayPathAtError(
    way,
    metricErrorForDisplayedPixels(presentation, latitude, DISPLAYED_CURVE_ERROR_PX),
  );
}

const allModeIdsCache = new WeakMap<Service[], Set<string>>();
const allWayTypeIdsCache = new WeakMap<Way[], Set<string>>();
const serviceHasPartialLegCache = new WeakMap<Service, boolean>();

function allModeIds(services: Service[]): Set<string> {
  const cached = allModeIdsCache.get(services);
  if (cached) return cached;
  const ids = new Set(services.map((service) => service.modeId));
  allModeIdsCache.set(services, ids);
  return ids;
}

function allWayTypeIds(ways: Way[]): Set<string> {
  const cached = allWayTypeIdsCache.get(ways);
  if (cached) return cached;
  const ids = new Set(ways.map((way) => way.typeId));
  allWayTypeIdsCache.set(ways, ids);
  return ids;
}

function cachedServiceHasPartialLeg(service: Service): boolean {
  const cached = serviceHasPartialLegCache.get(service);
  if (cached !== undefined) return cached;
  const result = serviceHasPartialLeg(service);
  serviceHasPartialLegCache.set(service, result);
  return result;
}

const RENDER_SOURCE_IDS = {
  ways: systemFeatureSourceId('ways'),
  services: systemFeatureSourceId('services'),
  // The MapLibre source retains its historical `stations` name. Internally
  // this collection is `stops`: these are boarding points, not passenger
  // places with physical footprints and platforms.
  stops: systemFeatureSourceId('stations'),
  handles: systemFeatureSourceId('handles'),
  serviceTermini: systemFeatureSourceId('service-termini'),
  footprints: systemFeatureSourceId('footprints'),
  platforms: systemFeatureSourceId('platforms'),
  facilities: systemFeatureSourceId('facilities'),
  physicalHandles: systemFeatureSourceId('physical-handles'),
  lanes: systemFeatureSourceId('lanes'),
  laneMarkings: systemFeatureSourceId('lane-markings'),
  laneArrows: systemFeatureSourceId('lane-arrows'),
  serviceArrows: systemFeatureSourceId('service-arrows'),
  junctions: systemFeatureSourceId('junctions'),
  connectors: systemFeatureSourceId('connectors'),
  wayLabels: systemFeatureSourceId('way-labels'),
} as const;

type RenderSourceName = keyof typeof RENDER_SOURCE_IDS;

function stableFeatureId(
  source: RenderSourceName,
  role: string,
  ...identity: Array<string | number>
): string {
  return renderFeatureId(RENDER_SOURCE_IDS[source], role, identity);
}

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

interface ServiceWayMembership {
  serviceWays: Map<string, string[]>;
  order: string[];
}

function serviceWayMembership(byWay: Map<string, Service[]>): ServiceWayMembership {
  const serviceWays = new Map<string, string[]>();
  const order: string[] = [];
  for (const [wayId, services] of byWay) {
    for (const service of services) {
      const existing = serviceWays.get(service.id);
      if (existing) {
        existing.push(wayId);
        continue;
      }
      serviceWays.set(service.id, [wayId]);
      order.push(service.id);
    }
  }
  return { serviceWays, order };
}

function nthBundleSlot(index: number): number {
  if (index === 0) return 0;
  return index % 2 === 1 ? (index + 1) / 2 : -index / 2;
}

function firstAvailableBundleSlot(
  wayIds: readonly string[],
  occupied: ReadonlyMap<string, ReadonlySet<number>>,
): number {
  for (let index = 0; ; index++) {
    const candidate = nthBundleSlot(index);
    if (wayIds.every((wayId) => !occupied.get(wayId)?.has(candidate))) return candidate;
  }
}

function occupyBundleSlot(
  wayIds: readonly string[],
  slot: number,
  occupied: Map<string, Set<number>>,
): void {
  for (const wayId of wayIds) {
    const slots = occupied.get(wayId) ?? new Set<number>();
    slots.add(slot);
    occupied.set(wayId, slots);
  }
}

function bundleSlots(byWay: Map<string, Service[]>): Map<string, number> {
  const cached = bundleSlotCache.get(byWay);
  if (cached) return cached;
  const { serviceWays, order } = serviceWayMembership(byWay);
  const occupied = new Map<string, Set<number>>();
  const slots = new Map<string, number>();
  for (const serviceId of order) {
    const wayIds = serviceWays.get(serviceId) ?? [];
    const slot = firstAvailableBundleSlot(wayIds, occupied);
    slots.set(serviceId, slot);
    occupyBundleSlot(wayIds, slot, occupied);
  }
  bundleSlotCache.set(byWay, slots);
  return slots;
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

interface ServiceFeatureProjectionOptions {
  service: Service;
  coordinates: LngLat[];
  offset: number;
  renderTier: RenderTier;
  tierOpacity: number;
  availableTiers: readonly RenderTier[];
  w14?: number;
  occurrence?: ServiceWayOccurrence;
  hitTarget?: boolean;
  pathRole?: string;
  semanticRange?: [number, number];
}

interface ServiceHitProjectionOptions {
  service: Service;
  path: LngLat[];
  offset: number;
  renderTier: RenderTier;
  tierOpacity: number;
  availableTiers: readonly RenderTier[];
  w14?: number;
  pathRole?: string;
  runs?: ReadonlySet<RunDirection>;
  tOnPath?: (t: number) => number;
}

function serviceWayOccurrences(service: Service, wayId: string): ServiceWayOccurrence[] {
  const occurrences: ServiceWayOccurrence[] = [];
  const pattern = service.path;
  for (const run of PATTERN_RUNS) {
    patternRunLegs(pattern, run).forEach(({ leg }, legIndex) => {
      if (leg.wayId !== wayId) return;
      occurrences.push({ patternId: pattern.id, run, legIndex, range: legRange(leg), leg });
    });
  }
  return occurrences;
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
 * Deduplicated by geometry start/end so two branches of one service riding the
 * same one-directional stretch do not stack arrows on top of each other.
 */
interface DirectionalStretch {
  path: LngLat[];
  color: string;
  serviceId: string;
  modeId: string;
  run: RunDirection;
  range: [number, number];
  forward: boolean;
}

interface DirectionalSectionSide {
  legs: PatternLeg[];
  run: RunDirection;
}

function patternRiddenDirections(pattern: Pattern): ReadonlyMap<string, number> {
  const ridden = new Map<string, number>();
  for (const run of PATTERN_RUNS) {
    for (const { leg } of patternRunLegs(pattern, run)) {
      const directionBit = run === 'outbound' ? 1 : 2;
      ridden.set(leg.wayId, (ridden.get(leg.wayId) ?? 0) | directionBit);
    }
  }
  return ridden;
}

function directionalSectionSides(section: Pattern['sections'][number]): DirectionalSectionSide[] {
  if (section.kind === 'shared') return [];
  if (section.kind === 'split') {
    return [
      { legs: section.outbound, run: 'outbound' },
      { legs: section.inbound, run: 'inbound' },
    ];
  }
  return [{ legs: section.legs, run: 'outbound' }];
}

interface DirectionalSideProjectionOptions {
  waysById: Map<string, Way>;
  pattern: Pattern;
  side: DirectionalSectionSide;
  service: Service;
  color: string;
  wayId: string;
}

function projectDirectionalSide({
  waysById,
  pattern,
  side,
  service,
  color,
  wayId,
}: DirectionalSideProjectionOptions): DirectionalStretch[] {
  const wanted = new Set(side.legs.filter((leg) => leg.wayId === wayId));
  if (wanted.size === 0) return [];
  const stretches: DirectionalStretch[] = [];
  for (const segment of patternRunSegments(waysById, pattern, side.run)) {
    if (!wanted.has(segment.leg) || segment.path.length < 2) continue;
    stretches.push({
      path: segment.path,
      color,
      serviceId: service.id,
      modeId: service.modeId,
      run: segment.run,
      range: legRange(segment.leg),
      forward: segment.forward,
    });
  }
  return stretches;
}

interface PatternDirectionalStretchProjectionOptions {
  waysById: Map<string, Way>;
  service: Service;
  pattern: Pattern;
  wayId: string;
  color: string;
}

function projectPatternDirectionalStretches({
  waysById,
  service,
  pattern,
  wayId,
  color,
}: PatternDirectionalStretchProjectionOptions): DirectionalStretch[] {
  // Which stretches this pattern rides BOTH ways, whatever sections they sit
  // in. An arrow means "one-way as far as this line is concerned", so a
  // stretch the line also comes back along must not get one.
  if (patternRiddenDirections(pattern).get(wayId) === 3) return [];
  return pattern.sections.flatMap((section) =>
    directionalSectionSides(section).flatMap((side) =>
      projectDirectionalSide({ waysById, pattern, side, service, wayId, color }),
    ),
  );
}

function oneDirectionalStretches(
  waysById: Map<string, Way>,
  services: Service[],
  wayId: string,
  lineByServiceId: ReadonlyMap<string, TransitSystem['lines'][number]>,
): DirectionalStretch[] {
  const out: DirectionalStretch[] = [];
  const seen = new Set<string>();
  for (const svc of services) {
    const pattern = svc.path;
    const color = serviceDisplayColor(svc, lineByServiceId);
    for (const stretch of projectPatternDirectionalStretches({
      waysById,
      service: svc,
      pattern,
      wayId,
      color,
    })) {
      const key = [svc.id, wayId, stretch.run, stretch.forward, ...stretch.range].join(':');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(stretch);
    }
  }
  return out;
}

export interface SystemFeatures {
  ways: FeatureCollection<LineString | Polygon>;
  services: FeatureCollection<LineString>;
  stops: FeatureCollection<Point>;
  handles: FeatureCollection<Point>;
  /** Route-owned ends, intentionally distinct from physical corridor controls. */
  serviceTermini: FeatureCollection<Point>;
  footprints: FeatureCollection<Polygon>;
  platforms: FeatureCollection<Polygon>;
  facilities: FeatureCollection<Point>;
  physicalHandles: FeatureCollection<Point>;
  /** Street-tier physical rendering: lane surfaces, painted markings, and
   * direction arrows. Screen-space corridor width selects this tier; the
   * collections stay empty when that detail cannot contribute a pixel. */
  lanes: FeatureCollection<Polygon>;
  laneMarkings: FeatureCollection<LineString | MultiLineString>;
  laneArrows: FeatureCollection<LineString>;
  /** Travel arrows for stretches only ONE direction of a line rides. Carries
   *  the service colour, because these sit on top of the line rather than on
   *  the asphalt beneath it. */
  serviceArrows: FeatureCollection<LineString>;
  /** Junction surface polygons plus Street-tier control markers. Keeping both
   * in one source gives source patches one owner for a junction revision. */
  junctions: FeatureCollection<Polygon | Point>;
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
 *  feature and a Set for all ~3,787 stations at RTC scale — and then throw
 *  twelve of the collections away. Its inputs are exactly its parameters, so a
 *  caller can drive it directly and pay only for what changed.
 *
 *  A way's first/last control point is marked `endpoint`: it renders and
 *  behaves differently from an interior reshape handle (see LYR_WAY_ENDPOINTS)
 *  — dragging it extends the way with a new point instead of moving it. */
export function buildHandles(
  waysById: Map<string, TransitSystem['ways'][number]>,
  handleWayIds: string[],
  candidateHandleIds?: ReadonlySet<string>,
): Feature<Point>[] {
  const handles: Feature<Point>[] = [];
  for (const wid of handleWayIds) {
    const way = waysById.get(wid);
    way?.points.forEach((p, i) => {
      const id = wayControlPointRenderId(wid, i);
      if (candidateHandleIds && !candidateHandleIds.has(id)) return;
      const endpoint = i === 0 || i === way.points.length - 1;
      handles.push({
        type: 'Feature',
        id,
        properties: { wayId: wid, index: i, endpoint, icon: HANDLE_ICON },
        geometry: { type: 'Point', coordinates: p },
      });
    });
  }
  return handles;
}

/** Footprint/platform vertices of the one station and/or group being edited.
 *
 *  Takes the RESOLVED records rather than their ids on purpose: a footprint
 *  drag changes the geometry while the id stays put, so anything keyed on the
 *  id alone would serve a stale shape — the exact failure a memo layer must not
 *  have. Resolving also makes this O(1) in the number of stations, where the
 *  inline version scanned every station to find the one match. */
export function buildPhysicalHandles(
  station: TransitSystem['stations'][number] | null | undefined,
  group: TransitSystem['groups'][number] | null | undefined,
  candidateHandleIds?: ReadonlySet<string>,
): Feature<Point>[] {
  const physicalHandles: Feature<Point>[] = [];
  if (station) {
    station.footprint?.forEach((p, i) => {
      const id = stationFootprintPointRenderId(station.id, i);
      if (candidateHandleIds && !candidateHandleIds.has(id)) return;
      physicalHandles.push({
        type: 'Feature',
        id,
        properties: { kind: 'footprint', stationId: station.id, index: i, icon: HANDLE_ICON },
        geometry: { type: 'Point', coordinates: p },
      });
    });
    for (const pf of station.platforms ?? []) {
      pf.points.forEach((p, i) => {
        const id = stationPlatformPointRenderId(station.id, pf.id, i);
        if (candidateHandleIds && !candidateHandleIds.has(id)) return;
        physicalHandles.push({
          type: 'Feature',
          id,
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
      const id = groupFootprintPointRenderId(group.id, i);
      if (candidateHandleIds && !candidateHandleIds.has(id)) return;
      physicalHandles.push({
        type: 'Feature',
        id,
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
  /** Present only after a semantic view has been resolved at a renderer
   * boundary. `buildFeatures` requires the narrowed `RenderViewOptions`. */
  presentation?: RenderPresentation;
  /** Retain all document modes and way types so MapLibre paint filters can
   * change visibility without rebuilding geometry. Static/source-filtered
   * callers omit this and preserve their smaller collections. */
  styleDeferredVisibility?: boolean;
  /** Stateful live-only logical tier retention. Static callers omit it, so
   * export geometry remains deterministic and history-free. */
  tierStateResolver?: RenderTierStateResolver;
}

/** A semantic view plus the final camera/display facts required to project
 * it. UI state may remain camera-independent; every renderer boundary must
 * resolve this type before asking core for geometry. */
export interface RenderViewOptions extends ViewOptions {
  presentation: RenderPresentation;
}

export type SystemFeatureName = keyof SystemFeatures;

export interface BuildFeaturesOptions {
  /** Omitted for exports, previews, and initial/style/view builds. The live
   * editor passes the exact collections whose MapLibre sources will upload,
   * so unrelated RTC-scale phases are never traversed just to discard them. */
  requestedFeatures?: readonly SystemFeatureName[];
  /** Restrict stop feature derivation to these stable ids. Live gesture
   * settlement uses this to avoid allocating and resolving service context
   * for every unchanged boarding point. */
  stopIds?: readonly string[];
  /** Restrict physical passenger-place derivation to these stable ids. */
  stationIds?: readonly string[];
  /** Exact prior+next dependency scope for incremental committed projection.
   * Static, export, and viewport-only callers omit it and retain authoritative
   * full behavior. */
  projectionScope?: RenderProjectionScope;
  /** Additional execution-only restriction for one resumable projection
   * unit. It never replaces viewport culling or an entity dependency scope. */
  unitScope?: RenderFeatureProjectionUnitScope;
  /** Execution-only candidates already resolved by the resumable planner for
   * this exact system and presentation. They are authoritative and may only
   * narrow the normal viewport result; never use them as a widening fallback. */
  precomputedViewportCandidates?: RenderViewportCandidateSets;
  /** Transactionally prepared viewport and domain indexes for this exact
   * immutable system snapshot. Supplying it bypasses every whole-document
   * first-touch cache in this projection call. */
  preparedSnapshot?: RenderPreparedSnapshot;
  /** Live editors may own selected-junction movement guides in a transient
   * source. Static surfaces omit this and retain selected connector output. */
  selectionOwnedConnectors?: boolean;
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

function featureIsRequested(
  requested: ReadonlySet<SystemFeatureName> | null,
  name: SystemFeatureName,
): boolean {
  return requested === null || requested.has(name);
}

function topologyProjection(requested: ReadonlySet<SystemFeatureName> | null): TopologyProjection {
  const outputs = {
    ways: featureIsRequested(requested, 'ways'),
    services: featureIsRequested(requested, 'services'),
    lanes: featureIsRequested(requested, 'lanes'),
    laneMarkings: featureIsRequested(requested, 'laneMarkings'),
    laneArrows: featureIsRequested(requested, 'laneArrows'),
    serviceArrows: featureIsRequested(requested, 'serviceArrows'),
  };
  return {
    ...outputs,
    enabled: Object.values(outputs).some(Boolean),
    needsLaneGeometry:
      outputs.ways ||
      outputs.services ||
      outputs.lanes ||
      outputs.laneMarkings ||
      outputs.laneArrows,
  };
}

function junctionProjection(
  requested: ReadonlySet<SystemFeatureName> | null,
  topology: TopologyProjection,
): JunctionProjection {
  const polygons = featureIsRequested(requested, 'junctions');
  const connectors = featureIsRequested(requested, 'connectors');
  return {
    polygons,
    connectors,
    needsGeometry: topology.needsLaneGeometry || polygons || connectors,
  };
}

function physicalProjection(requested: ReadonlySet<SystemFeatureName> | null): PhysicalProjection {
  const outputs = {
    footprints: featureIsRequested(requested, 'footprints'),
    platforms: featureIsRequested(requested, 'platforms'),
    handles: featureIsRequested(requested, 'physicalHandles'),
  };
  return { ...outputs, enabled: Object.values(outputs).some(Boolean) };
}

function createFeatureProjectionPlan(
  requestedFeatures: readonly SystemFeatureName[] | undefined,
): FeatureProjectionPlan {
  const requested = requestedFeatures ? new Set<SystemFeatureName>(requestedFeatures) : null;
  const topology = topologyProjection(requested);
  const junctions = junctionProjection(requested, topology);
  const physical = physicalProjection(requested);
  const stops = featureIsRequested(requested, 'stops');
  const selectionHandles = featureIsRequested(requested, 'handles');
  const serviceTermini = featureIsRequested(requested, 'serviceTermini');
  const facilities = featureIsRequested(requested, 'facilities');
  const wayLabels = featureIsRequested(requested, 'wayLabels');
  const topologyPassEnabled = topology.enabled || junctions.polygons || junctions.connectors;

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
  nodesById: ReadonlyMap<string, TransitSystem['nodes'][number]>;
  stopsById: ReadonlyMap<string, Stop>;
  stationsById: ReadonlyMap<string, TransitSystem['stations'][number]>;
  namedWaysById: ReadonlyMap<string, TransitSystem['namedWays'][number]>;
  facilitiesById: ReadonlyMap<string, TransitSystem['facilities'][number]>;
  groupsById: ReadonlyMap<string, TransitSystem['groups'][number]>;
  servicesById: ReadonlyMap<string, Service>;
  linesByServiceId: ReadonlyMap<string, TransitSystem['lines'][number]>;
  servicesByWay: Map<string, Service[]>;
  allServicesByWay: Map<string, Service[]>;
  projectedWayTypeIds: Set<string>;
  serviceSlots: Map<string, number>;
  wayIdsByStop?: ReadonlyMap<string, readonly string[]>;
}

/** A Line owns the public color; an orphaned in-progress Service still needs
 * a visible, mode-appropriate fallback while validation reports its missing membership. */
function serviceDisplayColor(
  service: Service,
  lineByServiceId: ReadonlyMap<string, TransitSystem['lines'][number]>,
): string {
  return lineByServiceId.get(service.id)?.color ?? modeRender(service.modeId).color;
}

interface StopModeProjectionOptions {
  stop: Stop;
  nearbyWayIds: readonly string[];
  servicesByWay: ReadonlyMap<string, Service[]>;
  reaches: (service: Service, wayId: string, coord: LngLat) => boolean;
}

function servedModeIdsForStop({
  stop,
  nearbyWayIds,
  servicesByWay: allServicesByWay,
  reaches,
}: StopModeProjectionOptions): string[] {
  const servingServices = new Set<Service>();
  for (const wayId of nearbyWayIds) {
    for (const service of allServicesByWay.get(wayId) ?? []) {
      if (reaches(service, wayId, stop.coord)) servingServices.add(service);
    }
  }
  for (const anchor of stop.anchors) {
    for (const service of allServicesByWay.get(anchor.wayId) ?? []) {
      if (reaches(service, anchor.wayId, stop.coord)) servingServices.add(service);
    }
  }
  return [...new Set([...servingServices].map((service) => service.modeId))].sort();
}

function projectionModeIds(
  system: TransitSystem,
  view: RenderViewOptions,
  prepared: RenderPreparedSnapshot | undefined,
): Set<string> {
  if (!view.styleDeferredVisibility) return view.visibleModes;
  return (prepared?.modeIds as Set<string> | undefined) ?? allModeIds(system.services);
}

function projectionWayTypeIds(
  system: TransitSystem,
  view: RenderViewOptions,
  prepared: RenderPreparedSnapshot | undefined,
): Set<string> {
  if (!view.styleDeferredVisibility) return view.visibleWayTypes;
  return (prepared?.wayTypeIds as Set<string> | undefined) ?? allWayTypeIds(system.ways);
}

function projectionWaysById(
  system: TransitSystem,
  projection: FeatureProjectionPlan,
  prepared: RenderPreparedSnapshot | undefined,
): Map<string, Way> {
  if (!projection.dependencies.wayIndex) return new Map<string, Way>();
  return (prepared?.waysById ?? wayById(system.ways)) as Map<string, Way>;
}

interface ServiceProjectionIndexes {
  visible: Map<string, Service[]>;
  all: Map<string, Service[]>;
}

interface ProjectionServicesByWayOptions {
  system: TransitSystem;
  view: RenderViewOptions;
  projection: FeatureProjectionPlan;
  prepared: RenderPreparedSnapshot | undefined;
  projectedModeIds: Set<string>;
}

function projectionServicesByWay({
  system,
  view,
  projection,
  prepared,
  projectedModeIds,
}: ProjectionServicesByWayOptions): ServiceProjectionIndexes {
  if (!projection.dependencies.serviceIndex) {
    return { visible: new Map<string, Service[]>(), all: new Map<string, Service[]>() };
  }
  const preparedIndex = prepared?.servicesByWay as Map<string, Service[]> | undefined;
  const visible =
    view.styleDeferredVisibility && preparedIndex
      ? preparedIndex
      : servicesByWay(system.services, projectedModeIds);
  return {
    visible,
    all: preparedIndex ?? servicesByWay(system.services, allModeIds(system.services)),
  };
}

function projectionDomainIndex<T>(
  enabled: boolean,
  prepared: ReadonlyMap<string, T> | undefined,
  fallback: () => ReadonlyMap<string, T>,
): ReadonlyMap<string, T> {
  return enabled ? (prepared ?? fallback()) : new Map<string, T>();
}

function projectionServiceSlots(
  projection: FeatureProjectionPlan,
  prepared: RenderPreparedSnapshot | undefined,
  servicesByWayIndex: Map<string, Service[]>,
): Map<string, number> {
  if (!projection.topology.services) return new Map<string, number>();
  return prepared
    ? (prepared.serviceBundleSlots as Map<string, number>)
    : bundleSlots(servicesByWayIndex);
}

function buildSharedProjectionIndexes(
  system: TransitSystem,
  view: RenderViewOptions,
  projection: FeatureProjectionPlan,
  preparedSnapshot: RenderPreparedSnapshot | undefined,
): SharedProjectionIndexes {
  const prepared = preparedSnapshot?.system === system ? preparedSnapshot : undefined;
  const projectedModeIds = projectionModeIds(system, view, prepared);
  const projectedWayTypeIds = projectionWayTypeIds(system, view, prepared);
  // These consumers only call ReadonlyMap operations. Their historical Map
  // signatures predate copy-on-write preparation and must not force a full
  // materialization merely to satisfy a wider type.
  const waysById = projectionWaysById(system, projection, prepared);
  const serviceIndexes = projectionServicesByWay({
    system,
    view,
    projection,
    prepared,
    projectedModeIds,
  });

  return {
    waysById,
    nodesById: projectionDomainIndex(projection.junctions.needsGeometry, prepared?.nodesById, () =>
      renderNodesById(system.nodes),
    ),
    stopsById: projectionDomainIndex(projection.stops, prepared?.stopsById, () =>
      renderStopsById(system.stops),
    ),
    stationsById: projectionDomainIndex(projection.physical.enabled, prepared?.stationsById, () =>
      renderStationsById(system.stations),
    ),
    namedWaysById: projectionDomainIndex(projection.wayLabels, prepared?.namedWaysById, () =>
      renderNamedWaysById(system.namedWays),
    ),
    facilitiesById: projectionDomainIndex(projection.facilities, prepared?.facilitiesById, () =>
      renderFacilitiesById(system.facilities),
    ),
    groupsById: projectionDomainIndex(projection.physical.enabled, prepared?.groupsById, () =>
      renderGroupsById(system.groups),
    ),
    servicesById: projectionDomainIndex(projection.serviceTermini, prepared?.servicesById, () =>
      renderServicesById(system.services),
    ),
    linesByServiceId: linesByServiceId(system.lines),
    servicesByWay: serviceIndexes.visible,
    allServicesByWay: serviceIndexes.all,
    projectedWayTypeIds,
    serviceSlots: projectionServiceSlots(projection, prepared, serviceIndexes.visible),
    wayIdsByStop: prepared?.wayIdsByStop,
  };
}

function projectStops(
  system: TransitSystem,
  stops: TransitSystem['stops'],
  indexes: SharedProjectionIndexes,
  counts: FeatureBuildOperationCounts | undefined,
): Feature<Point>[] {
  if (counts) counts.featureStopPassCount++;
  // The interchange scan (servedWayIds per stop) is the single most expensive
  // part of this function at RTC scale — memoized on (stops, visibleWays) so a
  // selection/viewport rebuild reuses it instead of re-scanning every boarding point.
  const preparedWayIds = indexes.wayIdsByStop;
  let nearWaysByStop: string[][];
  let allNearWaysByStop: string[][];
  if (preparedWayIds) {
    nearWaysByStop = stops.map((stop) =>
      (preparedWayIds.get(stop.id) ?? []).filter((wayId) => {
        const way = indexes.waysById.get(wayId);
        return way ? indexes.projectedWayTypeIds.has(way.typeId) : false;
      }),
    );
    allNearWaysByStop = stops.map((stop) => [...(preparedWayIds.get(stop.id) ?? [])]);
  } else {
    const visibleWays = visibleWaysFor(system.ways, indexes.projectedWayTypeIds);
    nearWaysByStop = nearWaysForStops(stops, visibleWays);
    const everyWay = visibleWaysFor(system.ways, allWayTypeIds(system.ways));
    allNearWaysByStop =
      everyWay === visibleWays ? nearWaysByStop : nearWaysForStops(stops, everyWay);
  }
  // `servicesByWay` reports every service that touches a way, which over-reports
  // once a service can cover only part of one. Test only services encountered
  // by this station batch; scanning the complete document in every resumable
  // unit would turn bounded station work back into whole-scene preparation.
  const reaches = (service: Service, wayId: string, coord: LngLat): boolean => {
    if (!cachedServiceHasPartialLeg(service)) return true;
    const way = indexes.waysById.get(wayId);
    if (!way) return true;
    const near = nearestOnPath(resolveWayPath(way), coord);
    return near ? serviceCoversWayAt(service, wayId, near.t) : true;
  };

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
    const servedModeIds = servedModeIdsForStop({
      stop,
      nearbyWayIds: allNearWaysByStop[stopIndex],
      servicesByWay: indexes.allServicesByWay,
      reaches,
    });
    const foregroundService = anchorServices.at(0) ?? servingServices.at(0);
    const color = foregroundService
      ? serviceDisplayColor(foregroundService, indexes.linesByServiceId)
      : NEUTRAL_STATION;
    const interchange = servingServices.length > 1;
    return {
      type: 'Feature',
      id: stableFeatureId('stops', 'stop', stop.id),
      properties: {
        id: stop.id,
        color,
        interchange,
        // Major and interchange labels enter at a lower zoom than ordinary
        // stops, avoiding thousands of simultaneous collision candidates.
        major: interchange || stop.majorStop === true,
        servedModeIds,
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
  candidateHandleIds: readonly string[] | undefined,
): Feature<Point>[] {
  const candidateIdSet = candidateHandleIds ? new Set(candidateHandleIds) : undefined;
  const visibleHandleWayIds = candidateIdSet
    ? handleWayIds.filter((wayId) => {
        const way = indexes.waysById.get(wayId);
        return way?.points.some((_, pointIndex) =>
          candidateIdSet.has(wayControlPointRenderId(wayId, pointIndex)),
        );
      })
    : handleWayIds;
  if (counts) {
    counts.featureHandlePassCount++;
    counts.featureHandleWayVisitCount += visibleHandleWayIds.length;
  }
  return buildHandles(indexes.waysById, visibleHandleWayIds, candidateIdSet);
}

interface ProjectServiceTerminiOptions {
  selection: Highlight;
  indexes: SharedProjectionIndexes;
  activePatternId: string | null | undefined;
  armedTerminus: BuildFeaturesOptions['armedTerminus'];
  affectedServiceIds?: ReadonlySet<string>;
  candidateTerminusIds?: ReadonlySet<string>;
}

interface ProjectServiceTerminusFeatureOptions {
  service: Service;
  descriptor: ServiceTerminusDescriptor;
  indexes: SharedProjectionIndexes;
  armedTerminus: BuildFeaturesOptions['armedTerminus'];
  candidateTerminusIds?: ReadonlySet<string>;
}

type ProjectedServiceTerminusFeature = Feature<Point> & {
  properties: Record<string, unknown>;
};

function projectServiceTerminusFeature({
  service,
  descriptor,
  indexes,
  armedTerminus,
  candidateTerminusIds,
}: ProjectServiceTerminusFeatureOptions): ProjectedServiceTerminusFeature | null {
  if (candidateTerminusIds && !candidateTerminusIds.has(descriptor.id)) return null;
  const terminus = resolveServiceTerminus(descriptor, indexes.waysById);
  if (!terminus) return null;
  return {
    type: 'Feature',
    id: terminus.id,
    properties: {
      serviceId: service.id,
      patternId: terminus.patternId,
      side: terminus.side,
      modeId: service.modeId,
      interactive: false,
      ...(armedTerminus?.serviceId === service.id &&
      armedTerminus.patternId === terminus.patternId &&
      armedTerminus.side === terminus.side
        ? { armedReturn: true }
        : {}),
    },
    geometry: { type: 'Point', coordinates: terminus.coord },
  };
}

function projectServiceTermini({
  selection,
  indexes,
  activePatternId,
  armedTerminus,
  affectedServiceIds,
  candidateTerminusIds,
}: ProjectServiceTerminiOptions): Feature<Point>[] {
  if (selection?.kind !== 'service') return [];
  if (affectedServiceIds && !affectedServiceIds.has(selection.id)) return [];
  const service = indexes.servicesById.get(selection.id);
  if (!service) return [];
  const interactivePatternId =
    service.path.id === activePatternId ? activePatternId : service.path.id;
  const pending: ProjectedServiceTerminusFeature[] = [];
  for (const descriptor of serviceTerminusDescriptors(service)) {
    const feature = projectServiceTerminusFeature({
      service,
      descriptor,
      indexes,
      armedTerminus,
      candidateTerminusIds,
    });
    if (feature) pending.push(feature);
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
  indexes: SharedProjectionIndexes;
  projection: PhysicalProjection;
  network: boolean;
  physicalHandleStationId: string | null;
  physicalHandleGroupId: string | null;
  counts: FeatureBuildOperationCounts | undefined;
  candidateStations?: readonly TransitSystem['stations'][number][];
  candidateGroups?: readonly TransitSystem['groups'][number][];
  candidatePhysicalHandleIds?: readonly string[];
  entityScoped: boolean;
}

interface PhysicalHandleOwnersOptions {
  indexes: SharedProjectionIndexes;
  projection: PhysicalProjection;
  physicalHandleStationId: string | null;
  physicalHandleGroupId: string | null;
  counts: FeatureBuildOperationCounts | undefined;
  candidateStations?: readonly TransitSystem['stations'][number][];
  candidateGroups?: readonly TransitSystem['groups'][number][];
  entityScoped: boolean;
}

interface PhysicalHandleOwners {
  station: TransitSystem['stations'][number] | null;
  group: TransitSystem['groups'][number] | null;
}

function selectedPhysicalStation(
  indexes: SharedProjectionIndexes,
  stationId: string | null,
  candidates: readonly TransitSystem['stations'][number][] | undefined,
): TransitSystem['stations'][number] | null {
  if (!stationId) return null;
  const candidateIds = candidates ? new Set(candidates.map((station) => station.id)) : null;
  if (candidateIds && !candidateIds.has(stationId)) return null;
  return indexes.stationsById.get(stationId) ?? null;
}

function selectedPhysicalGroup(
  indexes: SharedProjectionIndexes,
  groupId: string | null,
  candidates: readonly TransitSystem['groups'][number][] | undefined,
  entityScoped: boolean,
): TransitSystem['groups'][number] | null {
  if (!groupId || entityScoped) return null;
  const candidateIds = candidates ? new Set(candidates.map((group) => group.id)) : null;
  if (candidateIds && !candidateIds.has(groupId)) return null;
  return indexes.groupsById.get(groupId) ?? null;
}

function physicalHandleOwners({
  indexes,
  projection,
  physicalHandleStationId,
  physicalHandleGroupId,
  counts,
  candidateStations,
  candidateGroups,
  entityScoped,
}: PhysicalHandleOwnersOptions): PhysicalHandleOwners {
  const station = selectedPhysicalStation(indexes, physicalHandleStationId, candidateStations);
  if (counts && station && !projection.footprints && !projection.platforms) {
    counts.featurePhysicalStationVisitCount++;
  }
  const group = selectedPhysicalGroup(
    indexes,
    physicalHandleGroupId,
    candidateGroups,
    entityScoped,
  );
  if (counts && group && !projection.footprints) {
    counts.featurePhysicalGroupVisitCount++;
  }
  return { station, group };
}

interface PhysicalSurfaceProjection {
  footprints: Feature<Polygon>[];
  platforms: Feature<Polygon>[];
}

function projectStationPhysicalSurfaces(
  stations: readonly TransitSystem['stations'][number][],
  projection: PhysicalProjection,
  counts: FeatureBuildOperationCounts | undefined,
): PhysicalSurfaceProjection {
  const footprints: Feature<Polygon>[] = [];
  const platforms: Feature<Polygon>[] = [];
  for (const station of stations) {
    if (counts) counts.featurePhysicalStationVisitCount++;
    if (projection.footprints && station.footprint) {
      footprints.push({
        type: 'Feature',
        id: stableFeatureId('footprints', 'station', station.id),
        properties: { stationId: station.id },
        geometry: { type: 'Polygon', coordinates: [closeRing(station.footprint)] },
      });
    }
    if (!projection.platforms) continue;
    for (const platform of station.platforms ?? []) {
      platforms.push({
        type: 'Feature',
        id: stableFeatureId('platforms', 'station-platform', station.id, platform.id),
        properties: { stationId: station.id, platformId: platform.id },
        geometry: { type: 'Polygon', coordinates: [closeRing(platform.points)] },
      });
    }
  }
  return { footprints, platforms };
}

function projectGroupFootprints(
  groups: readonly TransitSystem['groups'][number][],
  counts: FeatureBuildOperationCounts | undefined,
): Feature<Polygon>[] {
  const footprints: Feature<Polygon>[] = [];
  for (const group of groups) {
    if (counts) counts.featurePhysicalGroupVisitCount++;
    if (!group.footprint) continue;
    footprints.push({
      type: 'Feature',
      id: stableFeatureId('footprints', 'group', group.id),
      properties: { groupId: group.id, ...(group.color ? { color: group.color } : {}) },
      geometry: { type: 'Polygon', coordinates: [closeRing(group.footprint)] },
    });
  }
  return footprints;
}

interface ProjectPhysicalSurfacesOptions {
  system: TransitSystem;
  projection: PhysicalProjection;
  counts: FeatureBuildOperationCounts | undefined;
  candidateStations: readonly TransitSystem['stations'][number][] | undefined;
  candidateGroups: readonly TransitSystem['groups'][number][] | undefined;
  entityScoped: boolean;
}

function projectPhysicalSurfaces({
  system,
  projection,
  counts,
  candidateStations,
  candidateGroups,
  entityScoped,
}: ProjectPhysicalSurfacesOptions): PhysicalSurfaceProjection {
  if (!projection.footprints && !projection.platforms) return { footprints: [], platforms: [] };
  const surfaces = projectStationPhysicalSurfaces(
    candidateStations ?? system.stations,
    projection,
    counts,
  );
  if (projection.footprints && !entityScoped) {
    surfaces.footprints.push(...projectGroupFootprints(candidateGroups ?? system.groups, counts));
  }
  return surfaces;
}

function projectPhysicalFeatures({
  system,
  indexes,
  projection,
  network,
  physicalHandleStationId,
  physicalHandleGroupId,
  counts,
  candidateStations,
  candidateGroups,
  candidatePhysicalHandleIds,
  entityScoped,
}: ProjectPhysicalFeaturesOptions): PhysicalProjectionResult {
  if (counts) counts.featurePhysicalPassCount++;
  if (network) return { footprints: [], platforms: [], handles: [] };
  const { footprints, platforms } = projectPhysicalSurfaces({
    system,
    projection,
    counts,
    candidateStations,
    candidateGroups,
    entityScoped,
  });

  if (!projection.handles) return { footprints, platforms, handles: [] };

  const owners = physicalHandleOwners({
    indexes,
    projection,
    physicalHandleStationId,
    physicalHandleGroupId,
    counts,
    candidateStations,
    candidateGroups,
    entityScoped,
  });

  return {
    footprints,
    platforms,
    handles: buildPhysicalHandles(
      owners.station,
      owners.group,
      candidatePhysicalHandleIds ? new Set(candidatePhysicalHandleIds) : undefined,
    ),
  };
}

interface ProjectWayLabelsOptions {
  system: TransitSystem;
  indexes: SharedProjectionIndexes;
  network: boolean;
  presentation: RenderPresentation;
  counts: FeatureBuildOperationCounts | undefined;
  candidateNamedWayIds?: readonly string[];
  candidateWayIds?: ReadonlySet<string>;
  candidateLabelDependencyIds?: ReadonlySet<string>;
}

interface NamedWayProjectionOptions {
  namedWay: TransitSystem['namedWays'][number];
  indexes: SharedProjectionIndexes;
  presentation: RenderPresentation;
  candidateWayIds?: ReadonlySet<string>;
  candidateLabelDependencyIds?: ReadonlySet<string>;
}

function projectNamedWayLabels({
  namedWay,
  indexes,
  presentation,
  candidateWayIds,
  candidateLabelDependencyIds,
}: NamedWayProjectionOptions): Feature<LineString>[] {
  if (!namedWay.name) return [];
  const labels: Feature<LineString>[] = [];
  for (const wayId of namedWay.wayIds) {
    if (candidateWayIds && !candidateWayIds.has(wayId)) continue;
    const labelDependencyId = namedWayLabelDependencyId(namedWay.id, wayId);
    if (candidateLabelDependencyIds && !candidateLabelDependencyIds.has(labelDependencyId)) {
      continue;
    }
    const way = indexes.waysById.get(wayId);
    if (!way || !indexes.projectedWayTypeIds.has(way.typeId)) continue;
    const path = renderedWayPath(way, presentation);
    if (path.length < 2) continue;
    labels.push({
      type: 'Feature',
      id: stableFeatureId('wayLabels', 'named-way-member', namedWay.id, wayId),
      properties: {
        name: namedWay.name,
        namedWayId: namedWay.id,
        wayId,
        typeId: way.typeId,
        labelDependencyId,
      },
      geometry: { type: 'LineString', coordinates: path },
    });
  }
  return labels;
}

function projectWayLabels({
  system,
  indexes,
  network,
  presentation,
  counts,
  candidateNamedWayIds,
  candidateWayIds,
  candidateLabelDependencyIds,
}: ProjectWayLabelsOptions): Feature<LineString>[] {
  if (counts) counts.featureWayLabelPassCount++;
  if (network) return [];

  const labels: Feature<LineString>[] = [];
  const candidateNamedWays = orderedIndexedValues(
    system.namedWays,
    indexes.namedWaysById,
    candidateNamedWayIds,
  );
  for (const namedWay of candidateNamedWays) {
    if (counts) counts.featureNamedWayVisitCount++;
    labels.push(
      ...projectNamedWayLabels({
        namedWay,
        indexes,
        presentation,
        candidateWayIds,
        candidateLabelDependencyIds,
      }),
    );
  }
  return labels;
}

interface ProjectFacilitiesOptions {
  system: TransitSystem;
  indexes: SharedProjectionIndexes;
  network: boolean;
  counts: FeatureBuildOperationCounts | undefined;
  candidateFacilityIds?: readonly string[];
}

function projectFacilities({
  system,
  indexes,
  network,
  counts,
  candidateFacilityIds,
}: ProjectFacilitiesOptions): Feature<Point>[] {
  if (counts) counts.featureFacilityPassCount++;
  if (network) return [];

  return orderedIndexedValues(system.facilities, indexes.facilitiesById, candidateFacilityIds).map(
    (facility) => {
      if (counts) counts.featureFacilityVisitCount++;
      const render = facilityRender(facility.typeId);
      return {
        type: 'Feature',
        id: stableFeatureId('facilities', 'facility', facility.id),
        properties: {
          id: facility.id,
          typeId: facility.typeId,
          color: render.color,
          radius: render.radius,
          icon: iconName(render.icon, render.color),
          name: facility.name ?? '',
        },
        geometry: { type: 'Point', coordinates: facilityRenderCoordinate(facility) },
      };
    },
  );
}

interface TopologyProjectionResult {
  ways: Feature<LineString | Polygon>[];
  services: Feature<LineString>[];
  lanes: Feature<Polygon>[];
  laneMarkings: Feature<LineString | MultiLineString>[];
  laneArrows: Feature<LineString>[];
  serviceArrows: Feature<LineString>[];
  junctions: Feature<Polygon | Point>[];
  connectors: Feature<LineString>[];
}

/** Properties shared by a physical junction surface, its control marker, and
 * approach markings. They must enter and leave Street detail together. */
interface JunctionPaintMetadata {
  typeIds: string[];
  corridorW14: number;
  tierOpacity: number;
}

/**
 * The presentation chosen for one service run at one lane endpoint.
 *
 * A junction connector is a separate path, but it must inherit the same
 * Street-tier width and within-lane separation as the trimmed path it joins.
 * Keeping this small record while lanes are emitted avoids a second pattern
 * traversal solely to restyle the connector afterwards.
 */
interface StreetServiceEndpointPaint {
  service: Service;
  way: Way;
  corridor: CorridorRenderPresentation;
  laneW14: number;
  offset: number;
}

/** A service run may use different lanes on the two sides of a junction.
 * This is the stable lookup identity for the already-emitted lane endpoint. */
function streetServiceEndpointPaintKey(
  serviceId: string,
  run: RunDirection,
  wayId: string,
  laneId: string,
): string {
  return `${serviceId}\u001f${run}\u001f${wayId}\u001f${laneId}`;
}

interface AppendStreetServiceJunctionConnectorsOptions {
  services: Feature<LineString>[];
  serviceHits: Feature<LineString>[];
  indexes: SharedProjectionIndexes;
  waysById: Map<string, Way>;
  wayTrims: WayTrims;
  nodes: readonly TransitSystem['nodes'][number][];
  endpointPaint: ReadonlyMap<string, StreetServiceEndpointPaint>;
  turnRestrictions: TransitSystem['turnRestrictions'];
}

interface AppendStreetServiceJunctionConnectorOptions {
  services: Feature<LineString>[];
  serviceHits: Feature<LineString>[];
  indexes: SharedProjectionIndexes;
  connector: ServiceJunctionConnector;
  from: StreetServiceEndpointPaint;
  to: StreetServiceEndpointPaint;
}

/** Write the matching visible and hit records for one physical lane turn.
 *
 * The pair intentionally shares one geometry object: its stable identity and
 * exact endpoint coordinates must agree for paint, hit testing, and source
 * updates. The collector above decides whether the turn is visible; this
 * helper only serializes that accepted turn into the two renderer surfaces.
 */
function appendStreetServiceJunctionConnector({
  services,
  serviceHits,
  indexes,
  connector,
  from,
  to,
}: AppendStreetServiceJunctionConnectorOptions): void {
  const properties = {
    serviceId: connector.serviceId,
    nodeId: connector.nodeId,
    modeId: from.service.modeId,
    wayId: from.way.id,
    typeId: from.way.typeId,
    color: serviceDisplayColor(from.service, indexes.linesByServiceId),
    width: modeRender(from.service.modeId).width,
    ...gradeFlags(from.way.grade),
    // A line-offset follows the turn's normal. The incoming separation is
    // therefore the stable choice until connector geometry carries a
    // per-vertex offset for multiple services sharing one lane.
    offset: from.offset,
    w14: Math.max(from.laneW14, to.laneW14),
    corridorW14: widthPxAtZ14(profileWidthM(from.way.profile), from.way.points[0]?.[1] ?? 0),
    renderTier: 'street',
    tierOpacity: from.corridor.blend.weights.street,
    ...tierAvailabilityProperties(from.corridor, from.corridor.retainedTiers),
    pathRole: `junction:${connector.nodeId}`,
  };
  const geometry = { type: 'LineString' as const, coordinates: [...connector.path] };
  const paintIdentity = [
    connector.serviceId,
    connector.run,
    connector.nodeId,
    connector.from.wayId,
    connector.from.laneId,
    connector.to.wayId,
    connector.to.laneId,
  ] as const;
  services.push({
    type: 'Feature',
    id: stableFeatureId('services', 'junction-connector', ...paintIdentity),
    properties: { ...properties, hitTarget: false },
    geometry,
  });
  serviceHits.push({
    type: 'Feature',
    id: stableFeatureId('services', 'hit-junction-connector', ...paintIdentity),
    properties: {
      ...properties,
      patternId: from.service.path.id,
      run: connector.run,
      hitTarget: true,
    },
    geometry,
  });
}

/**
 * Adds the committed service path inside each visible Street junction.
 *
 * The lane pass owns the long trimmed stretches and leaves a compact record
 * of their resolved visual treatment. This step owns only the connection
 * between those endpoints. Keeping the two phases separate makes it explicit
 * that editor movement guides are not a second source of settled geometry.
 */
function appendStreetServiceJunctionConnectors({
  services,
  serviceHits,
  indexes,
  waysById,
  wayTrims,
  nodes,
  endpointPaint,
  turnRestrictions,
}: AppendStreetServiceJunctionConnectorsOptions): void {
  // The preceding lane pass is already scope and viewport aware. Reusing its
  // endpoint records means this phase never scans a hidden or unaffected
  // service merely to discover that no drawable connector can use it.
  const visibleServices = [
    ...new Map(
      [...endpointPaint.values()].map(({ service }) => [service.id, service] as const),
    ).values(),
  ];
  for (const connector of serviceJunctionConnectors({
    services: visibleServices,
    nodes,
    waysById,
    trims: wayTrims,
    turnRestrictions,
  })) {
    const from = endpointPaint.get(
      streetServiceEndpointPaintKey(
        connector.serviceId,
        connector.run,
        connector.from.wayId,
        connector.from.laneId,
      ),
    );
    const to = endpointPaint.get(
      streetServiceEndpointPaintKey(
        connector.serviceId,
        connector.run,
        connector.to.wayId,
        connector.to.laneId,
      ),
    );
    if (!from || !to || !from.corridor.retainedTiers.includes('street')) continue;
    appendStreetServiceJunctionConnector({
      services,
      serviceHits,
      indexes,
      connector,
      from,
      to,
    });
  }
}

interface ProjectTopologyFeaturesOptions {
  system: TransitSystem;
  selection: Highlight;
  view: RenderViewOptions;
  projection: FeatureProjectionPlan;
  indexes: SharedProjectionIndexes;
  network: boolean;
  counts: FeatureBuildOperationCounts | undefined;
  candidateWayIds?: readonly string[];
  candidateGeometryNodeIds?: readonly string[];
  physicalWayIds?: ReadonlySet<string>;
  serviceWayIds?: ReadonlySet<string>;
  affectedServiceIds?: ReadonlySet<string>;
  junctionOutputNodeIds?: ReadonlySet<string>;
  connectorOutputNodeIds?: ReadonlySet<string>;
}

interface CorridorRenderPresentation extends RenderTierResolution {
  displayedWidthPx: number;
  corridorDisplayW14: number;
}

interface TierAvailabilityProperties {
  projectedWidthPx: number;
  corridorDisplayW14: number;
  hasOverviewTier: boolean;
  hasDistrictTier: boolean;
  hasStreetTier: boolean;
}

interface EmitCorridorTiersOptions {
  way: TransitSystem['ways'][number];
  path: LngLat[];
  color: string;
  width: number;
  dashed: boolean;
  presentation: CorridorRenderPresentation;
  availableTiers: readonly RenderTier[];
}

interface UnservedCorridorProjectionOptions {
  way: Way;
  style: RenderStyle;
  projectPhysicalWay: boolean;
  network: boolean;
  laneDetail: boolean;
  projectWays: boolean;
  needsLaneGeometry: boolean;
}

interface UnservedCorridorProjection {
  color: string;
  width: number;
  dashed: boolean;
  emitCorridor: boolean;
  emitLaneGeometry: boolean;
}

/** Resolve the output required for physical infrastructure without an assigned
 * service. Keeping this branch pure makes its lane/corridor policy explicit
 * without nesting another rendering decision inside the topology traversal. */
function resolveUnservedCorridorProjection({
  way,
  style,
  projectPhysicalWay,
  network,
  laneDetail,
  projectWays,
  needsLaneGeometry,
}: UnservedCorridorProjectionOptions): UnservedCorridorProjection | null {
  if (!projectPhysicalWay || network) return null;
  if (!laneDetail && !projectWays) return null;

  const unassigned = UNASSIGNED_FAMILIES.has(wayType(way.typeId).family);
  return {
    color: unassigned ? UNASSIGNED_COLOR : style.color,
    width: unassigned ? UNASSIGNED_WIDTH : style.width,
    dashed: unassigned || !!style.dashed,
    emitCorridor: projectWays,
    emitLaneGeometry: laneDetail && needsLaneGeometry,
  };
}

function staticTierResolution(displayedWidthPx: number): RenderTierResolution {
  const blend = renderTierBlend(displayedWidthPx);
  return {
    logicalTier: selectRenderTier(displayedWidthPx),
    blend,
    retainedTiers: blend.activeTiers,
    transitioned: false,
  };
}

function tierAvailabilityProperties(
  presentation: CorridorRenderPresentation,
  availableTiers: readonly RenderTier[],
): TierAvailabilityProperties {
  return {
    projectedWidthPx: presentation.displayedWidthPx,
    corridorDisplayW14: presentation.corridorDisplayW14,
    hasOverviewTier: availableTiers.includes('overview'),
    hasDistrictTier: availableTiers.includes('district'),
    hasStreetTier: availableTiers.includes('street'),
  };
}

interface RailMarkingProjection {
  laneMarkings: Feature<LineString | MultiLineString>[];
  way: Pick<Way, 'id' | 'typeId'>;
  lane: LanePath;
  color: string;
  corridorW14: number;
  tierOpacity: number;
  availability: TierAvailabilityProperties;
  tieSpacingM: number;
}

/** Add rail hardware as three stable features: two rails and one compact tie
 * collection. Keeping it out of the topology loop makes that loop responsible
 * only for deciding *which* detail is visible, not for constructing it. */
function appendRailMarkings({
  laneMarkings,
  way,
  lane,
  color,
  corridorW14,
  tierOpacity,
  availability,
  tieSpacingM,
}: RailMarkingProjection): void {
  const detail = railTrackGeometry(lane, tieSpacingM);
  detail.rails.forEach((coordinates, railIndex) => {
    laneMarkings.push({
      type: 'Feature',
      id: stableFeatureId('laneMarkings', 'rail', way.id, lane.laneId, railIndex),
      properties: {
        wayId: way.id,
        typeId: way.typeId,
        laneId: lane.laneId,
        kind: 'rail',
        color,
        corridorW14,
        renderTier: 'street',
        tierOpacity,
        ...availability,
      },
      geometry: { type: 'LineString', coordinates },
    });
  });
  if (detail.ties.length === 0) return;
  laneMarkings.push({
    type: 'Feature',
    id: stableFeatureId('laneMarkings', 'rail-ties', way.id, lane.laneId),
    properties: {
      wayId: way.id,
      typeId: way.typeId,
      laneId: lane.laneId,
      kind: 'railTie',
      color,
      corridorW14,
      renderTier: 'street',
      tierOpacity,
      ...availability,
    },
    geometry: { type: 'MultiLineString', coordinates: detail.ties },
  });
}

interface StreetMarkingProjection {
  laneMarkings: Feature<LineString | MultiLineString>[];
  way: Pick<Way, 'id' | 'typeId'>;
  geometry: WayLaneGeometry;
  corridorW14: number;
  tierOpacity: number;
  availability: TierAvailabilityProperties;
  tieSpacingM: number;
}

/** Emit all paint-on-top-of-the-surface detail for one cross-section. Lane
 * polygons, service paths, and topology traversal deliberately stay with the
 * caller; this owns only rails and painted lane boundaries. */
function appendStreetMarkings({
  laneMarkings,
  way,
  geometry,
  corridorW14,
  tierOpacity,
  availability,
  tieSpacingM,
}: StreetMarkingProjection): void {
  for (const lane of geometry.lanes) {
    const render = laneRender(lane.kindId);
    if (render.surface) continue;
    if (lane.kindId === 'track' && way.typeId !== 'monorail') {
      appendRailMarkings({
        laneMarkings,
        way,
        lane,
        color: render.color,
        corridorW14,
        tierOpacity,
        availability,
        tieSpacingM,
      });
      continue;
    }
    laneMarkings.push({
      type: 'Feature',
      id: stableFeatureId('laneMarkings', 'thin-lane', way.id, lane.laneId),
      properties: {
        wayId: way.id,
        typeId: way.typeId,
        laneId: lane.laneId,
        kind: 'thinLane',
        color: render.color,
        corridorW14,
        renderTier: 'street',
        tierOpacity,
        ...availability,
      },
      geometry: { type: 'LineString', coordinates: lane.path },
    });
  }
  for (const divider of geometry.dividers) {
    laneMarkings.push({
      type: 'Feature',
      id: stableFeatureId(
        'laneMarkings',
        'boundary',
        way.id,
        divider.beforeLaneId,
        divider.afterLaneId,
      ),
      properties: {
        wayId: way.id,
        typeId: way.typeId,
        beforeLaneId: divider.beforeLaneId,
        afterLaneId: divider.afterLaneId,
        kind: divider.kind,
        corridorW14,
        renderTier: 'street',
        tierOpacity,
        ...availability,
      },
      geometry: { type: 'LineString', coordinates: divider.path },
    });
  }
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
  candidateWayIds,
  candidateGeometryNodeIds,
  physicalWayIds,
  serviceWayIds,
  affectedServiceIds,
  junctionOutputNodeIds,
}: ProjectTopologyFeaturesOptions): TopologyProjectionResult {
  const selId = selection?.id ?? null;
  const { waysById, servicesByWay: byWay, serviceSlots: slots } = indexes;

  const presentationByWay = new Map<string, CorridorRenderPresentation>();
  const corridorPresentation = (way: TransitSystem['ways'][number]): CorridorRenderPresentation => {
    const cached = presentationByWay.get(way.id);
    if (cached) return cached;
    let corridorDisplayW14 = 0;
    const presentation = view.presentation;
    if (!network) {
      const latitude = way.points[0]?.[1] ?? 0;
      const viewportScale = Math.min(
        presentation.displayedWidthPx / presentation.viewportWidthPx,
        presentation.displayedHeightPx / presentation.viewportHeightPx,
      );
      corridorDisplayW14 = widthPxAtZ14(profileWidthM(way.profile), latitude) * viewportScale;
    }
    const displayedWidthPx = corridorDisplayW14 * 2 ** (presentation.zoom - 14);
    const resolution =
      !network && view.tierStateResolver
        ? view.tierStateResolver.resolve(system.id, way.id, displayedWidthPx)
        : staticTierResolution(displayedWidthPx);
    if (counts && resolution.transitioned) counts.featureTierTransitionCount++;
    const result = { ...resolution, displayedWidthPx, corridorDisplayW14 };
    presentationByWay.set(way.id, result);
    return result;
  };

  // Overview is one hierarchy-aware silhouette per corridor. District adds a
  // physical-width footprint using the same centerline. Neither feature count
  // depends on the number of lanes: fine cross-section geometry is generated
  // only for the Street tier below.
  const emitCorridorTiers = ({
    way,
    path,
    color,
    width,
    dashed,
    presentation,
    availableTiers,
  }: EmitCorridorTiersOptions) => {
    if (!projection.topology.ways) return;
    const latitude = way.points[0]?.[1] ?? 0;
    const corridorW14 = widthPxAtZ14(profileWidthM(way.profile), latitude);
    const availability = tierAvailabilityProperties(presentation, availableTiers);
    const grade = network ? { underground: false, elevated: false } : gradeFlags(way.grade);
    for (const renderTier of availableTiers) {
      if (renderTier === 'street') continue;
      const geometry =
        renderTier === 'district' && !grade.underground && !dashed
          ? {
              type: 'Polygon' as const,
              coordinates: [corridorSurfaceRing(path, profileWidthM(way.profile))],
            }
          : { type: 'LineString' as const, coordinates: path };
      ways.push({
        type: 'Feature',
        id: stableFeatureId('ways', renderTier, way.id),
        properties: {
          id: way.id,
          typeId: way.typeId,
          color,
          width,
          corridorW14,
          dashed: dashed || grade.underground,
          ...grade,
          offset: 0,
          renderTier,
          tierOpacity: presentation.blend.weights[renderTier],
          ...availability,
        },
        geometry,
      });
    }
  };

  const ways: Feature<LineString | Polygon>[] = [];
  const services: Feature<LineString>[] = [];
  const serviceHits: Feature<LineString>[] = [];
  const lanes: Feature<Polygon>[] = [];
  const laneMarkings: Feature<LineString | MultiLineString>[] = [];
  const laneArrows: Feature<LineString>[] = [];
  const serviceArrows: Feature<LineString>[] = [];
  const streetServiceEndpointPaint = new Map<string, StreetServiceEndpointPaint>();

  const attributedLaneGeometry = (
    way: TransitSystem['ways'][number],
    trimStartM: number,
    trimEndM: number,
  ) => {
    const resolved = resolveWayLaneGeometry(
      way,
      trimStartM,
      trimEndM,
      metricErrorForDisplayedPixels(
        view.presentation,
        way.points[0]?.[1] ?? 0,
        DISPLAYED_CURVE_ERROR_PX,
      ),
    );
    if (counts) {
      if (resolved.cacheHit) counts.featureLaneGeometryCacheHitCount++;
      else counts.featureLaneGeometryBuildCount++;
    }
    return resolved.geometry;
  };

  // True-scale per-lane rendering for one way: lane surfaces carry their real
  // metric geometry, while corridorW14 keeps their LOD fade aligned with the
  // corridor they replace. It also emits dividers, thin-line lanes (tracks),
  // and direction arrows. This replaces the emitCrossSection fan at Street
  // detail without reintroducing a screen-space lane-width approximation.
  const emitLaneDetail = (way: TransitSystem['ways'][number]) => {
    // wayTrims is populated by the junction pass below before any call here.
    const trims = wayTrims.get(way.id) ?? { start: 0, end: 0 };
    const g = attributedLaneGeometry(way, trims.start, trims.end);
    const lat = way.points[0]?.[1] ?? 36;
    const corridorW14 = widthPxAtZ14(profileWidthM(way.profile), lat);
    const presentation = corridorPresentation(way);
    const availability = tierAvailabilityProperties(presentation, presentation.retainedTiers);
    for (const surface of g.laneSurfaces) {
      const r = laneRender(surface.kindId);
      if (r.surface && projection.topology.lanes) {
        lanes.push({
          type: 'Feature',
          id: stableFeatureId('lanes', 'lane', way.id, surface.laneId),
          properties: {
            id: way.id,
            wayId: way.id,
            typeId: way.typeId,
            laneId: surface.laneId,
            kindId: surface.kindId,
            color: r.color,
            corridorW14,
            renderTier: 'street',
            tierOpacity: presentation.blend.weights.street,
            ...availability,
          },
          geometry: { type: 'Polygon', coordinates: [surface.ring] },
        });
      }
    }
    if (projection.topology.laneMarkings) {
      appendStreetMarkings({
        laneMarkings,
        way,
        geometry: g,
        corridorW14,
        tierOpacity: presentation.blend.weights.street,
        availability,
        tieSpacingM: Math.max(
          STANDARD_RAIL_TIE_SPACING_M,
          metricErrorForDisplayedPixels(view.presentation, lat, DISPLAYED_RAIL_TIE_SPACING_PX),
        ),
      });
    }
    if (projection.topology.laneArrows) {
      for (const a of g.arrows) {
        laneArrows.push({
          type: 'Feature',
          id: stableFeatureId('laneArrows', 'lane-direction', way.id, a.laneId),
          properties: {
            id: way.id,
            wayId: way.id,
            typeId: way.typeId,
            laneId: a.laneId,
            corridorW14,
            renderTier: 'street',
            tierOpacity: presentation.blend.weights.street,
            ...availability,
          },
          geometry: { type: 'LineString', coordinates: a.path },
        });
      }
    }
    // A lane-rendered way has no corridor silhouette to carry its selection
    // halo, so emit one centerline stand-in per Street-tier way. It's invisible unless
    // selected: LYR_WAY_SELECTED is driven by feature-state (set on selection in
    // MapCanvas), and LYR_WAYS_SOLID/DASHED filter haloOnly out. Emitted
    // unconditionally (not only when selected) so the selection fast path can
    // light it via feature-state without a full rebuild.
    if (projection.topology.ways) {
      ways.push({
        type: 'Feature',
        id: stableFeatureId('ways', 'street-halo', way.id),
        properties: {
          id: way.id,
          typeId: way.typeId,
          color: '#191a17',
          width: 10,
          dashed: false,
          offset: 0,
          haloOnly: true,
          corridorW14,
          renderTier: 'street',
          tierOpacity: presentation.blend.weights.street,
          ...availability,
        },
        geometry: { type: 'LineString', coordinates: renderedWayPath(way, view.presentation) },
      });
    }
  };

  // A way renders at Street detail when its physical width occupies enough
  // final CSS pixels, it survived the viewport index's transition margin, and
  // it is not a bored tunnel. Pixel ratio is deliberately absent:
  // backing-store sharpness cannot change LOD.
  const wantsLaneDetail = (way: TransitSystem['ways'][number]) =>
    !network &&
    corridorPresentation(way).retainedTiers.includes('street') &&
    way.grade !== 'underground' &&
    way.profile.lanes.length > 0;

  // Surface and control markers are two views of one junction. Keeping their
  // shared metadata here prevents either one from drifting into a different
  // Street LOD or filtering decision as the cartography evolves.
  const junctionPaintMetadata = (node: TransitSystem['nodes'][number]): JunctionPaintMetadata => {
    const incidentWays = node.refs.flatMap((ref) => {
      const way = waysById.get(ref.wayId);
      return way ? [way] : [];
    });
    return {
      typeIds: [...new Set(incidentWays.map((way) => way.typeId))].sort(),
      corridorW14: Math.max(
        0,
        ...incidentWays.map((way) =>
          widthPxAtZ14(profileWidthM(way.profile), way.points[0]?.[1] ?? node.coord[1]),
        ),
      ),
      tierOpacity: Math.max(
        0,
        ...incidentWays.map((way) => corridorPresentation(way).blend.weights.street),
      ),
    };
  };

  const appendControlledApproachMarkings = (
    node: TransitSystem['nodes'][number],
    geometry: JunctionGeometry,
    metadata: JunctionPaintMetadata,
  ) => {
    if (!projection.topology.laneMarkings) return;
    for (const crosswalk of junctionCrosswalks(node, geometry, system.approachControls)) {
      laneMarkings.push({
        type: 'Feature',
        id: stableFeatureId(
          'laneMarkings',
          'crosswalk',
          crosswalk.nodeId,
          crosswalk.wayId,
          crosswalk.end,
        ),
        properties: {
          kind: 'crosswalk',
          nodeId: crosswalk.nodeId,
          wayId: crosswalk.wayId,
          corridorW14: metadata.corridorW14,
          renderTier: 'street',
          tierOpacity: metadata.tierOpacity,
        },
        geometry: { type: 'MultiLineString', coordinates: crosswalk.stripes },
      });
    }
    for (const stopBar of junctionStopBars(node, geometry, system.approachControls)) {
      laneMarkings.push({
        type: 'Feature',
        id: stableFeatureId('laneMarkings', 'stop-bar', stopBar.nodeId, stopBar.wayId, stopBar.end),
        properties: {
          kind: 'stopBar',
          nodeId: stopBar.nodeId,
          wayId: stopBar.wayId,
          corridorW14: metadata.corridorW14,
          renderTier: 'street',
          tierOpacity: metadata.tierOpacity,
        },
        geometry: { type: 'LineString', coordinates: stopBar.path },
      });
    }
  };

  // Junctions among lane-detailed ways: real footprint polygons whose trim
  // distances pull every arm's lane geometry back so carriageways stop at
  // the junction edge instead of overlapping through it (stage 2 feeding
  // stage 1 — see geometry/junctions.ts). Connector curves are the per-lane
  // turn guides through each footprint.
  const junctionFeatures: Feature<Polygon | Point>[] = [];
  const connectorFeatures: Feature<LineString>[] = [];
  const laneNodes: { node: TransitSystem['nodes'][number]; g: JunctionGeometry }[] = [];
  let wayTrims: WayTrims = new Map();
  const candidateWays = orderedIndexedValues(system.ways, waysById, candidateWayIds);
  const needsJunctionGeometry =
    !network &&
    projection.junctions.needsGeometry &&
    candidateWays.some((way) => wantsLaneDetail(way));
  if (needsJunctionGeometry) {
    if (counts) counts.featureJunctionPassCount++;
    const candidateNodes = orderedIndexedValues(
      system.nodes,
      indexes.nodesById,
      candidateGeometryNodeIds,
    );
    for (const node of candidateNodes) {
      if (counts) counts.featureJunctionNodeVisitCount++;
      const relevant = node.refs.some((r) => {
        const w = waysById.get(r.wayId);
        return !!w && wantsLaneDetail(w);
      });
      if (!relevant) continue;
      const g = junctionGeometry(
        node,
        waysById,
        metricErrorForDisplayedPixels(view.presentation, node.coord[1], DISPLAYED_CURVE_ERROR_PX),
      );
      if (!g) continue;
      laneNodes.push({ node, g });
    }
    wayTrims = collectWayTrims(laneNodes.map((x) => x.g));
    for (const { node, g } of laneNodes) {
      const metadata = junctionPaintMetadata(node);
      appendControlledApproachMarkings(node, g, metadata);
      if (
        projection.junctions.polygons &&
        (!junctionOutputNodeIds || junctionOutputNodeIds.has(node.id)) &&
        g.polygon.length >= 3
      ) {
        junctionFeatures.push({
          type: 'Feature',
          id: stableFeatureId('junctions', 'surface', node.id),
          properties: {
            nodeId: node.id,
            typeIds: metadata.typeIds,
            selected: selection?.kind === 'node' && selId === node.id,
            renderTier: 'street',
            corridorW14: metadata.corridorW14,
            tierOpacity: metadata.tierOpacity,
          },
          geometry: { type: 'Polygon', coordinates: [closeRing(g.polygon)] },
        });
      }
      if (
        projection.junctions.polygons &&
        (!junctionOutputNodeIds || junctionOutputNodeIds.has(node.id)) &&
        node.control &&
        node.control !== 'uncontrolled'
      ) {
        junctionFeatures.push({
          type: 'Feature',
          id: stableFeatureId('junctions', 'control', node.id),
          properties: {
            nodeId: node.id,
            control: node.control,
            typeIds: metadata.typeIds,
            renderTier: 'street',
            corridorW14: metadata.corridorW14,
            tierOpacity: metadata.tierOpacity,
          },
          geometry: { type: 'Point', coordinates: node.coord },
        });
      }
      if (
        projection.junctions.polygons &&
        (!junctionOutputNodeIds || junctionOutputNodeIds.has(node.id))
      ) {
        for (const approach of junctionControlledApproaches(node, g, system.approachControls)) {
          // A whole-node control already has one central marker. A per-arm
          // override is a separate authored instruction and must remain
          // visible at its approach instead of looking like a global signal.
          if (!approach.explicit) continue;
          junctionFeatures.push({
            type: 'Feature',
            id: stableFeatureId(
              'junctions',
              'approach-control',
              node.id,
              approach.arm.wayId,
              approach.arm.end,
            ),
            properties: {
              nodeId: node.id,
              wayId: approach.arm.wayId,
              end: approach.arm.end,
              control: approach.control,
              typeIds: metadata.typeIds,
              renderTier: 'street',
              corridorW14: metadata.corridorW14,
              tierOpacity: metadata.tierOpacity,
            },
            geometry: { type: 'Point', coordinates: approach.coord },
          });
        }
      }
      // Selection-owned lane movement guides live exclusively in the web
      // editor's transient junction-guide source. Settled scenes remain
      // selection-independent, so changing selection never rebuilds or leaves
      // stale connector geometry in committed sources.
    }
  }

  if (projection.topology.enabled) {
    for (const way of candidateWays) {
      if (counts) counts.featureTopologyWayVisitCount++;
      const projectPhysicalWay = !physicalWayIds || physicalWayIds.has(way.id);
      const projectServiceWay = !serviceWayIds || serviceWayIds.has(way.id);
      const projectsServiceSource =
        projection.topology.services || projection.topology.serviceArrows;
      if (counts && projectsServiceSource && projectServiceWay && byWay.has(way.id)) {
        counts.featureServiceWayVisitCount++;
      }
      if (!indexes.projectedWayTypeIds.has(way.typeId)) continue;
      if (!projectPhysicalWay && !projectServiceWay) continue;
      const path = renderedWayPath(way, view.presentation);
      if (path.length < 2) continue;
      const allBundle = byWay.get(way.id) ?? [];
      const bundle = affectedServiceIds
        ? allBundle.filter((service) => affectedServiceIds.has(service.id))
        : allBundle;
      const base = wayRender(way.typeId, way.classId);
      const corridor = corridorPresentation(way);
      const laneDetail = wantsLaneDetail(way);
      let availableTiers = corridor.retainedTiers.filter((tier) => tier !== 'street' || laneDetail);
      // Underground and lane-less corridors cannot produce a Street mesh. At
      // a settled close camera retain one District silhouette so they never
      // disappear when the logical tier crosses 12 px. The paint expression
      // sees Street as unavailable and holds this fallback at full opacity.
      if (!network && !laneDetail && availableTiers.length === 0) {
        availableTiers = ['district'];
      }

      if (bundle.length === 0) {
        // Network view is service-focused — bare/unassigned infrastructure with
        // no rider only makes sense as physical-planning context (Infrastructure).
        const unserved = resolveUnservedCorridorProjection({
          way,
          style: base,
          projectPhysicalWay,
          network,
          laneDetail,
          projectWays: projection.topology.ways,
          needsLaneGeometry: projection.topology.needsLaneGeometry,
        });
        if (!unserved) continue;
        if (unserved.emitCorridor) {
          emitCorridorTiers({
            way,
            path,
            color: unserved.color,
            width: unserved.width,
            dashed: unserved.dashed,
            presentation: corridor,
            availableTiers,
          });
        }
        if (unserved.emitLaneGeometry) emitLaneDetail(way);
        continue;
      }

      if (laneDetail) {
        if (projectPhysicalWay && projection.topology.ways && !network) {
          emitCorridorTiers({
            way,
            path,
            color: base.color,
            width: base.width,
            dashed: !!base.dashed,
            presentation: corridor,
            availableTiers,
          });
        }
        if (
          projectPhysicalWay &&
          (projection.topology.ways ||
            projection.topology.lanes ||
            projection.topology.laneMarkings ||
            projection.topology.laneArrows)
        ) {
          emitLaneDetail(way);
        }
      } else if (projectPhysicalWay && projection.topology.ways && !network) {
        emitCorridorTiers({
          way,
          path,
          color: base.color,
          width: base.width,
          dashed: !!base.dashed,
          presentation: corridor,
          availableTiers,
        });
      }

      // One-way infrastructure reads as one-way in the SCHEMATIC too:
      // chevrons along the served line, pointing with travel — otherwise
      // Network view silently hides direction, and a one-way couplet looks
      // like two ordinary parallel lines.
      const wayIsOneWay = isOneWay(way.profile);
      if (projectPhysicalWay && projection.topology.laneArrows && network && wayIsOneWay) {
        const backward = directionalLanes(way.profile).every((l) => l.direction === 'backward');
        laneArrows.push({
          type: 'Feature',
          id: stableFeatureId('laneArrows', 'way-direction', way.id),
          properties: {
            id: way.id,
            wayId: way.id,
            typeId: way.typeId,
            renderTier: 'overview',
            tierOpacity: 1,
            ...tierAvailabilityProperties(corridor, availableTiers),
          },
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
      if (projectServiceWay && projection.topology.serviceArrows && network && !wayIsOneWay) {
        for (const one of oneDirectionalStretches(
          waysById,
          bundle,
          way.id,
          indexes.linesByServiceId,
        )) {
          serviceArrows.push({
            type: 'Feature',
            id: stableFeatureId(
              'serviceArrows',
              'service-direction',
              one.serviceId,
              way.id,
              one.run,
              one.forward ? 'forward' : 'backward',
              one.range[0],
              one.range[1],
            ),
            properties: {
              id: way.id,
              wayId: way.id,
              serviceId: one.serviceId,
              modeId: one.modeId,
              typeId: way.typeId,
              color: one.color,
              renderTier: 'overview',
              tierOpacity: 1,
              ...tierAvailabilityProperties(corridor, availableTiers),
            },
            geometry: { type: 'LineString', coordinates: one.path },
          });
        }
      }

      if (!projectServiceWay || !projection.topology.services) continue;

      // Network view is the clean schematic map — grade (tunnel/viaduct styling)
      // is physical-alignment detail that belongs to the Infrastructure view.
      const { underground, elevated } = network
        ? { underground: false, elevated: false }
        : gradeFlags(way.grade);
      const serviceFeature = ({
        service,
        coordinates,
        offset,
        renderTier,
        tierOpacity,
        availableTiers: serviceAvailableTiers,
        w14,
        occurrence,
        hitTarget,
        pathRole = 'centerline',
        semanticRange = [0, 1],
      }: ServiceFeatureProjectionOptions): Feature<LineString> => ({
        type: 'Feature',
        id: occurrence
          ? stableFeatureId(
              'services',
              'hit-occurrence',
              service.id,
              occurrence.patternId,
              occurrence.run,
              occurrence.legIndex,
              way.id,
            )
          : stableFeatureId(
              'services',
              'paint-fragment',
              service.id,
              way.id,
              renderTier,
              pathRole,
              semanticRange[0],
              semanticRange[1],
            ),
        properties: {
          serviceId: service.id,
          modeId: service.modeId,
          wayId: way.id,
          typeId: way.typeId,
          color: serviceDisplayColor(service, indexes.linesByServiceId),
          width: modeRender(service.modeId).width,
          underground,
          elevated,
          offset,
          ...(w14 !== undefined ? { w14 } : {}),
          corridorW14: widthPxAtZ14(profileWidthM(way.profile), way.points[0]?.[1] ?? 0),
          renderTier,
          tierOpacity,
          ...tierAvailabilityProperties(corridor, serviceAvailableTiers),
          ...(occurrence
            ? {
                patternId: occurrence.patternId,
                run: occurrence.run,
                legIndex: occurrence.legIndex,
              }
            : {}),
          hitTarget: hitTarget === true,
        },
        geometry: { type: 'LineString', coordinates },
      });
      const emittedHitIds = new Set<string>();
      const addServiceHitFeatures = ({
        service,
        path: hitPath,
        offset,
        renderTier,
        tierOpacity,
        availableTiers: serviceAvailableTiers,
        w14,
        pathRole = 'centerline',
        runs,
        tOnPath = (t) => t,
      }: ServiceHitProjectionOptions) => {
        const occurrences = serviceWayOccurrences(service, way.id);
        if (occurrences.length === 0) return;
        for (const occurrence of occurrences) {
          if (runs && !runs.has(occurrence.run)) continue;
          const piece = slicePathByT(
            hitPath,
            tOnPath(occurrence.range[0]),
            tOnPath(occurrence.range[1]),
          );
          if (piece.length < 2) continue;
          const feature = serviceFeature({
            service,
            coordinates: piece,
            offset,
            renderTier,
            tierOpacity,
            availableTiers: serviceAvailableTiers,
            w14,
            occurrence,
            hitTarget: true,
            pathRole,
            semanticRange: occurrence.range,
          });
          const featureId = String(feature.id);
          if (emittedHitIds.has(featureId)) continue;
          emittedHitIds.add(featureId);
          serviceHits.push(feature);
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
      const centerlineFeatures = (
        service: Service,
        renderTier: RenderTier,
        on: LngLat[] = path,
      ): Feature<LineString>[] => {
        const offset = (slots.get(service.id) ?? 0) * BUNDLE_SPACING_PX;
        const ranges = serviceRangesOnWay(service, way.id);
        if (ranges.length === 1 && ranges[0][0] <= 0 && ranges[0][1] >= 1)
          return [
            serviceFeature({
              service,
              coordinates: on,
              offset,
              renderTier,
              tierOpacity: corridor.blend.weights[renderTier],
              availableTiers: corridor.retainedTiers,
            }),
          ];
        return ranges
          .map(([lo, hi]) => ({
            range: [lo, hi] as [number, number],
            path: slicePathByT(on, lo, hi),
          }))
          .filter((entry) => entry.path.length >= 2)
          .map((entry) =>
            serviceFeature({
              service,
              coordinates: entry.path,
              offset,
              renderTier,
              tierOpacity: corridor.blend.weights[renderTier],
              availableTiers: corridor.retainedTiers,
              semanticRange: entry.range,
            }),
          );
      };

      const centerlineTiers = corridor.retainedTiers.filter((tier) => tier !== 'street');
      const addStreetCenterline = (service: Service) => {
        if (!corridor.retainedTiers.includes('street')) return;
        services.push(...centerlineFeatures(service, 'street'));
      };
      for (const service of bundle) {
        for (const renderTier of centerlineTiers) {
          services.push(...centerlineFeatures(service, renderTier));
        }
      }

      if (laneDetail) {
        // INFRASTRUCTURE lane detail: draw each service on the ACTUAL lane it
        // uses — the curb lane for its travel direction, or its track — instead
        // of the schematic centerline. wayLaneGeometry is memoized on the same
        // trims emitLaneDetail already computed above, so this is a cache hit.
        const trims = wayTrims.get(way.id) ?? { start: 0, end: 0 };
        const laneById = new Map(
          attributedLaneGeometry(way, trims.start, trims.end).lanes.map(
            (lane) => [lane.laneId, lane] as const,
          ),
        );
        const lat = way.points[0]?.[1] ?? 36;
        // Which lane(s) each service rides here — both directions of every
        // pattern that traverses this way, so a two-way service claims both
        // curbs. Group services by lane so services sharing a lane can fan
        // slightly instead of overprinting. The directional pattern index is pre-built once
        // for the whole system — O(1) here, not a re-scan of every rider's full
        // pattern list per way.
        const { servicesByLane, runsByLaneAndService, resolvedServiceIds } = assignServicesToLanes({
          entries: indexServicePatternsByWay(byWay).get(way.id) ?? [],
          laneById,
          waysById,
          turnRestrictions: system.turnRestrictions,
        });
        // A bundle rider with no lane resolved anywhere on this way (a lane-less
        // profile) falls back to the centerline.
        bundle.forEach((svc) => {
          if (resolvedServiceIds.has(svc.id)) return;
          addStreetCenterline(svc);
          addServiceHitFeatures({
            service: svc,
            path,
            offset: (slots.get(svc.id) ?? 0) * BUNDLE_SPACING_PX,
            renderTier: corridor.logicalTier,
            tierOpacity: corridor.blend.weights[corridor.logicalTier],
            availableTiers: corridor.retainedTiers,
          });
        });
        // A lane path is the centerline carved back at each junction footprint,
        // so a position measured against the untrimmed way sits further along
        // it. Convert once per way rather than slicing against the wrong ruler.
        const wayMeters = pathLengthMeters(path);
        const laneMeters = Math.max(1e-9, wayMeters - trims.start - trims.end);
        const ontoLane = (t: number): number =>
          Math.max(0, Math.min(1, (t * wayMeters - trims.start) / laneMeters));
        const laneServiceBundles = [...servicesByLane].flatMap(([laneId, laneServices]) => {
          const lane = laneById.get(laneId);
          return lane ? [{ laneId, lane, laneServices }] : [];
        });
        for (const { laneId, lane, laneServices } of laneServiceBundles) {
          // w14 = the lane's overlay half-width in z14 px; today it only FLAGS a
          // lane-detail overlay (the layer's zoom-clamped SERVICE_WIDTH_EXPR draws
          // the band), but it carries the metric so a per-lane width can use it later.
          const w14 = widthPxAtZ14(lane.widthM * SERVICE_LANE_FRACTION, lat);
          const n = laneServices.length; // lone service sits dead-centre on its lane
          laneServices.forEach((svc, i) => {
            const offset = (i - (n - 1) / 2) * WITHIN_LANE_SPACING_PX;
            const assignmentRuns = runsByLaneAndService.get(
              laneServiceAssignmentKey(laneId, svc.id),
            );
            for (const run of assignmentRuns ?? []) {
              streetServiceEndpointPaint.set(
                streetServiceEndpointPaintKey(svc.id, run, way.id, laneId),
                { service: svc, way, corridor, laneW14: w14, offset },
              );
            }
            addServiceHitFeatures({
              service: svc,
              path: lane.path,
              offset,
              renderTier: 'street',
              tierOpacity: corridor.blend.weights.street,
              availableTiers: corridor.retainedTiers,
              w14,
              pathRole: laneId,
              runs: assignmentRuns,
            });
            const ranges = serviceRangesOnWay(svc, way.id);
            if (ranges.length === 1 && ranges[0][0] <= 0 && ranges[0][1] >= 1) {
              services.push(
                serviceFeature({
                  service: svc,
                  coordinates: lane.path,
                  offset,
                  renderTier: 'street',
                  tierOpacity: corridor.blend.weights.street,
                  availableTiers: corridor.retainedTiers,
                  w14,
                  pathRole: laneId,
                }),
              );
              return;
            }
            for (const [lo, hi] of ranges) {
              const piece = slicePathByT(lane.path, ontoLane(lo), ontoLane(hi));
              if (piece.length >= 2)
                services.push(
                  serviceFeature({
                    service: svc,
                    coordinates: piece,
                    offset,
                    renderTier: 'street',
                    tierOpacity: corridor.blend.weights.street,
                    availableTiers: corridor.retainedTiers,
                    w14,
                    pathRole: laneId,
                    semanticRange: [lo, hi],
                  }),
                );
            }
          });
        }
      } else {
        for (const service of bundle) {
          addStreetCenterline(service);
          addServiceHitFeatures({
            service,
            path,
            offset: (slots.get(service.id) ?? 0) * BUNDLE_SPACING_PX,
            renderTier: corridor.logicalTier,
            tierOpacity: corridor.blend.weights[corridor.logicalTier],
            availableTiers: corridor.retainedTiers,
          });
        }
      }
    }
  }

  // Street-tier lane paths stop at each junction footprint. These small
  // connector features carry a service continuously from its incoming lane
  // to the outgoing lane without turning the selected-junction editor guides
  // into committed geometry. `laneNodes` is already viewport/scoped filtered,
  // so this only considers junctions whose surrounding topology was projected.
  if (!network && projection.topology.services && streetServiceEndpointPaint.size > 0) {
    appendStreetServiceJunctionConnectors({
      services,
      serviceHits,
      indexes,
      waysById,
      wayTrims,
      nodes: laneNodes.map(({ node }) => node),
      endpointPaint: streetServiceEndpointPaint,
      turnRestrictions: system.turnRestrictions,
    });
  }

  return {
    ways,
    // Paint stays continuity-merged within its corridor owner. Transparent hit
    // surfaces remain per occurrence, so an ambiguous right-click is exact.
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

interface IndependentProjectionOptions {
  system: TransitSystem;
  selection: Highlight;
  handleWayIds: string[];
  view: RenderViewOptions;
  projection: FeatureProjectionPlan;
  indexes: SharedProjectionIndexes;
  network: boolean;
  counts: FeatureBuildOperationCounts | undefined;
  physicalHandleStationId: string | null;
  physicalHandleGroupId: string | null;
  buildOptions: BuildFeaturesOptions;
  viewport: RenderViewportCandidateSets;
  projectionScope: RenderProjectionScope | undefined;
}

interface IndependentProjectionResult {
  stops: Feature<Point>[];
  handles: Feature<Point>[];
  serviceTermini: Feature<Point>[];
  physical: PhysicalProjectionResult;
  wayLabels: Feature<LineString>[];
  facilities: Feature<Point>[];
}

function viewportCategoriesFor(projection: FeatureProjectionPlan): RenderViewportCategory[] {
  const categories: RenderViewportCategory[] = [];
  // Named-way label output filters each member corridor against the viewport,
  // so a labels-only source request still needs corridor candidates.
  if (projection.topologyPassEnabled || projection.wayLabels) categories.push('corridor');
  if (projection.junctions.needsGeometry) categories.push('junction');
  if (projection.stops) categories.push('stop');
  if (projection.physical.enabled) categories.push('station');
  if (projection.wayLabels) categories.push('label');
  if (projection.selectionHandles) categories.push('way-handle');
  if (projection.serviceTermini) categories.push('service-terminus');
  if (projection.facilities) categories.push('facility');
  if (projection.physical.footprints || projection.physical.handles) categories.push('group');
  if (projection.physical.handles) categories.push('physical-handle');
  return categories;
}

function stopsForProjection(
  system: TransitSystem,
  indexes: SharedProjectionIndexes,
  requestedStopIds: readonly string[] | undefined,
  viewportStopIds: readonly string[] | undefined,
): TransitSystem['stops'] {
  return orderedIndexedValues(system.stops, indexes.stopsById, requestedStopIds ?? viewportStopIds);
}

function stationsForProjection(
  system: TransitSystem,
  indexes: SharedProjectionIndexes,
  requestedStationIds: readonly string[] | undefined,
  viewportStationIds: readonly string[] | undefined,
): TransitSystem['stations'] {
  return orderedIndexedValues(
    system.stations,
    indexes.stationsById,
    requestedStationIds ?? viewportStationIds,
  );
}

function intersectOrderedIds(
  candidates: readonly string[],
  constraint: readonly string[] | undefined,
): readonly string[] {
  if (!constraint) return candidates;
  const allowed = new Set(constraint);
  return candidates.filter((id) => allowed.has(id));
}

function intersectOptionalOrderedIds(
  candidates: readonly string[] | undefined,
  constraint: readonly string[] | undefined,
): readonly string[] | undefined {
  if (!constraint) return candidates;
  return candidates ? intersectOrderedIds(candidates, constraint) : constraint;
}

function optionalIdSet(
  candidates: readonly string[] | undefined,
  constraint: readonly string[] | undefined,
): ReadonlySet<string> | undefined {
  const intersection = intersectOptionalOrderedIds(candidates, constraint);
  return intersection ? new Set(intersection) : undefined;
}

function independentCandidateStops({
  system,
  projection,
  indexes,
  buildOptions,
  viewport,
  projectionScope,
}: IndependentProjectionOptions): TransitSystem['stops'] {
  if (!projection.stops) return [];
  const viewportStopIds = intersectOptionalOrderedIds(viewport.stopIds ?? [], buildOptions.stopIds);
  const stopIds = projectionScope
    ? intersectOrderedIds(projectionScope.candidates.stopIds, viewportStopIds ?? [])
    : viewportStopIds;
  const candidates = stopsForProjection(system, indexes, stopIds, undefined);
  const unitStopIds = buildOptions.unitScope?.stopIds;
  if (!unitStopIds) return candidates;
  const allowed = new Set(unitStopIds);
  return candidates.filter((stop) => allowed.has(stop.id));
}

function independentCandidateStations({
  system,
  projection,
  indexes,
  buildOptions,
  viewport,
  projectionScope,
}: IndependentProjectionOptions): TransitSystem['stations'] {
  if (!projection.physical.enabled) return [];
  const viewportStationIds = intersectOptionalOrderedIds(
    viewport.stationIds ?? [],
    buildOptions.stationIds,
  );
  const stationIds = projectionScope
    ? intersectOrderedIds(projectionScope.candidates.stationIds, viewportStationIds ?? [])
    : viewportStationIds;
  const candidates = stationsForProjection(system, indexes, stationIds, undefined);
  const unitStationIds = buildOptions.unitScope?.stationIds;
  if (!unitStationIds) return candidates;
  const allowed = new Set(unitStationIds);
  return candidates.filter((station) => allowed.has(station.id));
}

function independentServiceTermini({
  selection,
  view,
  projection,
  indexes,
  buildOptions,
  projectionScope,
  viewport,
}: IndependentProjectionOptions): Feature<Point>[] {
  if (!projection.serviceTermini || view.viewMode === 'diagram') return [];
  const scopedServiceIds = projectionScope?.candidates.affectedServiceIds;
  const serviceIds = intersectOptionalOrderedIds(
    scopedServiceIds,
    buildOptions.unitScope?.serviceIds,
  );
  return projectServiceTermini({
    selection,
    indexes,
    activePatternId: buildOptions.activePatternId,
    armedTerminus: buildOptions.armedTerminus,
    affectedServiceIds: serviceIds ? new Set(serviceIds) : undefined,
    candidateTerminusIds: optionalIdSet(
      viewport.serviceTerminusIds ?? [],
      buildOptions.unitScope?.serviceTerminusIds,
    ),
  });
}

function independentPhysicalFeatures(
  options: IndependentProjectionOptions,
  candidateStations: TransitSystem['stations'],
): PhysicalProjectionResult {
  const {
    system,
    projection,
    indexes,
    network,
    physicalHandleStationId,
    physicalHandleGroupId,
    counts,
    projectionScope,
    buildOptions,
    viewport,
  } = options;
  if (!projection.physical.enabled) return { footprints: [], platforms: [], handles: [] };
  const candidateGroupIds = intersectOptionalOrderedIds(
    viewport.groupIds ?? [],
    buildOptions.unitScope?.groupIds,
  );
  const candidateGroups = orderedIndexedValues(
    system.groups,
    indexes.groupsById,
    candidateGroupIds,
  );
  return projectPhysicalFeatures({
    system,
    indexes,
    projection: projection.physical,
    network,
    physicalHandleStationId,
    physicalHandleGroupId,
    counts,
    candidateStations,
    candidateGroups,
    candidatePhysicalHandleIds: intersectOptionalOrderedIds(
      viewport.physicalHandleIds ?? [],
      buildOptions.unitScope?.physicalHandleIds,
    ),
    entityScoped: projectionScope !== undefined,
  });
}

function independentWayLabels({
  system,
  projection,
  indexes,
  network,
  counts,
  viewport,
  projectionScope,
  buildOptions,
  view,
}: IndependentProjectionOptions): Feature<LineString>[] {
  if (!projection.wayLabels) return [];
  const unitScope = buildOptions.unitScope;
  const namedWayIds = projectionScope
    ? intersectOrderedIds(projectionScope.candidates.namedWayIds, viewport.labelIds)
    : viewport.labelIds;
  const labelDependencyIds = projectionScope?.candidates.labelDependencyIds;
  const labelWayIds = projectionScope
    ? intersectOrderedIds(projectionScope.candidates.labelWayIds, viewport.wayIds)
    : viewport.wayIds;
  return projectWayLabels({
    system,
    indexes,
    network,
    presentation: view.presentation,
    counts,
    candidateNamedWayIds: intersectOptionalOrderedIds(namedWayIds, unitScope?.namedWayIds),
    candidateLabelDependencyIds: optionalIdSet(labelDependencyIds, unitScope?.labelDependencyIds),
    candidateWayIds: optionalIdSet(labelWayIds, unitScope?.labelWayIds) ?? viewport.wayIdSet,
  });
}

function projectIndependentFeatures(
  options: IndependentProjectionOptions,
): IndependentProjectionResult {
  const { system, selection, handleWayIds, projection, indexes, network, counts } = options;
  const candidateStops = independentCandidateStops(options);
  const candidateStations = independentCandidateStations(options);
  const stops = projection.stops ? projectStops(system, candidateStops, indexes, counts) : [];
  const handles =
    projection.selectionHandles && !(network && selection?.kind === 'service')
      ? projectSelectionHandles(
          indexes,
          handleWayIds,
          counts,
          intersectOptionalOrderedIds(
            options.viewport.wayHandleIds ?? [],
            options.buildOptions.unitScope?.wayHandleIds,
          ),
        )
      : [];
  const serviceTermini = independentServiceTermini(options);
  const physical = independentPhysicalFeatures(options, candidateStations);
  const wayLabels = independentWayLabels(options);
  const facilities = projection.facilities
    ? projectFacilities({
        system,
        indexes,
        network,
        counts,
        candidateFacilityIds: intersectOptionalOrderedIds(
          options.viewport.facilityIds ?? [],
          options.buildOptions.unitScope?.facilityIds,
        ),
      })
    : [];
  return { stops, handles, serviceTermini, physical, wayLabels, facilities };
}

function assembleSystemFeatures(
  topology: TopologyProjectionResult,
  independent: IndependentProjectionResult,
): SystemFeatures {
  return {
    ways: { type: 'FeatureCollection', features: topology.ways },
    services: { type: 'FeatureCollection', features: topology.services },
    stops: { type: 'FeatureCollection', features: independent.stops },
    footprints: { type: 'FeatureCollection', features: independent.physical.footprints },
    platforms: { type: 'FeatureCollection', features: independent.physical.platforms },
    facilities: { type: 'FeatureCollection', features: independent.facilities },
    physicalHandles: { type: 'FeatureCollection', features: independent.physical.handles },
    handles: { type: 'FeatureCollection', features: independent.handles },
    serviceTermini: { type: 'FeatureCollection', features: independent.serviceTermini },
    lanes: { type: 'FeatureCollection', features: topology.lanes },
    laneMarkings: { type: 'FeatureCollection', features: topology.laneMarkings },
    laneArrows: { type: 'FeatureCollection', features: topology.laneArrows },
    serviceArrows: { type: 'FeatureCollection', features: topology.serviceArrows },
    junctions: { type: 'FeatureCollection', features: topology.junctions },
    connectors: { type: 'FeatureCollection', features: topology.connectors },
    wayLabels: { type: 'FeatureCollection', features: independent.wayLabels },
  };
}

interface RequestedTopologyProjectionOptions {
  system: TransitSystem;
  selection: Highlight;
  view: RenderViewOptions;
  projection: FeatureProjectionPlan;
  indexes: SharedProjectionIndexes;
  network: boolean;
  counts: FeatureBuildOperationCounts | undefined;
  viewport: RenderViewportCandidateSets;
  projectionScope: RenderProjectionScope | undefined;
  unitScope: RenderFeatureProjectionUnitScope | undefined;
}

function scopedTopologyWayIds(
  projection: FeatureProjectionPlan,
  scope: RenderProjectionScope | undefined,
): readonly string[] | undefined {
  if (!scope) return undefined;
  const physical =
    projection.topology.ways ||
    projection.topology.lanes ||
    projection.topology.laneMarkings ||
    projection.topology.laneArrows ||
    projection.junctions.polygons ||
    projection.junctions.connectors;
  const service = projection.topology.services || projection.topology.serviceArrows;
  if (physical && service) return scope.candidates.topologyWayIds;
  return physical ? scope.candidates.physicalWayIds : scope.candidates.serviceWayIds;
}

interface RequestedTopologyCandidates {
  candidateWayIds: readonly string[] | undefined;
  candidateGeometryNodeIds: readonly string[] | undefined;
  physicalWayIds: ReadonlySet<string> | undefined;
  serviceWayIds: ReadonlySet<string> | undefined;
  affectedServiceIds: ReadonlySet<string> | undefined;
  junctionOutputNodeIds: ReadonlySet<string> | undefined;
  connectorOutputNodeIds: ReadonlySet<string> | undefined;
}

function requestedTopologyCandidates(
  projection: FeatureProjectionPlan,
  projectionScope: RenderProjectionScope | undefined,
  viewport: RenderViewportCandidateSets,
  unitScope: RenderFeatureProjectionUnitScope | undefined,
): RequestedTopologyCandidates {
  const scopedWayIds = scopedTopologyWayIds(projection, projectionScope);
  const viewportWayIds = scopedWayIds
    ? intersectOrderedIds(scopedWayIds, viewport.wayIds)
    : viewport.wayIds;
  const geometryNodeIds = projectionScope
    ? intersectOrderedIds(projectionScope.candidates.geometryNodeIds, viewport.junctionIds)
    : viewport.junctionIds;
  return {
    candidateWayIds: intersectOptionalOrderedIds(viewportWayIds, unitScope?.topologyWayIds),
    candidateGeometryNodeIds: intersectOptionalOrderedIds(
      geometryNodeIds,
      unitScope?.geometryNodeIds,
    ),
    physicalWayIds: optionalIdSet(
      projectionScope?.candidates.physicalWayIds,
      unitScope?.physicalWayIds,
    ),
    serviceWayIds: optionalIdSet(
      projectionScope?.candidates.serviceWayIds,
      unitScope?.serviceWayIds,
    ),
    affectedServiceIds: optionalIdSet(
      projectionScope?.candidates.affectedServiceIds,
      unitScope?.serviceIds,
    ),
    junctionOutputNodeIds: optionalIdSet(
      projectionScope?.candidates.junctionNodeIds,
      unitScope?.junctionOutputNodeIds,
    ),
    connectorOutputNodeIds: optionalIdSet(
      projectionScope?.candidates.connectorNodeIds,
      unitScope?.connectorOutputNodeIds,
    ),
  };
}

function projectRequestedTopology({
  system,
  selection,
  view,
  projection,
  indexes,
  network,
  counts,
  viewport,
  projectionScope,
  unitScope,
}: RequestedTopologyProjectionOptions): TopologyProjectionResult {
  if (!projection.topologyPassEnabled) return emptyTopologyProjection();
  const candidates = requestedTopologyCandidates(projection, projectionScope, viewport, unitScope);
  return projectTopologyFeatures({
    system,
    selection,
    view,
    projection,
    indexes,
    network,
    counts,
    ...candidates,
  });
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
  view: RenderViewOptions,
  /** The station whose footprint/platform vertices should render as
   *  draggable handles right now (its own edit context, not tied to
   *  `selection` directly since a platform can be mid-edit independently). */
  physicalHandleStationId: string | null = null,
  /** Same, for a group's (facility-complex's) own footprint vertices. */
  physicalHandleGroupId: string | null = null,
  options: BuildFeaturesOptions = {},
): SystemFeatures {
  const projection = createFeatureProjectionPlan(options.requestedFeatures);
  // Diagram's global layout cannot yet produce an exact entity patch. The
  // planner reports a full fallback, and this guard prevents an accidental
  // scoped call from returning an incomplete Diagram scene.
  const projectionScope = view.viewMode === 'diagram' ? undefined : options.projectionScope;
  const counts = options.counts;
  if (counts) {
    counts.featureCollectionBuildCount += projection.collectionCount;
    if (projection.topologyPassEnabled) counts.featureTopologyPassCount++;
  }

  // Diagram shares Network's schematic behavior. Only Infrastructure includes
  // physical planning detail such as footprints and facilities.
  const network = view.viewMode !== 'infrastructure';
  const viewport =
    options.preparedSnapshot?.system === system
      ? options.preparedSnapshot.candidates
      : (options.precomputedViewportCandidates ??
        renderViewportCandidateSets(system, view.presentation, viewportCategoriesFor(projection)));
  const indexes = buildSharedProjectionIndexes(system, view, projection, options.preparedSnapshot);
  const topology = projectRequestedTopology({
    system,
    selection:
      options.selectionOwnedConnectors === false && selection?.kind === 'node' ? null : selection,
    view,
    projection,
    indexes,
    network,
    counts,
    viewport,
    projectionScope,
    unitScope: options.unitScope,
  });
  const independent = projectIndependentFeatures({
    system,
    selection,
    handleWayIds,
    view,
    projection,
    indexes,
    network,
    counts,
    physicalHandleStationId,
    physicalHandleGroupId,
    buildOptions: options,
    viewport,
    projectionScope,
  });
  return assembleSystemFeatures(topology, independent);
}
