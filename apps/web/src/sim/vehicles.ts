import type { Feature, FeatureCollection, Point, Polygon } from 'geojson';
import type { GeoJSONSource, Map as MLMap } from 'maplibre-gl';
import type { EditorStore } from '../editor/store';
import {
  bearingAtT,
  cumulativeLengths,
  patternWayIds,
  pointAtDistance,
  rotatedRectPolygon,
} from '@transitmapper/core/model/geo';
import { patternLanePath } from '@transitmapper/core/geometry/vehicleLane';
import type {
  LngLat,
  Pattern,
  ScheduleDayScope,
  Service,
  Station,
  TransitSystem,
  Way,
} from '@transitmapper/core/model/system';
import { SRC_VEHICLES, SRC_VEHICLES_INFRA } from '../map/layers';
import { vehiclesDisabledForPerf } from '../perf';
import type { SimClock } from './simClock';
// Pure motion kernel (framework-free, WASM-portable) — this module is its rAF/
// MapLibre host. See packages/core/src/sim/timetable.ts.
import {
  roundTripMs,
  type RunTimetables,
  type VehicleMotionProfile,
} from '@transitmapper/core/sim/timetable';
// Measurement comes from core/sim's patternStats — the same call the Service
// inspector makes — so the numbers a planner reads and the ones the map runs
// are the same object, not two that happen to agree. Lane geometry is used
// here for drawing only; see the rule at the top of serviceStats.ts.
import { effectiveVehicleKind, patternStats } from '@transitmapper/core/sim/serviceStats';
import { planService, runStateAt } from '@transitmapper/core/sim/fleet';
import {
  activeSchedule,
  advanceSimMs,
  dayScopeAt,
  minutesOfDay,
  simSpeed,
  type ActiveSchedule,
} from '@transitmapper/core/sim/clock';

// How many of a pattern's vehicles get DRAWN. Not a claim about how many it
// runs — the plan's fleet can exceed this, and the cap only limits what's on
// screen (see the comment at its use). A frequent line on a long alignment can
// legitimately need dozens of vehicles; drawing all of them at RTC scale is a
// per-frame cost with no visual payoff at the zoom levels a whole system is
// viewed at.
const MAX_VEHICLES_PER_PATTERN = 12;

// Which patterns have already been reported as drawing fewer vehicles than
// they run, so the notice below fires once per pattern rather than 30 times a
// second. Reset never — a session's worth of one-line notices is the point.
const clampedFleetsReported = new Set<string>();

/** Say so when the map is showing fewer vehicles than the line actually runs.
 *  A cap that silently drops vehicles reads as "the headway is wrong"; a cap
 *  that says what it dropped reads as a cap. DEV only — in production this is
 *  a rendering detail, not something to put in a user's console. */
function noteClampedFleet(patternId: string, serviceName: string, fleet: number): void {
  if (!import.meta.env.DEV || clampedFleetsReported.has(patternId)) return;
  clampedFleetsReported.add(patternId);
  console.info(
    `[sim] ${serviceName}: running ${fleet} vehicles, drawing ${MAX_VEHICLES_PER_PATTERN}. Headway and spacing are unaffected; the map shows gaps.`,
  );
}
export interface VehicleGate {
  /** Whether this service's vehicles should render at all right now — the
   *  mode filter only (see ui/ViewProvider). View-mode gating (which
   *  source/shape renders, or nothing at all in Diagram view) is handled
   *  internally by attachVehicleAnimation using `viewMode` below. */
  isVisible: (service: Service) => boolean;
  /** Current view mode: vehicles render as a small dot in Network, a real
   *  true-scale footprint polygon riding its actual lane in Infrastructure,
   *  and not at all in Diagram. */
  viewMode: () => 'network' | 'infrastructure' | 'diagram';
  /** The schedule period pinned in the simulation controls, if any — every
   *  service then runs that period's configuration regardless of the clock.
   *  Undefined means follow the clock. */
  pinnedPeriod: () => string | undefined;
  /** Presentation state lives outside the editor store. Publish view, mode
   *  filter, and pinned-period changes here so an inactive animation can stop
   *  completely instead of polling those getters forever. */
  subscribe: (listener: () => void) => () => void;
}

/**
 * What every service is running at one moment, keyed by service id — `null`
 * for a service that isn't running then.
 *
 * Resolving a schedule means walking each service's periods and parsing their
 * "HH:MM" spans, which would be wasteful thirty times a second: the answer
 * cannot change until the simulated MINUTE does. So the whole table is
 * rebuilt only when the minute (or day scope, or pinned scenario, or the
 * services themselves) actually changes — at 4x that's about every 250ms
 * instead of every frame, and at realtime about once a minute.
 */
class ScheduleResolver {
  private key = '';
  private forServices: Service[] | null = null;
  private table = new Map<string, ActiveSchedule | null>();

  resolve(
    services: Service[],
    nowMin: number,
    dayScope: ScheduleDayScope,
    pinnedLabel: string | undefined,
  ): Map<string, ActiveSchedule | null> {
    const key = `${nowMin}|${dayScope}|${pinnedLabel ?? ''}`;
    if (key === this.key && services === this.forServices) return this.table;
    this.key = key;
    this.forServices = services;
    this.table = new Map();
    for (const service of services)
      this.table.set(service.id, activeSchedule(service, nowMin, dayScope, pinnedLabel));
    return this.table;
  }
}

/** One run's drawable geometry. The two legs are distinct polylines, not one
 *  line read backwards: on real infrastructure the return rides the lane on
 *  the other side of the street, and even the schematic centerline needs its
 *  own point order so a position measured from the START of a leg means the
 *  same thing for both. */
interface LegGeometry {
  path: LngLat[];
  /** Prefix-sum arc lengths for `path` (see cumulativeLengths) — precomputed
   *  once here so the per-tick position lookup is an O(log n) binary search
   *  (pointAtDistance) instead of re-walking the whole path every frame. */
  cumLengths: Float64Array;
  meters: number;
}

interface PatternGeometry {
  outbound: LegGeometry;
  inbound: LegGeometry;
  /** One timetable per direction, each measured against its own polyline.
   *  There is no shared ruler any more, and there cannot be: a one-way
   *  couplet's return trip is a different street of a different length. */
  timetables: RunTimetables;
  /** Axis-aligned bounds [minLng, minLat, maxLng, maxLat] of BOTH directions,
   *  so an off-screen pattern is culled wholesale before any of its vehicles
   *  are computed. Both, not just the outbound: a lane offset sits inside the
   *  cull's half-viewport margin, but a couplet's return street is a block
   *  away and would be culled while still on screen. */
  bbox: [number, number, number, number];
}

function legFrom(path: LngLat[]): LegGeometry {
  const cumLengths = cumulativeLengths(path);
  return { path, cumLengths, meters: cumLengths[cumLengths.length - 1] };
}

/** The schematic centerline read the other way. Network view has no lanes to
 *  put a return run in, so its two legs are the same line — but the arc-length
 *  table has to be rebuilt for the reversed point order, and subtracting the
 *  forward table from its total does that without re-running a haversine per
 *  point. Worth it: this runs for every pattern on every cache miss, and a
 *  drag misses for all of them. */
function reversedLeg(leg: LegGeometry): LegGeometry {
  const n = leg.path.length;
  const cumLengths = new Float64Array(n);
  for (let i = 0; i < n; i++) cumLengths[i] = leg.meters - leg.cumLengths[n - 1 - i];
  return { path: [...leg.path].reverse(), cumLengths, meters: leg.meters };
}

// Keyed by the Pattern object's own reference, plus the objects that can
// actually change its geometry: the ways its legs reference and stations
// anchored to those ways. Store edits replace the top-level ways/stations
// arrays even when they touch something on the other side of town; treating
// those array identities as dependencies made every pattern miss during every
// drag. The indexes below are rebuilt once per new top-level array, then each
// pattern compares only its own small dependency lists by object identity.
//
// Without the caching at all, the animation tick
// (every frame) redid the full path-stitching + arc-length + stop-lookup
// work for every pattern; fine at a few dozen hand-drawn patterns, but a
// real GTFS import (hundreds of patterns, each with a long, detailed
// street-following path) turned that into a sustained ~150ms/frame cost — a
// permanently janky tab, not just a slow first render. Confirmed live
// against RTC Southern Nevada's real feed. A drag now invalidates the
// patterns riding the changed way or station, while unrelated patterns keep
// their warm entries. Object identity still makes a relevant edit invalidate
// immediately, so a vehicle never remains stuck on a pre-edit alignment.
interface CachedPatternGeometry extends PatternGeometry {
  // The top-level collection identities are the zero-allocation fast path.
  // Most ticks see exactly these arrays and return before reconstructing any
  // pattern-local Set or dependency array. When an edit replaces one, the
  // smaller object-reference lists below decide whether this pattern changed.
  forWayArray: Way[];
  forStationArray: Station[];
  forWays: Array<Way | undefined>;
  forStations: Station[];
  // Compared field-by-field rather than by object identity: effectiveVehicleKind
  // builds a fresh VehicleMotionProfile object every call, so `===` on the
  // object itself would invalidate this cache on every tick even when nothing
  // about the vehicle changed.
  forSpeedMps: number;
  forAccelMps2: number;
  forDecelMps2: number;
  // undefined = Network view's raw centerline (patternPath); a mode id =
  // Infrastructure view's lane-aware path (patternLanePath) for that mode.
  // One cache slot per Pattern is enough — only one view is ever ticking at
  // a time, so a Pattern never needs both variants live simultaneously;
  // switching views just costs one recompute, same as any other edit.
  forModeId: string | undefined;
}
const patternGeometryCache = new WeakMap<Pattern, CachedPatternGeometry>();
const patternWayIdCache = new WeakMap<Pattern, string[]>();
const wayIndexCache = new WeakMap<Way[], Map<string, Way>>();
const stationIndexCache = new WeakMap<Station[], Map<string, Station[]>>();

function indexedWays(ways: Way[]): Map<string, Way> {
  let index = wayIndexCache.get(ways);
  if (index) return index;
  index = new Map(ways.map((way) => [way.id, way]));
  wayIndexCache.set(ways, index);
  return index;
}

function indexedStations(stations: Station[]): Map<string, Station[]> {
  let index = stationIndexCache.get(stations);
  if (index) return index;
  index = new Map();
  for (const station of stations) {
    for (const anchor of station.anchors) {
      const onWay = index.get(anchor.wayId);
      if (onWay) onWay.push(station);
      else index.set(anchor.wayId, [station]);
    }
  }
  stationIndexCache.set(stations, index);
  return index;
}

interface PatternDependencies {
  ways: Array<Way | undefined>;
  stations: Station[];
}

function dependencyWayIds(pattern: Pattern): string[] {
  let ids = patternWayIdCache.get(pattern);
  if (ids) return ids;
  ids = [...new Set(patternWayIds(pattern))];
  patternWayIdCache.set(pattern, ids);
  return ids;
}

function patternDependencies(system: TransitSystem, pattern: Pattern): PatternDependencies {
  const wayIds = dependencyWayIds(pattern);
  const waysById = indexedWays(system.ways);
  const stationsByWay = indexedStations(system.stations);
  const stations: Station[] = [];
  const seenStations = new Set<Station>();
  for (const wayId of wayIds) {
    for (const station of stationsByWay.get(wayId) ?? []) {
      if (seenStations.has(station)) continue;
      seenStations.add(station);
      stations.push(station);
    }
  }
  return {
    ways: wayIds.map((id) => waysById.get(id)),
    stations,
  };
}

function sameReferences<T>(left: T[], right: T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function resolvePatternGeometry(
  system: TransitSystem,
  pattern: Pattern,
  profile: VehicleMotionProfile,
  modeId?: string,
): PatternGeometry | null {
  const cached = patternGeometryCache.get(pattern);
  const profileMatches =
    cached?.forSpeedMps === profile.speedMps &&
    cached.forAccelMps2 === profile.accelMps2 &&
    cached.forDecelMps2 === profile.decelMps2 &&
    cached.forModeId === modeId;
  const collectionReferencesMatch =
    cached?.forWayArray === system.ways && cached.forStationArray === system.stations;
  if (cached && profileMatches && collectionReferencesMatch) return cached;

  // A profile/view change can reuse the already-resolved dependencies. An
  // editor change replaces one of the collections, so resolve local
  // references once for that edit and then install the new collection
  // identities as the next tick's fast path.
  const dependencies =
    cached && collectionReferencesMatch
      ? { ways: cached.forWays, stations: cached.forStations }
      : patternDependencies(system, pattern);
  if (
    cached &&
    sameReferences(cached.forWays, dependencies.ways) &&
    sameReferences(cached.forStations, dependencies.stations) &&
    profileMatches
  ) {
    cached.forWayArray = system.ways;
    cached.forStationArray = system.stations;
    return cached;
  }
  // The measurement — path, stops, timetable — comes from the same call the
  // Service inspector makes, so what a planner reads and what the map runs are
  // one object rather than two that agree. Lane geometry below is for DRAWING
  // only: it never measures time.
  const stats = patternStats(system.ways, system.stations, pattern, profile);
  if (!stats) return null;
  const centerline: LegGeometry = {
    path: stats.path,
    cumLengths: stats.cumLengths,
    meters: stats.meters,
  };
  const outPath =
    modeId !== undefined ? patternLanePath(system.ways, pattern, modeId, 'outbound') : null;
  const outbound = outPath && outPath.length >= 2 ? legFrom(outPath) : centerline;
  // Infrastructure view's return leg is a genuinely different polyline — the
  // lane on the other side of the street — so it is resolved, not mirrored.
  // In Network view the return centerline comes from the pattern's own
  // sections, which is the same line reversed for a plain line and a different
  // street for a couplet.
  const backPath =
    modeId !== undefined ? patternLanePath(system.ways, pattern, modeId, 'inbound') : null;
  const inbound =
    backPath && backPath.length >= 2
      ? legFrom(backPath)
      : stats.inboundPath.length >= 2
        ? legFrom(stats.inboundPath)
        : reversedLeg(centerline);
  let minLng = Infinity,
    minLat = Infinity,
    maxLng = -Infinity,
    maxLat = -Infinity;
  for (const [lng, lat] of [...outbound.path, ...inbound.path]) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  const geometry: CachedPatternGeometry = {
    outbound,
    inbound,
    timetables: stats.timetables,
    bbox: [minLng, minLat, maxLng, maxLat],
    forWayArray: system.ways,
    forStationArray: system.stations,
    forWays: dependencies.ways,
    forStations: dependencies.stations,
    forSpeedMps: profile.speedMps,
    forAccelMps2: profile.accelMps2,
    forDecelMps2: profile.decelMps2,
    forModeId: modeId,
  };
  patternGeometryCache.set(pattern, geometry);
  return geometry;
}

/**
 * The simulation's rendering host: one dot (Network) or true-scale footprint
 * (Infrastructure) per RUN, resolved from the simulated clock every tick.
 *
 * A pattern is the unit — a branch runs its own vehicles, same as its
 * trunk-sharing sibling. How many, and where each one is, comes from
 * core/sim: the schedule says whether the line is running and at what
 * headway, the fleet math turns that into a cycle, and the timetable walks
 * the path stopping at each station on the way.
 *
 * Bypasses the store entirely — like interactions.ts's rubber-band preview,
 * this is a pure rAF → GeoJSON source push, so it never touches undo history
 * or triggers a feature rebuild.
 */
// Ambient dots update at a FIXED cadence, decoupled from the render loop (a
// classic fixed-timestep sim tick). 30 Hz is imperceptibly different from
// 60/120 Hz for slow-moving dots, but it halves (at 60 Hz) or quarters (on the
// M3's 120 Hz ProMotion) both the position math and the setData churn — so the
// loop keeps running during a pan (per the UX call: agents stay live) without
// competing for the frame budget the pan needs. rAF still drives it, so it also
// auto-pauses while the tab is hidden.
const VEHICLE_UPDATE_INTERVAL_MS = 1000 / 30;

// The most real time one tick may hand the simulated clock. Covers a dropped
// frame or two without noticeably slowing the clock, while capping what a
// hidden tab (rAF suspended, then one enormous delta on return) can advance.
const MAX_TICK_ADVANCE_MS = 250;

interface VehicleProps {
  color: string;
}
type VehicleFeature = Feature<Point, VehicleProps>;
type InfrastructureVehicleFeature = Feature<Polygon, VehicleProps>;

export function attachVehicleAnimation(
  map: MLMap,
  store: EditorStore,
  clock: SimClock,
  gate: VehicleGate,
): () => void {
  let frame: number | null = null;
  let detached = false;
  let paintPausedFrame = false;
  let advancingClock = false;
  let idle = false;
  let lastUpdate = -Infinity;
  let lastRealNow = performance.now();
  let previousClockSettings = clock.settings();
  const schedules = new ScheduleResolver();

  // Reused across ticks so a frame allocates no vehicle features or coordinate
  // arrays (GC pressure at RTC scale — hundreds of vehicles every tick). `pool`
  // holds stable feature objects mutated in place; `collection.features` is
  // trimmed to the count actually used this tick.
  const pool: VehicleFeature[] = [];
  const collection: FeatureCollection<Point, VehicleProps> = {
    type: 'FeatureCollection',
    features: [],
  };
  const infrastructurePool: InfrastructureVehicleFeature[] = [];
  const infrastructureCollection: FeatureCollection<Polygon, VehicleProps> = {
    type: 'FeatureCollection',
    features: [],
  };
  let networkHasData = false;
  let infrastructureHasData = false;

  interface RenderInputs {
    system: TransitSystem;
    source: GeoJSONSource | undefined;
    infraSource: GeoJSONSource | undefined;
    viewMode: ReturnType<VehicleGate['viewMode']>;
    pinnedPeriod: string | undefined;
    visibleServices: Service[];
    bounds: [number, number, number, number];
    disabledForPerf: boolean;
  }

  const readRenderInputs = (): RenderInputs => {
    const { system } = store.getState();
    const bounds = map.getBounds();
    const visibleServices = system.services.filter((service) => gate.isVisible(service));
    return {
      system,
      source: map.getSource(SRC_VEHICLES) as GeoJSONSource | undefined,
      infraSource: map.getSource(SRC_VEHICLES_INFRA) as GeoJSONSource | undefined,
      viewMode: gate.viewMode(),
      pinnedPeriod: gate.pinnedPeriod(),
      visibleServices,
      bounds: [bounds.getWest(), bounds.getEast(), bounds.getSouth(), bounds.getNorth()],
      disabledForPerf: vehiclesDisabledForPerf(),
    };
  };

  const cancelScheduled = () => {
    if (frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    }
  };
  const scheduleFrame = (allowPaused = false) => {
    if (allowPaused) paintPausedFrame = true;
    if (detached || frame !== null || (clock.settings().paused && !allowPaused)) return;
    frame = requestAnimationFrame(tick);
  };
  const wake = (allowPaused = false) => {
    if (detached || (clock.settings().paused && !allowPaused)) return;
    scheduleFrame(allowPaused);
  };
  const setNetworkData = (
    source: GeoJSONSource | undefined,
    features: FeatureCollection<Point, VehicleProps>,
  ) => {
    const hasData = features.features.length > 0;
    if (hasData || networkHasData) source?.setData(features);
    networkHasData = hasData;
  };
  const setInfrastructureData = (
    source: GeoJSONSource | undefined,
    features: FeatureCollection<Polygon, VehicleProps>,
  ) => {
    const hasData = features.features.length > 0;
    if (hasData || infrastructureHasData) source?.setData(features);
    infrastructureHasData = hasData;
  };
  const clearSources = (source?: GeoJSONSource, infraSource?: GeoJSONSource) => {
    if (collection.features.length !== 0) collection.features.length = 0;
    if (infrastructureCollection.features.length !== 0)
      infrastructureCollection.features.length = 0;
    setNetworkData(source, collection);
    setInfrastructureData(infraSource, infrastructureCollection);
  };

  function tick() {
    frame = null;
    const paused = clock.settings().paused;
    const canPaintPaused = paintPausedFrame;
    paintPausedFrame = false;
    if (detached || (paused && !canPaintPaused)) return;
    const wokeFromIdle = idle;
    idle = false;
    const realNow = performance.now();
    const sinceLast = realNow - lastUpdate;
    if (!paused && sinceLast < VEHICLE_UPDATE_INTERVAL_MS) {
      // Preserve this across the cadence-only frame so the next real update
      // still catches up visible time spent intentionally unscheduled.
      idle = wokeFromIdle;
      scheduleFrame();
      return;
    }
    lastUpdate = realNow;
    // Real elapsed time drives the simulated clock — but clamped, because rAF
    // stops entirely while the tab is hidden, so `realDelta` on the first tick
    // back can be minutes. At 4x that would silently skip most of a simulated
    // day the moment someone returned to the tab. The simulation advances
    // while it's being watched; it doesn't run in the background and present
    // a fait accompli. The first tick starts at zero elapsed time so attaching
    // the renderer never jumps the clock merely to paint its initial frame.
    const realDelta = Math.max(0, realNow - lastRealNow);
    lastRealNow = realNow;
    advancingClock = !paused;
    const simMs = paused
      ? clock.now()
      : clock.advance(wokeFromIdle ? realDelta : Math.min(realDelta, MAX_TICK_ADVANCE_MS));
    advancingClock = false;
    const inputs = readRenderInputs();
    const { source, infraSource } = inputs;
    if (!source && !infraSource) {
      idle = true;
      return;
    }

    // DEV A/B: `__perf.vehicles = false` clears the dots so the pan benchmark
    // can measure the loop's share of the frame budget. No-op in production.
    if (inputs.disabledForPerf) {
      clearSources(source, infraSource);
      idle = true;
      return;
    }

    const { system, viewMode } = inputs;
    if (viewMode === 'diagram') {
      clearSources(source, infraSource);
      idle = true;
      return;
    }

    // Viewport cull bounds (read once/tick): the visible extent expanded by half
    // a viewport on each side, so a vehicle whose route edge is just off-screen
    // pops in with margin rather than at the bezel. Vegas is nowhere near the
    // antimeridian, so plain axis-aligned bbox intersection is safe.
    const [west, east, south, north] = inputs.bounds;
    const spanLng = east - west;
    const spanLat = north - south;
    const cullW = west - spanLng * 0.5;
    const cullE = east + spanLng * 0.5;
    const cullS = south - spanLat * 0.5;
    const cullN = north + spanLat * 0.5;

    let used = 0;
    let infrastructureUsed = 0;
    const emit = (coord: LngLat, color: string) => {
      const existing = pool[used];
      if (existing) {
        existing.properties.color = color;
        existing.geometry.coordinates[0] = coord[0];
        existing.geometry.coordinates[1] = coord[1];
      } else {
        pool[used] = {
          type: 'Feature',
          properties: { color },
          geometry: { type: 'Point', coordinates: [coord[0], coord[1]] },
        };
      }
      used++;
    };
    const emitInfrastructure = (
      coord: LngLat,
      bearing: number,
      widthM: number,
      lengthM: number,
      color: string,
    ) => {
      const ring = rotatedRectPolygon(coord, bearing, widthM, lengthM);
      const existing = infrastructurePool[infrastructureUsed];
      if (existing) {
        existing.properties.color = color;
        const target = existing.geometry.coordinates[0];
        target.length = ring.length;
        for (let i = 0; i < ring.length; i++) {
          const point = target[i];
          if (point) {
            point[0] = ring[i][0];
            point[1] = ring[i][1];
          } else {
            target[i] = [ring[i][0], ring[i][1]];
          }
        }
      } else {
        infrastructurePool[infrastructureUsed] = {
          type: 'Feature',
          properties: { color },
          geometry: {
            type: 'Polygon',
            coordinates: [ring],
          },
        };
      }
      infrastructureUsed++;
    };

    // What's running at this simulated moment. Resolved once for the whole
    // system rather than per service per pattern, and reused across frames
    // until the simulated minute changes.
    const running = schedules.resolve(
      system.services,
      minutesOfDay(simMs),
      dayScopeAt(simMs),
      inputs.pinnedPeriod,
    );
    for (const service of inputs.visibleServices) {
      // A service outside its span of service isn't running, so it costs
      // nothing — this check comes before geometry resolution on purpose.
      const active = running.get(service.id);
      if (!active) continue;
      const headwayMinutes = active.headwayMinutes;
      const { widthM, lengthM, profile } = effectiveVehicleKind(system.vehicleKinds, service);
      for (const pattern of service.patterns) {
        const geometry = resolvePatternGeometry(
          system,
          pattern,
          profile,
          viewMode === 'infrastructure' ? service.modeId : undefined,
        );
        if (!geometry) continue;
        // Viewport cull: skip patterns whose whole path is off-screen — scales
        // per-tick cost with ON-SCREEN patterns instead of all of them.
        const bb = geometry.bbox;
        if (bb[2] < cullW || bb[0] > cullE || bb[3] < cullS || bb[1] > cullN) continue;
        const { timetables } = geometry;
        // The cycle is built FROM the headway (see core/sim/fleet.ts), so
        // vehicles pass every stop exactly one headway apart instead of
        // approximately. Fleet size falls out of it.
        const plan = planService(
          roundTripMs(timetables),
          headwayMinutes === undefined ? undefined : headwayMinutes * 60_000,
        );
        // A rendering cap, NOT a modeling one: the plan keeps its true cycle
        // and headway, and we simply draw the first N runs. Clamping the
        // fleet itself would shorten the cycle below the round trip, which
        // no vehicle could actually run. Frequent service on a long line
        // therefore shows gaps at this cap rather than wrong spacing.
        const shown = Math.min(plan.fleet, MAX_VEHICLES_PER_PATTERN);
        if (shown < plan.fleet) noteClampedFleet(pattern.id, service.name, plan.fleet);
        for (let i = 0; i < shown; i++) {
          // Resolved against SIMULATED time, so the speed control and pause
          // work — and so a vehicle's position depends only on what time it
          // is in the simulation, not on how long this tab has been open.
          // `profile` is load-bearing, not decorative: the timetable was
          // BUILT at this vehicle kind's own profile, so walking it at the
          // module default instead would have the two disagree.
          const { distMeters, run } = runStateAt(simMs, timetables, plan, i, profile);
          // distMeters is measured along the path `run` names, so it is used
          // directly. This used to rescale a position off the outbound ruler
          // onto the return lane as a fraction, which was the only way to
          // cope with one ruler describing two polylines — and could not
          // have coped with two polylines of genuinely different length.
          const { path, cumLengths, meters: legMeters } = geometry[run];
          const along = Math.min(distMeters, legMeters);
          const t = legMeters > 0 ? along / legMeters : 0;
          // Distance → coordinate is an O(log n) binary search over precomputed
          // arc lengths, not a full-path re-walk (pointAtT).
          const center = pointAtDistance(path, cumLengths, along);
          if (viewMode === 'network') {
            emit(center, service.color);
          } else {
            // Both legs run point-order-along-travel, so the path's own
            // bearing is the direction the vehicle faces — a return-leg train
            // is drawn nose-first, not reversed.
            emitInfrastructure(
              center,
              bearingAtT(path, t, legMeters),
              widthM,
              lengthM,
              service.color,
            );
          }
        }
      }
    }

    if (collection.features.length !== used) collection.features.length = used;
    for (let i = 0; i < used; i++) collection.features[i] = pool[i];
    if (infrastructureCollection.features.length !== infrastructureUsed)
      infrastructureCollection.features.length = infrastructureUsed;
    for (let i = 0; i < infrastructureUsed; i++)
      infrastructureCollection.features[i] = infrastructurePool[i];
    setNetworkData(source, collection);
    setInfrastructureData(infraSource, infrastructureCollection);
    if (paused || (used === 0 && infrastructureUsed === 0)) idle = true;
    else scheduleFrame();
  }

  const unsubscribeSettings = clock.subscribeSettings((settings) => {
    const realNow = performance.now();
    if (!previousClockSettings.paused) {
      // The settings notification arrives after SimClock installs `settings`.
      // Settle the visible interval under the PREVIOUS speed before pausing or
      // changing speed; otherwise a long event-driven idle interval silently
      // disappears at the click that changes those settings.
      const before = clock.now();
      const caughtUp = advanceSimMs(
        before,
        Math.max(0, realNow - lastRealNow),
        simSpeed(previousClockSettings.speedId).simPerReal,
      );
      if (caughtUp !== before) {
        advancingClock = true;
        clock.setTime(caughtUp);
        advancingClock = false;
      }
    }
    previousClockSettings = settings;
    lastRealNow = realNow;
    lastUpdate = -Infinity;
    cancelScheduled();
    if (settings.paused) {
      scheduleFrame(true);
      return;
    }
    wake();
  });
  const unsubscribeTime = clock.subscribe(() => {
    if (advancingClock) return;
    // setTime defines the simulated instant at this real moment. Do not add
    // elapsed idle time from before that explicit jump on the next frame.
    lastRealNow = performance.now();
    lastUpdate = -Infinity;
    wake(clock.settings().paused);
  });
  let previousSystem = store.getState().system;
  const unsubscribeStore = store.subscribe((state) => {
    if (state.system === previousSystem) return;
    previousSystem = state.system;
    wake(true);
  });
  const wakeForCamera = () => wake(true);
  map.on('moveend', wakeForCamera);
  map.on('zoomend', wakeForCamera);
  const unsubscribeGate = gate.subscribe(() => wake(true));
  const onVisibilityChange = () => {
    const realNow = performance.now();
    if (document.visibilityState === 'hidden' && !clock.settings().paused) {
      // Capture the visible part of an idle interval before backgrounding.
      // Showing the tab resets the baseline below, preserving the rule that
      // hidden time never turns into a giant simulation jump.
      advancingClock = true;
      clock.advance(Math.max(0, realNow - lastRealNow));
      advancingClock = false;
    }
    lastRealNow = realNow;
    lastUpdate = -Infinity;
  };
  if (typeof document !== 'undefined')
    document.addEventListener('visibilitychange', onVisibilityChange);
  scheduleFrame(clock.settings().paused);
  return () => {
    detached = true;
    cancelScheduled();
    unsubscribeSettings();
    unsubscribeTime();
    unsubscribeStore();
    unsubscribeGate();
    map.off('moveend', wakeForCamera);
    map.off('zoomend', wakeForCamera);
    if (typeof document !== 'undefined')
      document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}
