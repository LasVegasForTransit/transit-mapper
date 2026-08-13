import { cumulativeLengths, patternWayIds } from '@transitmapper/core/model/geo';
import { patternLanePath } from '@transitmapper/core/geometry/vehicleLane';
import type { LngLat, Pattern, Stop, TransitSystem, Way } from '@transitmapper/core/model/system';
import type { RunTimetables, VehicleMotionProfile } from '@transitmapper/core/sim/timetable';
import { patternStats } from '@transitmapper/core/sim/serviceStats';

/** One direction of a pattern's drawable geometry. */
interface LegGeometry {
  path: LngLat[];
  /** Prefix-sum arc lengths for `path`, retained for O(log n) position lookup. */
  cumLengths: Float64Array;
  meters: number;
}

/**
 * Geometry and motion measurements shared by every rendered run on a pattern.
 *
 * The two legs are distinct because Infrastructure view can put them on
 * different lanes and a couplet can use different streets in each direction.
 */
export interface PatternGeometry {
  outbound: LegGeometry;
  inbound: LegGeometry;
  timetables: RunTimetables;
  /** Bounds [minLng, minLat, maxLng, maxLat] covering both directions. */
  bbox: [number, number, number, number];
}

interface CachedPatternGeometry extends PatternGeometry {
  // Top-level collection identities are the zero-allocation fast path.
  forWayArray: Way[];
  forStopArray: Stop[];
  // These references identify the smaller dependency set that can invalidate
  // this pattern when either top-level collection changes.
  forWays: Array<Way | undefined>;
  forStops: Stop[];
  // effectiveVehicleKind returns a fresh object, so compare profile fields.
  forSpeedMps: number;
  forAccelMps2: number;
  forDecelMps2: number;
  // Undefined selects the Network centerline. A mode id selects lane geometry.
  forModeId: string | undefined;
}

interface PatternDependencies {
  ways: Array<Way | undefined>;
  stops: Stop[];
}

const patternGeometryCache = new WeakMap<Pattern, CachedPatternGeometry>();
const patternWayIdCache = new WeakMap<Pattern, string[]>();
const wayIndexCache = new WeakMap<Way[], Map<string, Way>>();
const stopIndexCache = new WeakMap<Stop[], Map<string, Stop[]>>();

function legFrom(path: LngLat[]): LegGeometry {
  const cumLengths = cumulativeLengths(path);
  return { path, cumLengths, meters: cumLengths[cumLengths.length - 1] };
}

/**
 * Reverse a centerline without recalculating every point-to-point distance.
 * Subtracting the forward prefix sums from the total gives prefix sums in the
 * reversed point order.
 */
function reversedLeg(leg: LegGeometry): LegGeometry {
  const n = leg.path.length;
  const cumLengths = new Float64Array(n);
  for (let i = 0; i < n; i++) cumLengths[i] = leg.meters - leg.cumLengths[n - 1 - i];
  return { path: [...leg.path].reverse(), cumLengths, meters: leg.meters };
}

function indexedWays(ways: Way[]): Map<string, Way> {
  let index = wayIndexCache.get(ways);
  if (index) return index;
  index = new Map(ways.map((way) => [way.id, way]));
  wayIndexCache.set(ways, index);
  return index;
}

function indexedStops(stops: Stop[]): Map<string, Stop[]> {
  let index = stopIndexCache.get(stops);
  if (index) return index;
  index = new Map();
  for (const stop of stops) {
    for (const anchor of stop.anchors) {
      const onWay = index.get(anchor.wayId);
      if (onWay) onWay.push(stop);
      else index.set(anchor.wayId, [stop]);
    }
  }
  stopIndexCache.set(stops, index);
  return index;
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
  const stopsByWay = indexedStops(system.stops);
  const stops: Stop[] = [];
  const seenStops = new Set<Stop>();

  for (const wayId of wayIds) {
    for (const stop of stopsByWay.get(wayId) ?? []) {
      if (seenStops.has(stop)) continue;
      seenStops.add(stop);
      stops.push(stop);
    }
  }

  return {
    ways: wayIds.map((id) => waysById.get(id)),
    stops,
  };
}

function sameReferences<T>(left: T[], right: T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * Resolve one pattern's measured paths, reusing a warm cache until one of the
 * ways, stops, profile fields, or view-mode lane choices it depends on
 * changes.
 */
export function resolvePatternGeometry(
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
    cached?.forWayArray === system.ways && cached.forStopArray === system.stops;
  if (cached && profileMatches && collectionReferencesMatch) return cached;

  const dependencies =
    cached && collectionReferencesMatch
      ? { ways: cached.forWays, stops: cached.forStops }
      : patternDependencies(system, pattern);
  if (
    cached &&
    sameReferences(cached.forWays, dependencies.ways) &&
    sameReferences(cached.forStops, dependencies.stops) &&
    profileMatches
  ) {
    cached.forWayArray = system.ways;
    cached.forStopArray = system.stops;
    return cached;
  }

  // Measurement comes from the same call as the Service inspector. Lane
  // geometry below affects drawing only; it never changes timetable duration.
  const stats = patternStats(system.ways, system.stops, pattern, profile);
  if (!stats) return null;

  const centerline: LegGeometry = {
    path: stats.path,
    cumLengths: stats.cumLengths,
    meters: stats.meters,
  };
  const outboundPath =
    modeId !== undefined ? patternLanePath(system.ways, pattern, modeId, 'outbound') : null;
  const outbound = outboundPath && outboundPath.length >= 2 ? legFrom(outboundPath) : centerline;
  const inboundPath =
    modeId !== undefined ? patternLanePath(system.ways, pattern, modeId, 'inbound') : null;
  const inbound =
    inboundPath && inboundPath.length >= 2
      ? legFrom(inboundPath)
      : stats.inboundPath.length >= 2
        ? legFrom(stats.inboundPath)
        : reversedLeg(centerline);

  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
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
    forStopArray: system.stops,
    forWays: dependencies.ways,
    forStops: dependencies.stops,
    forSpeedMps: profile.speedMps,
    forAccelMps2: profile.accelMps2,
    forDecelMps2: profile.decelMps2,
    forModeId: modeId,
  };
  patternGeometryCache.set(pattern, geometry);
  return geometry;
}
