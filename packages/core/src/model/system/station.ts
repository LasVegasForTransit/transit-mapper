import { shortId } from '../ids';
import type { LngLat } from './valueTypes';

// Where a station rides on a way: normalized arc-length position [0,1] along
// that way's resolved path. Recomputing the coord from this anchor is how a
// station follows its way when the alignment is reshaped.
export interface StationAnchor {
  wayId: string;
  t: number;
}

/** A platform's physical geometry inside a station (infrastructure view). */
export interface Platform {
  id: string;
  points: LngLat[];
  /** Number of platform edges that board (1 = side, 2 = island). */
  edges?: number;
}

export interface Station {
  id: string;
  name?: string;
  /** True while `name` is still exactly what suggestStopName last computed
   *  for this station — never set once a user types their own text into the
   *  name field. Gates which stations model/geo/crossStreetNaming.ts's
   *  resyncAutoNamedStations may safely overwrite when a later action (e.g.
   *  drawing a service through a previously-unserved stop) changes what the
   *  suggestion would be; a user's own name is never touched automatically,
   *  no matter what changes around it.
   *
   *  Nothing in the type system ties this to `name` — TypeScript can't reject
   *  a `{ ...station, name: x }` that forgets it. Any code that sets `.name`
   *  outside setStationName/withSuggestedStationName below must decide this
   *  deliberately: real, agency-sourced text (e.g. gtfsImport.ts's
   *  stop_name) leaves it unset, since that name is strictly better than a
   *  guess and must never be silently replaced. */
  autoNamed?: boolean;
  /** Position as a network node, snapped onto its way's path. */
  coord: LngLat;
  /**
   * The ways this station rides. Empty for a free-floating station.
   *
   * A list, because one platform can genuinely belong to two ways: a transit
   * centre both halves of a one-way couplet pull into, or an island platform
   * between the two tracks of a line. With a single anchor the station bound
   * to whichever way was nearest when it was placed, and every line on the
   * other one drove past a stop it plainly calls at — which a GTFS feed
   * reusing one stop_id for both directions produces on every import.
   *
   * Ordered: the first is the one a bare "which way is this on" question gets,
   * and the one whose alignment moves the station when it is reshaped.
   */
  anchors: StationAnchor[];
  /** Physical boundary polygon, drawn in the infrastructure view. */
  footprint?: LngLat[];
  /** Platform geometry inside the station (infrastructure view). */
  platforms?: Platform[];
  /** How long a vehicle sits here before departing, in seconds — boarding/
   *  alighting time for the ambient vehicle animation (map/vehicles.ts).
   *  Undefined uses that module's own default. */
  dwellSeconds?: number;
  /** Marks a station as a "major stop" for LABEL PRIORITY: its name shows at a
   *  lower (more zoomed-out) zoom than an ordinary stop, alongside derived
   *  interchanges. Interchange status is derived by proximity and can't be
   *  hand-set, so this is the manual override for "this stop matters" (a
   *  terminal, a timepoint) even when it isn't an interchange. The label
   *  tiering in map/layers/layerSpecs.ts already respects it (via buildFeatures'
   *  `major` property); the StationInspector control to toggle it is a
   *  near-future follow-up. */
  majorStop?: boolean;
}

/** A new, unanchored-unless-given station at `coord` — the one place a bare
 *  Station literal gets constructed, so every call site (editor/store.ts's
 *  addStation, any future importer) builds the identical shape. */
export function createStation(coord: LngLat, anchor?: StationAnchor): Station {
  return { id: shortId(), coord, anchors: anchor ? [anchor] : [] };
}

/** Applies an automatic name only when the naming workflow found one. */
export function withSuggestedStationName<StationType extends Station>(
  station: StationType,
  name: string | null | undefined,
): StationType {
  return name ? { ...station, name, autoNamed: true } : station;
}

interface StationDocument {
  stations: Station[];
}

function sameCoord(left: LngLat, right: LngLat): boolean {
  return left[0] === right[0] && left[1] === right[1];
}

function sameAnchor(left: StationAnchor | undefined, right: StationAnchor | undefined): boolean {
  return left?.wayId === right?.wayId && left?.t === right?.t;
}

function replaceStation<System extends StationDocument>(
  system: System,
  id: string,
  update: (station: Station) => Station,
): System {
  const index = system.stations.findIndex((station) => station.id === id);
  if (index < 0) return system;
  const current = system.stations[index];
  const station = update(current);
  if (station === current) return system;
  const stations = [...system.stations];
  stations[index] = station;
  return { ...system, stations };
}

/** Moves a station and replaces its complete anchor set. */
export function moveStation<System extends StationDocument>(
  system: System,
  id: string,
  coord: LngLat,
  anchor?: StationAnchor,
): System {
  return replaceStation(system, id, (station) => {
    const anchorCount = anchor ? 1 : 0;
    if (
      sameCoord(station.coord, coord) &&
      station.anchors.length === anchorCount &&
      sameAnchor(station.anchors[0], anchor)
    ) {
      return station;
    }
    return { ...station, coord, anchors: anchor ? [anchor] : [] };
  });
}

/** Sets a station name and whether future automatic naming may replace it. */
export function setStationName<System extends StationDocument>(
  system: System,
  id: string,
  name: string,
  autoNamed: boolean,
): System {
  return replaceStation(system, id, (station) =>
    station.name === name && (station.autoNamed ?? false) === autoNamed
      ? station
      : { ...station, name, autoNamed },
  );
}

export function setStationDwellSeconds<System extends StationDocument>(
  system: System,
  id: string,
  dwellSeconds: number | undefined,
): System {
  return replaceStation(system, id, (station) =>
    station.dwellSeconds === dwellSeconds ? station : { ...station, dwellSeconds },
  );
}

export function setStationMajorStop<System extends StationDocument>(
  system: System,
  id: string,
  major: boolean,
): System {
  return replaceStation(system, id, (station) => {
    const majorStop = major || undefined;
    return station.majorStop === majorStop ? station : { ...station, majorStop };
  });
}

export function addStationFootprint<System extends StationDocument>(
  system: System,
  id: string,
  footprint: LngLat[],
): System {
  return replaceStation(system, id, (station) =>
    station.footprint ? station : { ...station, footprint },
  );
}

export function moveStationFootprintPoint<System extends StationDocument>(
  system: System,
  id: string,
  index: number,
  coord: LngLat,
): System {
  return replaceStation(system, id, (station) => {
    const point = station.footprint?.[index];
    if (!station.footprint || !point || sameCoord(point, coord)) return station;
    return {
      ...station,
      footprint: station.footprint.map((candidate, candidateIndex) =>
        candidateIndex === index ? coord : candidate,
      ),
    };
  });
}

/** Removing a station footprint also removes its footprint-owned platforms. */
export function deleteStationFootprint<System extends StationDocument>(
  system: System,
  id: string,
): System {
  return replaceStation(system, id, (station) =>
    station.footprint || station.platforms
      ? { ...station, footprint: undefined, platforms: undefined }
      : station,
  );
}

export function addStationPlatform<System extends StationDocument>(
  system: System,
  id: string,
  platform: Platform,
): System {
  return replaceStation(system, id, (station) => ({
    ...station,
    platforms: [...(station.platforms ?? []), platform],
  }));
}

export interface StationPlatformPointMove {
  stationId: string;
  platformId: string;
  index: number;
  coord: LngLat;
}

export function moveStationPlatformPoint<System extends StationDocument>(
  system: System,
  move: StationPlatformPointMove,
): System {
  return replaceStation(system, move.stationId, (station) => {
    const platform = station.platforms?.find((candidate) => candidate.id === move.platformId);
    const point = platform?.points[move.index];
    if (!platform || !point || sameCoord(point, move.coord)) return station;
    return {
      ...station,
      platforms: station.platforms?.map((candidate) =>
        candidate.id === move.platformId
          ? {
              ...candidate,
              points: candidate.points.map((candidatePoint, candidateIndex) =>
                candidateIndex === move.index ? move.coord : candidatePoint,
              ),
            }
          : candidate,
      ),
    };
  });
}

export function deleteStationPlatform<System extends StationDocument>(
  system: System,
  stationId: string,
  platformId: string,
): System {
  return replaceStation(system, stationId, (station) => {
    const platforms = station.platforms?.filter((platform) => platform.id !== platformId);
    return platforms?.length === station.platforms?.length ? station : { ...station, platforms };
  });
}
