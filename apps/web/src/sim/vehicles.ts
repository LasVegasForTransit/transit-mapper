import type { Feature, FeatureCollection, Point, Polygon } from 'geojson';
import type { GeoJSONSource, Map as MLMap } from 'maplibre-gl';
import type { EditorStore } from '../editor/store';
import {
  bearingAtT,
  cumulativeLengths,
  nearestOnPath,
  patternPath,
  pointAtDistance,
  rotatedRectPolygon,
} from '@transitmapper/core/model/geo';
import { patternLanePath } from '@transitmapper/core/geometry/vehicleLane';
import { vehicleFootprint } from '@transitmapper/core/model/catalog';
import type {
  LngLat,
  Pattern,
  SchedulePeriod,
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
  buildTimetable,
  VEHICLE_SPEED_MPS,
  type DwellStop,
  type Timetable,
} from '@transitmapper/core/sim/timetable';
import { planService, runStateAt } from '@transitmapper/core/sim/fleet';

// How many of a pattern's vehicles get DRAWN. Not a claim about how many it
// runs — the plan's fleet can exceed this, and the cap only limits what's on
// screen (see the comment at its use). A frequent line on a long alignment can
// legitimately need dozens of vehicles; drawing all of them at RTC scale is a
// per-frame cost with no visual payoff at the zoom levels a whole system is
// viewed at.
const MAX_VEHICLES_PER_PATTERN = 12;
// Doors open, board/alight, doors close — a plausible light-rail/bus dwell
// when a station doesn't specify its own (Station.dwellSeconds).
const DEFAULT_DWELL_SECONDS = 20;

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
}

/** Which real vehicle a service's animation/rendering should use: its
 *  assigned VehicleKind if it has one and it still exists, else the
 *  mode's plain default (vehicleFootprint) at the app's ambient default
 *  speed — the exact behavior every service had before vehicle kinds
 *  existed, so an unassigned service is never affected by this feature. */
export function effectiveVehicleKind(
  system: TransitSystem,
  service: Service,
): { widthM: number; lengthM: number; speedMps: number } {
  const kind = service.vehicleKindId
    ? system.vehicleKinds.find((k) => k.id === service.vehicleKindId)
    : undefined;
  if (kind) {
    return {
      widthM: kind.widthM,
      lengthM: kind.lengthM,
      speedMps: kind.topSpeedKmh !== undefined ? kind.topSpeedKmh / 3.6 : VEHICLE_SPEED_MPS,
    };
  }
  return { ...vehicleFootprint(service.modeId), speedMps: VEHICLE_SPEED_MPS };
}

/** The headway vehicle count/spacing is computed against — a detailed
 *  schedule (see system.ts's SchedulePeriod) supersedes the plain
 *  frequencyMinutes field when present; its BUSIEST (lowest-headway) period
 *  wins, since this is ambient decoration ("what does this line look like
 *  at its busiest"), not a simulation with a notion of current time of day.
 *  Undefined (nothing set at all) keeps today's original one-vehicle
 *  behavior — see the `?? 1` count below. */
// Same WeakMap-on-array-reference pattern as stationsByWayCache/
// patternGeometryCache below — this runs every animation frame per visible
// service, and `service.schedule` only gets a new reference when the
// schedule itself actually changes.
const headwayCache = new WeakMap<SchedulePeriod[], number>();

function effectiveHeadwayMinutes(service: Service): number | undefined {
  if (service.schedule && service.schedule.length > 0) {
    let headway = headwayCache.get(service.schedule);
    if (headway === undefined) {
      headway = Math.min(...service.schedule.map((p) => p.frequencyMinutes));
      headwayCache.set(service.schedule, headway);
    }
    return headway;
  }
  return service.frequencyMinutes;
}

// Stations grouped by their anchor way id, cached by the stations array's
// own reference — safe because the store replaces `system.stations`
// immutably on every mutation (same convention as geo.ts's wayPathCache),
// so a stale index is simply never looked up again. Without this,
// dwellStopsForPattern did a full linear scan of every station in the
// system for every pattern on every animation frame — fine for a few dozen
// hand-drawn stations, but for a real GTFS import (thousands of stations,
// hundreds of patterns) that's hundreds of thousands of comparisons
// *per frame*, continuously, for as long as the tab stays open — confirmed
// live against RTC Southern Nevada's real feed as a sustained freeze, not
// just a one-time slow render.
const stationsByWayCache = new WeakMap<Station[], Map<string, Station[]>>();

function stationsByWay(stations: Station[]): Map<string, Station[]> {
  let index = stationsByWayCache.get(stations);
  if (index) return index;
  index = new Map();
  for (const st of stations) {
    if (!st.anchor) continue;
    const arr = index.get(st.anchor.wayId);
    if (arr) arr.push(st);
    else index.set(st.anchor.wayId, [st]);
  }
  stationsByWayCache.set(stations, index);
  return index;
}

/** Every station actually anchored to one of this pattern's ways (the same
 *  "is this a stop on this branch" test the Route tab's stop-sequence list
 *  uses), positioned by arc-length along the pattern's full resolved path
 *  (via nearestOnPath) rather than by way-index — the more useful measure
 *  here, since the animation walks the path by distance, not by way. */
export function dwellStopsForPattern(
  system: TransitSystem,
  pattern: Pattern,
  path: LngLat[],
  totalMeters: number,
): DwellStop[] {
  const byWay = stationsByWay(system.stations);
  const stops: DwellStop[] = [];
  for (const wayId of pattern.wayIds) {
    for (const st of byWay.get(wayId) ?? []) {
      const near = nearestOnPath(path, st.coord);
      if (!near) continue;
      stops.push({
        distMeters: near.t * totalMeters,
        dwellMs: (st.dwellSeconds ?? DEFAULT_DWELL_SECONDS) * 1000,
      });
    }
  }
  return stops.sort((a, b) => a.distMeters - b.distMeters);
}

interface PatternGeometry {
  path: LngLat[];
  meters: number;
  timetable: Timetable;
  /** Prefix-sum arc lengths for `path` (see cumulativeLengths) — precomputed
   *  once here so the per-tick position lookup is an O(log n) binary search
   *  (pointAtDistance) instead of re-walking the whole path every frame. */
  cumLengths: Float64Array;
  /** Axis-aligned bounds [minLng, minLat, maxLng, maxLat] of the full path.
   *  Every possible vehicle position lies inside it, so a pattern whose bbox is
   *  off-screen can be culled wholesale before computing any of its vehicles. */
  bbox: [number, number, number, number];
}

// Keyed by the Pattern object's own reference, but a Pattern only holds
// {id, wayIds, name} — reshaping a way (drag) or moving/editing a station
// replaces system.ways/stations, NOT the Pattern object those ways/stations
// belong to, so keying on Pattern reference alone never invalidates for
// either edit: the cache entry also records which `ways`/`stations` array
// references it was computed against, and a hit is only trusted if BOTH
// still match the current system — otherwise it's recomputed (and the entry
// updated) same as a miss. Without the caching at all, the animation tick
// (every frame) redid the full path-stitching + arc-length + stop-lookup
// work for every pattern; fine at a few dozen hand-drawn patterns, but a
// real GTFS import (hundreds of patterns, each with a long, detailed
// street-following path) turned that into a sustained ~150ms/frame cost — a
// permanently janky tab, not just a slow first render. Confirmed live
// against RTC Southern Nevada's real feed. The ways/stations check means an
// active drag (any drag, not just one touching this pattern's own ways —
// `system.ways`/`stations` get a fresh top-level array reference on every
// store mutation regardless of which way was touched) invalidates every
// pattern's cache for that frame, same cost as no caching at all — but only
// for the duration of the drag gesture; once it ends the cache re-warms and
// stays warm until the next edit. Correct-but-momentarily-uncached during an
// edit beats fast-but-visibly-wrong (a vehicle stuck on a pre-edit alignment)
// for however long the pattern stays on screen afterward.
interface CachedPatternGeometry extends PatternGeometry {
  forWays: Way[];
  forStations: Station[];
  forSpeedMps: number;
  // undefined = Network view's raw centerline (patternPath); a mode id =
  // Infrastructure view's lane-aware path (patternLanePath) for that mode.
  // One cache slot per Pattern is enough — only one view is ever ticking at
  // a time, so a Pattern never needs both variants live simultaneously;
  // switching views just costs one recompute, same as any other edit.
  forModeId: string | undefined;
}
const patternGeometryCache = new WeakMap<Pattern, CachedPatternGeometry>();

function resolvePatternGeometry(
  system: TransitSystem,
  pattern: Pattern,
  speedMps: number,
  modeId?: string,
): PatternGeometry | null {
  const cached = patternGeometryCache.get(pattern);
  if (
    cached &&
    cached.forWays === system.ways &&
    cached.forStations === system.stations &&
    cached.forSpeedMps === speedMps &&
    cached.forModeId === modeId
  )
    return cached;
  const path =
    modeId !== undefined
      ? patternLanePath(system.ways, pattern, modeId)
      : patternPath(system.ways, pattern);
  if (path.length < 2) return null;
  const cumLengths = cumulativeLengths(path);
  const meters = cumLengths[cumLengths.length - 1];
  if (meters === 0) return null;
  let minLng = Infinity,
    minLat = Infinity,
    maxLng = -Infinity,
    maxLat = -Infinity;
  for (const [lng, lat] of path) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  const stops = dwellStopsForPattern(system, pattern, path, meters);
  const timetable = buildTimetable(meters, stops, speedMps);
  const geometry: CachedPatternGeometry = {
    path,
    meters,
    timetable,
    cumLengths,
    bbox: [minLng, minLat, maxLng, maxLat],
    forWays: system.ways,
    forStations: system.stations,
    forSpeedMps: speedMps,
    forModeId: modeId,
  };
  patternGeometryCache.set(pattern, geometry);
  return geometry;
}

/**
 * Ambient delight, not simulation: one or more dots per PATTERN (a branch
 * has its own, same as its own trunk-sharing sibling) running back and
 * forth along its route at a plausible constant speed, pausing to dwell at
 * each station along the way (Station.dwellSeconds, or DEFAULT_DWELL_SECONDS
 * when unset) — the moment this stops being a bare speed/distance triangle
 * wave and starts reading as a train that actually stops for people. How
 * MANY dots is headway-driven — a 5-minute line visibly runs more vehicles
 * than a 30-minute one, so the number typed into the Inspector actually
 * shows up on the map instead of being inert. Bypasses the store entirely —
 * like interactions.ts's rubber-band preview, this is a pure rAF → GeoJSON
 * source push, so it never touches undo history or triggers a feature
 * rebuild.
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

export function attachVehicleAnimation(
  map: MLMap,
  store: EditorStore,
  clock: SimClock,
  gate: VehicleGate,
): () => void {
  let frame: number;
  let lastUpdate = -Infinity;

  // Reused across ticks so a frame allocates no vehicle features or coordinate
  // arrays (GC pressure at RTC scale — hundreds of vehicles every tick). `pool`
  // holds stable feature objects mutated in place; `collection.features` is
  // trimmed to the count actually used this tick.
  const pool: VehicleFeature[] = [];
  const collection: FeatureCollection<Point, VehicleProps> = {
    type: 'FeatureCollection',
    features: [],
  };

  const tick = () => {
    frame = requestAnimationFrame(tick);
    const realNow = performance.now();
    const sinceLast = realNow - lastUpdate;
    if (sinceLast < VEHICLE_UPDATE_INTERVAL_MS) return; // fixed-timestep throttle
    lastUpdate = realNow;
    // Real elapsed time drives the simulated clock — but clamped, because rAF
    // stops entirely while the tab is hidden, so `sinceLast` on the first tick
    // back can be minutes. At 4x that would silently skip most of a simulated
    // day the moment someone returned to the tab. The simulation advances
    // while it's being watched; it doesn't run in the background and present
    // a fait accompli. (The very first tick's delta is Infinity, and is
    // clamped by the same rule.)
    const simMs = clock.advance(Math.min(sinceLast, MAX_TICK_ADVANCE_MS));
    const source = map.getSource(SRC_VEHICLES) as GeoJSONSource | undefined;
    const infraSource = map.getSource(SRC_VEHICLES_INFRA) as GeoJSONSource | undefined;
    if (!source && !infraSource) return;

    // DEV A/B: `__perf.vehicles = false` clears the dots so the pan benchmark
    // can measure the loop's share of the frame budget. No-op in production.
    if (vehiclesDisabledForPerf()) {
      if (collection.features.length !== 0) {
        collection.features.length = 0;
        source?.setData(collection);
      }
      infraSource?.setData({ type: 'FeatureCollection', features: [] });
      return;
    }

    const { system } = store.getState();
    const viewMode = gate.viewMode();
    const infraFeatures: Feature<Polygon>[] = [];

    // Viewport cull bounds (read once/tick): the visible extent expanded by half
    // a viewport on each side, so a vehicle whose route edge is just off-screen
    // pops in with margin rather than at the bezel. Vegas is nowhere near the
    // antimeridian, so plain axis-aligned bbox intersection is safe.
    const vb = map.getBounds();
    const spanLng = vb.getEast() - vb.getWest();
    const spanLat = vb.getNorth() - vb.getSouth();
    const cullW = vb.getWest() - spanLng * 0.5;
    const cullE = vb.getEast() + spanLng * 0.5;
    const cullS = vb.getSouth() - spanLat * 0.5;
    const cullN = vb.getNorth() + spanLat * 0.5;

    let used = 0;
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

    if (viewMode === 'network' || viewMode === 'infrastructure') {
      for (const service of system.services) {
        if (!gate.isVisible(service)) continue;
        const headwayMinutes = effectiveHeadwayMinutes(service);
        const { widthM, lengthM, speedMps } = effectiveVehicleKind(system, service);
        for (const pattern of service.patterns) {
          const geometry = resolvePatternGeometry(
            system,
            pattern,
            speedMps,
            viewMode === 'infrastructure' ? service.modeId : undefined,
          );
          if (!geometry) continue;
          // Viewport cull: skip patterns whose whole path is off-screen — scales
          // per-tick cost with ON-SCREEN patterns instead of all of them.
          const bb = geometry.bbox;
          if (bb[2] < cullW || bb[0] > cullE || bb[3] < cullS || bb[1] > cullN) continue;
          const { path, meters, timetable, cumLengths } = geometry;
          // The cycle is built FROM the headway (see core/sim/fleet.ts), so
          // vehicles pass every stop exactly one headway apart instead of
          // approximately. Fleet size falls out of it.
          const plan = planService(
            2 * timetable.oneWayMs,
            headwayMinutes === undefined ? undefined : headwayMinutes * 60_000,
          );
          // A rendering cap, NOT a modeling one: the plan keeps its true cycle
          // and headway, and we simply draw the first N runs. Clamping the
          // fleet itself would shorten the cycle below the round trip, which
          // no vehicle could actually run. Frequent service on a long line
          // therefore shows gaps at this cap rather than wrong spacing.
          const shown = Math.min(plan.fleet, MAX_VEHICLES_PER_PATTERN);
          for (let i = 0; i < shown; i++) {
            // Resolved against SIMULATED time, so the speed control and pause
            // work — and so a vehicle's position depends only on what time it
            // is in the simulation, not on how long this tab has been open.
            // `speedMps` is load-bearing, not decorative: the timetable was
            // BUILT at this vehicle kind's own speed, so walking it at the
            // module default instead would have the two disagree.
            const { distMeters: distFromStart } = runStateAt(
              simMs,
              timetable,
              meters,
              plan,
              i,
              speedMps,
            );
            // Distance → coordinate is an O(log n) binary search over precomputed
            // arc lengths, not a full-path re-walk (pointAtT).
            if (viewMode === 'network') {
              emit(pointAtDistance(path, cumLengths, distFromStart), service.color);
            } else {
              const t = meters === 0 ? 0 : distFromStart / meters;
              const center = pointAtDistance(path, cumLengths, distFromStart);
              const bearing = bearingAtT(path, t, meters);
              infraFeatures.push({
                type: 'Feature',
                properties: { color: service.color },
                geometry: {
                  type: 'Polygon',
                  coordinates: [rotatedRectPolygon(center, bearing, widthM, lengthM)],
                },
              });
            }
          }
        }
      }
    }

    if (collection.features.length !== used) collection.features.length = used;
    for (let i = 0; i < used; i++) collection.features[i] = pool[i];
    source?.setData(collection);
    infraSource?.setData({ type: 'FeatureCollection', features: infraFeatures });
  };
  frame = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(frame);
}
