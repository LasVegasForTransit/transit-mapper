// Import a real GTFS feed as a comparison baseline — "what does RTC actually
// run today, next to what I'm proposing." Same two-layer split as OSM import
// (model/import.ts): pure, network-free transforms (parseGtfsCsv,
// classifyGtfsRouteType, buildGtfsIndex, piecesForRoutes, gtfsFilesToSystemPieces)
// that fixture data can exercise directly, plus streamRtcGtfsBatches, the one
// function that touches the network.
import { unzipSync, strFromU8 } from 'fflate';
import { shortId } from './ids';
import { deriveServiceLevels, type DerivedServiceLevel } from './gtfsSchedule';
import { defaultProfileFor, makeOneWay } from './profile';
import { wayType } from './catalog';
import { haversineMeters, nearestOnPath, resolveWayPath, wholeLeg, oneSection } from './geo';
import type { LngLat, Pattern, Service, Station, Way } from './system';

export interface GtfsImportResult {
  ways: Way[];
  services: Service[];
  stations: Station[];
}

// GTFS routes.txt's route_type enum → this app's catalog
// (https://gtfs.org/schedule/reference/#routestxt). A route type this app
// has no dedicated equivalent for (trolleybus, funicular) falls back to the
// closest physical match rather than being dropped.
const ROUTE_TYPE_KIND: Record<number, { modeId: string; wayTypeId: string }> = {
  0: { modeId: 'tram', wayTypeId: 'lightRail' }, // Tram, streetcar, light rail
  1: { modeId: 'subway', wayTypeId: 'heavyRail' }, // Subway, metro
  2: { modeId: 'commuterRail', wayTypeId: 'heavyRail' }, // Rail
  3: { modeId: 'bus', wayTypeId: 'road' }, // Bus
  4: { modeId: 'ferry', wayTypeId: 'water' }, // Ferry
  5: { modeId: 'tram', wayTypeId: 'lightRail' }, // Cable tram
  6: { modeId: 'gondola', wayTypeId: 'aerial' }, // Aerial lift
  7: { modeId: 'monorail', wayTypeId: 'monorail' }, // Funicular — no dedicated catalog kind
  11: { modeId: 'bus', wayTypeId: 'road' }, // Trolleybus — no dedicated catalog kind
  12: { modeId: 'monorail', wayTypeId: 'monorail' }, // Monorail
};
const DEFAULT_ROUTE_KIND = { modeId: 'bus', wayTypeId: 'road' };

export function classifyGtfsRouteType(routeType: number): { modeId: string; wayTypeId: string } {
  return ROUTE_TYPE_KIND[routeType] ?? DEFAULT_ROUTE_KIND;
}

/** Minimal GTFS text-file CSV parser (comma-separated, optional
 *  double-quote wrapping, "" for an escaped quote) — GTFS fields never need
 *  more than that, so a hand-rolled parser is enough; no dependency for it. */
export function parseGtfsCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < normalized.length; i++) {
    const c = normalized[i];
    if (inQuotes) {
      if (c === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  return rows
    .slice(1)
    .filter((r) => r.length > 1 || r[0] !== '')
    .map((r) => {
      const obj: Record<string, string> = {};
      header.forEach((h, i) => {
        obj[h] = (r[i] ?? '').trim();
      });
      return obj;
    });
}

export interface GtfsFiles {
  routes: string;
  trips: string;
  stops: string;
  stopTimes: string;
  shapes?: string;
  /** Optional, and most feeds omit it. When present it states each route's
   *  headway directly, which beats measuring one off stop_times — see
   *  gtfsSchedule.ts. */
  frequencies?: string;
}

/** How far a pair's facing terminals may sit apart and still be the two ends
 *  of one line. A couplet loops round a block at each end, so this is a block.
 *  Not measured against a real feed yet — RTC Southern Nevada's is the one to
 *  check it against before trusting it on anything but obvious pairs. */
const SHAPE_PAIR_TERMINAL_M = 400;

/** A short-turn shares a terminal with the full run it shortens, so only
 *  length tells them apart. */
const SHAPE_PAIR_LENGTH_TOLERANCE = 0.25;

export interface ShapePairing {
  /** Shapes that are the two directions of one path. */
  couplets: { outbound: string; inbound: string }[];
  /** Shapes with no opposite number — a branch, a short-turn, a one-way loop.
   *  Each becomes its own undivided pattern, exactly as every shape did. */
  singles: string[];
}

/**
 * Which of a route's shapes are the two directions of one path.
 *
 * GTFS says a route runs shapes; it never says which two are a pair. Two facts
 * together do, and neither alone is enough. `direction_id` splits the trips
 * into the route's two directions, but a route with four shapes has two per
 * direction and pairing them arbitrarily marries a short-turn to a full run.
 * A pair's geometry is each other's reverse — one shape ends where the other
 * begins, at both ends — but two genuinely different branches share a terminal
 * too.
 *
 * So: bucket by direction_id, order each bucket busiest-first (the same "the
 * dominant variant is the real one" reasoning as gtfsSchedule's
 * dominantServiceId), and greedily pair on facing endpoints plus similar total
 * length. A feed with no direction_id pairs nothing, which is what this did
 * before and the only honest reading of it.
 */
export function pairRouteShapes(
  shapeIds: string[],
  shapePaths: Map<string, LngLat[]>,
  shapeDirection: Map<string, string>,
  shapeTripCount: Map<string, number>,
): ShapePairing {
  const buckets = new Map<string, string[]>();
  for (const id of shapeIds) {
    const dir = shapeDirection.get(id) ?? '';
    if (!buckets.has(dir)) buckets.set(dir, []);
    buckets.get(dir)!.push(id);
  }
  const dirs = [...buckets.keys()];
  // One bucket means the feed never said which direction anything runs.
  if (dirs.length !== 2) return { couplets: [], singles: [...shapeIds] };

  const byTrips = (a: string, b: string) =>
    (shapeTripCount.get(b) ?? 0) - (shapeTripCount.get(a) ?? 0);
  const left = [...buckets.get(dirs[0])!].sort(byTrips);
  const right = [...buckets.get(dirs[1])!].sort(byTrips);

  const lengthOf = (id: string) => {
    const path = shapePaths.get(id) ?? [];
    let m = 0;
    for (let i = 1; i < path.length; i++) m += haversineMeters(path[i - 1], path[i]);
    return m;
  };
  const facingGap = (a: string, b: string): number | null => {
    const pa = shapePaths.get(a);
    const pb = shapePaths.get(b);
    if (!pa || !pb || pa.length < 2 || pb.length < 2) return null;
    return haversineMeters(pa[pa.length - 1], pb[0]) + haversineMeters(pb[pb.length - 1], pa[0]);
  };

  const couplets: ShapePairing['couplets'] = [];
  const taken = new Set<string>();
  for (const a of left) {
    let best: { id: string; gap: number } | null = null;
    for (const b of right) {
      if (taken.has(b)) continue;
      const gap = facingGap(a, b);
      if (gap === null || gap > 2 * SHAPE_PAIR_TERMINAL_M) continue;
      const la = lengthOf(a);
      const lb = lengthOf(b);
      const longer = Math.max(la, lb);
      if (longer > 0 && Math.abs(la - lb) / longer > SHAPE_PAIR_LENGTH_TOLERANCE) continue;
      if (!best || gap < best.gap) best = { id: b, gap };
    }
    if (!best) continue;
    taken.add(a);
    taken.add(best.id);
    couplets.push({ outbound: a, inbound: best.id });
  }
  return { couplets, singles: shapeIds.filter((id) => !taken.has(id)) };
}

interface GtfsIndex {
  routeById: Map<string, Record<string, string>>;
  stopById: Map<string, Record<string, string>>;
  shapePaths: Map<string, LngLat[]>;
  shapeToRoute: Map<string, string>;
  shapeToTrip: Map<string, string>;
  shapeDirection: Map<string, string>;
  shapeTripCount: Map<string, number>;
  stopTimesByTrip: Map<string, { seq: number; stopId: string }[]>;
  /** routeId -> its shapeIds, in the order first seen — the unit a batch is drawn from. */
  routeShapeIds: Map<string, string[]>;
  /** routeId -> how often it runs. Empty for a feed whose stop_times carry no
   *  usable departure times. */
  serviceLevelByRoute: Map<string, DerivedServiceLevel>;
}

/** Parse every GTFS file and build the lookup structures the transform
 *  needs — cheap relative to the transform itself, so this stays one
 *  synchronous pass rather than something that needs batching of its own. */
function buildGtfsIndex(files: GtfsFiles): GtfsIndex {
  const routes = parseGtfsCsv(files.routes);
  const trips = parseGtfsCsv(files.trips);
  const stops = parseGtfsCsv(files.stops);
  const stopTimes = parseGtfsCsv(files.stopTimes);
  const shapePoints = files.shapes ? parseGtfsCsv(files.shapes) : [];

  const shapeGroups = new Map<string, { seq: number; coord: LngLat }[]>();
  for (const r of shapePoints) {
    const shapeId = r.shape_id;
    if (!shapeId) continue;
    const lat = Number(r.shape_pt_lat);
    const lon = Number(r.shape_pt_lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (!shapeGroups.has(shapeId)) shapeGroups.set(shapeId, []);
    shapeGroups.get(shapeId)!.push({ seq: Number(r.shape_pt_sequence) || 0, coord: [lon, lat] });
  }
  const shapePaths = new Map<string, LngLat[]>();
  for (const [shapeId, pts] of shapeGroups) {
    pts.sort((a, b) => a.seq - b.seq);
    shapePaths.set(
      shapeId,
      pts.map((p) => p.coord),
    );
  }

  const stopById = new Map(stops.map((s) => [s.stop_id, s]));
  const routeById = new Map(routes.map((r) => [r.route_id, r]));

  // First trip wins for each shape — a shape belongs to one route/one
  // representative stop sequence in every feed this needs to handle.
  const shapeToRoute = new Map<string, string>();
  const shapeToTrip = new Map<string, string>();
  /** Which of the route's two directions a shape belongs to. gtfsSchedule.ts
   *  already reads direction_id for headway maths and throws it away; kept
   *  here because it is half of what says two shapes are one line. */
  const shapeDirection = new Map<string, string>();
  /** How many trips run each shape. The other half: a route has several shapes
   *  per direction (detours, short-turns), and pairing without this marries a
   *  short-turn to the full run back. */
  const shapeTripCount = new Map<string, number>();
  for (const t of trips) {
    if (!t.shape_id || !t.route_id) continue;
    shapeTripCount.set(t.shape_id, (shapeTripCount.get(t.shape_id) ?? 0) + 1);
    if (shapeToRoute.has(t.shape_id)) continue;
    shapeToRoute.set(t.shape_id, t.route_id);
    shapeToTrip.set(t.shape_id, t.trip_id);
    shapeDirection.set(t.shape_id, String(t.direction_id ?? ''));
  }

  const stopTimesByTrip = new Map<string, { seq: number; stopId: string }[]>();
  for (const st of stopTimes) {
    if (!st.trip_id || !st.stop_id) continue;
    if (!stopTimesByTrip.has(st.trip_id)) stopTimesByTrip.set(st.trip_id, []);
    stopTimesByTrip
      .get(st.trip_id)!
      .push({ seq: Number(st.stop_sequence) || 0, stopId: st.stop_id });
  }

  const routeShapeIds = new Map<string, string[]>();
  for (const [shapeId, routeId] of shapeToRoute) {
    if (!shapePaths.has(shapeId) || (shapePaths.get(shapeId)?.length ?? 0) < 2) continue;
    if (!routeShapeIds.has(routeId)) routeShapeIds.set(routeId, []);
    routeShapeIds.get(routeId)!.push(shapeId);
  }

  return {
    shapeDirection,
    shapeTripCount,
    routeById,
    stopById,
    shapePaths,
    shapeToRoute,
    shapeToTrip,
    stopTimesByTrip,
    routeShapeIds,
    serviceLevelByRoute: deriveServiceLevels({
      trips,
      stopTimes,
      frequencies: files.frequencies ? parseGtfsCsv(files.frequencies) : undefined,
    }),
  };
}

/** Ways/Services for just the given routes, plus any Stations newly reached
 *  by them — `stationByStopId` is the whole import's shared dedup map (a
 *  stop shared by a route in an earlier batch and one in this batch must
 *  still resolve to the same Station), so it's passed in and mutated rather
 *  than started fresh each call. */
function piecesForRoutes(
  index: GtfsIndex,
  routeIds: string[],
  stationByStopId: Map<string, Station>,
): GtfsImportResult {
  const ways: Way[] = [];
  const wayIdByShape = new Map<string, string>();
  const services: Service[] = [];

  for (const routeId of routeIds) {
    const route = index.routeById.get(routeId);
    const shapeIds = index.routeShapeIds.get(routeId) ?? [];
    if (!route || shapeIds.length === 0) continue;
    const kind = classifyGtfsRouteType(Number(route.route_type));

    const patterns: Pattern[] = [];
    // Two shapes that end where the other begins are the two directions of one
    // line, not two branches of it. Importing them as branches is what this
    // used to do, and it is wrong in a way that reads as right: the map draws
    // both, and the fleet maths counts each as its own out-and-back.
    const pairing = pairRouteShapes(
      shapeIds,
      index.shapePaths,
      index.shapeDirection,
      index.shapeTripCount,
    );
    const mintWay = (shapeId: string): string | null => {
      const points = index.shapePaths.get(shapeId);
      if (!points || points.length < 2) return null;
      const wayId = shortId();
      wayIdByShape.set(shapeId, wayId);
      ways.push({
        id: wayId,
        typeId: kind.wayTypeId,
        points,
        geometry: 'straight',
        grade: 'atGrade',
        // A GTFS shape is ONE direction of travel (a route's two directions are
        // separate shapes, points ordered start→end by shape_pt_sequence), so
        // model it as a one-way carriageway in that direction ("forward" = point
        // order). Buses (road) get a lean 2-lane carriageway rather than the
        // default 4-lane two-way road, so opposite-direction routes on a shared
        // corridor read as thin directional carriageways instead of stacked roads.
        profile: makeOneWay(
          defaultProfileFor(kind.wayTypeId, wayType(kind.wayTypeId).importedCapacity),
          'forward',
        ),
        source: `gtfs:${shapeId}`,
      });
      return wayId;
    };

    for (const { outbound, inbound } of pairing.couplets) {
      const outWay = mintWay(outbound);
      const backWay = mintWay(inbound);
      if (!outWay || !backWay) continue;
      // Both legs run their own shape in its own point order: each shape is
      // already drawn start→finish of the trip it describes, and each direction
      // of a split section is read in its OWN ride order. Writing the return
      // leg backwards here is the tempting mistake, and it would drive the
      // return trip the wrong way down its own street.
      patterns.push({
        id: shortId(),
        sections: [{ kind: 'split', outbound: [wholeLeg(outWay)], inbound: [wholeLeg(backWay)] }],
      });
    }
    for (const shapeId of pairing.singles) {
      const wayId = mintWay(shapeId);
      if (!wayId) continue;
      // A freshly minted shape way is traversed in its own point order,
      // end to end — the one case where direction and extent need no
      // derivation at all.
      patterns.push({ id: shortId(), sections: oneSection([wholeLeg(wayId)]) });
    }
    if (patterns.length === 0) continue;

    services.push({
      id: shortId(),
      name: route.route_short_name || route.route_long_name || `Route ${routeId}`,
      modeId: kind.modeId,
      color: route.route_color ? `#${route.route_color}` : '#e4572e',
      patterns,
      // How often it runs, recovered from the feed. Spread rather than
      // assigned field by field so a route whose timing couldn't be read
      // stays exactly as it was before: no headway, no span, one vehicle.
      ...(index.serviceLevelByRoute.get(routeId) ?? {}),
    });
  }

  const newStations: Station[] = [];
  for (const [shapeId, wayId] of wayIdByShape) {
    const tripId = index.shapeToTrip.get(shapeId);
    const stopSeq = tripId && index.stopTimesByTrip.get(tripId);
    if (!stopSeq) continue;
    const way = ways.find((w) => w.id === wayId)!;
    const path = resolveWayPath(way);
    for (const { stopId } of [...stopSeq].sort((a, b) => a.seq - b.seq)) {
      if (stationByStopId.has(stopId)) continue;
      const stop = index.stopById.get(stopId);
      if (!stop) continue;
      const lat = Number(stop.stop_lat);
      const lon = Number(stop.stop_lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const coord: LngLat = [lon, lat];
      const nearest = nearestOnPath(path, coord);
      const station: Station = {
        id: shortId(),
        name: stop.stop_name || undefined,
        coord: nearest ? nearest.coord : coord,
        anchor: nearest ? { wayId, t: nearest.t } : undefined,
      };
      stationByStopId.set(stopId, station);
      newStations.push(station);
    }
  }

  return { ways, services, stations: newStations };
}

/**
 * Pure transform: parsed GTFS text files → catalog-typed Ways/Services/
 * Stations, all at once. One Way per distinct shape (not per trip, to avoid
 * duplicating geometry across every scheduled run of the same route), one
 * Service per route with one Pattern per shape that route uses (a branch/
 * express variant becomes a second Pattern automatically), and one Station
 * per stop actually served, anchored onto whichever shape's Way it sits
 * nearest — a stop shared by several routes still becomes exactly one
 * Station, matching how a hand-drawn interchange works. See
 * streamRtcGtfsBatches for the batched/live version of this same transform.
 */
export function gtfsFilesToSystemPieces(files: GtfsFiles): GtfsImportResult {
  const index = buildGtfsIndex(files);
  return piecesForRoutes(index, [...index.routeShapeIds.keys()], new Map());
}

/** Same transform as gtfsFilesToSystemPieces, split into route batches in
 *  the same order streamRtcGtfsBatches yields them — network-free (no fetch
 *  to mock), so fixture tests can check the batched path produces the exact
 *  same total ways/services/stations as the unbatched one. */
export function gtfsFilesToBatchedPieces(files: GtfsFiles, batchSize = 2): GtfsImportResult[] {
  const index = buildGtfsIndex(files);
  const routeIds = [...index.routeShapeIds.keys()];
  const stationByStopId = new Map<string, Station>();
  const batches: GtfsImportResult[] = [];
  for (let i = 0; i < routeIds.length; i += batchSize) {
    batches.push(piecesForRoutes(index, routeIds.slice(i, i + batchSize), stationByStopId));
  }
  return batches;
}

export interface GtfsImportBatch {
  pieces: GtfsImportResult;
  routesDone: number;
  routesTotal: number;
}

/**
 * RTC Southern Nevada's real, actively-maintained GTFS feed — fetched
 * through the Worker's /api/gtfs/rtc proxy since the feed's own host
 * doesn't send CORS headers for cross-origin browser fetches — parsed, then
 * handed back a few routes at a time instead of all at once. A route's
 * worth of ways/stations is small (built in well under a frame), and
 * yielding between batches lets the caller merge each one into the map
 * immediately and hand control back to the browser before starting the
 * next — the system visibly builds up route by route instead of the tab
 * going unresponsive for the whole import and then snapping to "done" (the
 * ~40 MB of GTFS text this feed unpacks to made that the norm, not an edge
 * case). The only function here that touches the network.
 */
export async function* streamRtcGtfsBatches(batchSize = 2): AsyncGenerator<GtfsImportBatch> {
  const res = await fetch('/api/gtfs/rtc');
  if (!res.ok) throw new Error(`GTFS import failed (${res.status}).`);
  const zip = unzipSync(new Uint8Array(await res.arrayBuffer()));
  const read = (name: string) => (zip[name] ? strFromU8(zip[name]) : '');
  const index = buildGtfsIndex({
    routes: read('routes.txt'),
    trips: read('trips.txt'),
    stops: read('stops.txt'),
    stopTimes: read('stop_times.txt'),
    frequencies: read('frequencies.txt'),
    shapes: read('shapes.txt'),
  });

  const routeIds = [...index.routeShapeIds.keys()];
  const stationByStopId = new Map<string, Station>();
  for (let i = 0; i < routeIds.length; i += batchSize) {
    const batch = routeIds.slice(i, i + batchSize);
    const pieces = piecesForRoutes(index, batch, stationByStopId);
    yield {
      pieces,
      routesDone: Math.min(i + batchSize, routeIds.length),
      routesTotal: routeIds.length,
    };
    // Hand control back to the browser between batches — setTimeout, not
    // requestAnimationFrame: rAF callbacks are paused indefinitely by most
    // browsers once the tab isn't visible/focused, which would silently
    // stall an in-progress import the moment someone switched tabs (a real,
    // reproduced failure mode, not a hypothetical one — confirmed live: an
    // rAF-based yield here hung mid-import once the tab lost focus).
    // setTimeout keeps firing (throttled, never paused) regardless.
    await new Promise((r) => setTimeout(r, 0));
  }
}
