import { shortId } from '../ids';
import type { LngLat } from './valueTypes';

// Where a stop rides on a way: normalized arc-length position [0,1] along
// that way's resolved path. Recomputing the coord from this anchor is how a
// stop follows its way when the alignment is reshaped.
export interface StopAnchor {
  wayId: string;
  t: number;
}

export interface Stop {
  id: string;
  name?: string;
  /** Optional passenger place containing this boarding point. */
  stationId?: string;
  /** True while `name` is still exactly what suggestStopName last computed
   *  for this stop — never set once a user types their own text into the
   *  name field. Gates which stops model/geo/crossStreetNaming.ts's
   *  resyncAutoNamedStops may safely overwrite when a later action (e.g.
   *  drawing a service through a previously-unserved stop) changes what the
   *  suggestion would be; a user's own name is never touched automatically,
   *  no matter what changes around it.
   *
   *  Nothing in the type system ties this to `name` — TypeScript can't reject
   *  a `{ ...stop, name: x }` that forgets it. Any code that sets `.name`
   *  outside setStopName/withSuggestedStopName below must decide this
   *  deliberately: real, agency-sourced text (e.g. gtfsImport.ts's
   *  stop_name) leaves it unset, since that name is strictly better than a
   *  guess and must never be silently replaced. */
  autoNamed?: boolean;
  /** Position as a network node, snapped onto its way's path. */
  coord: LngLat;
  /**
   * The ways this stop rides. Empty for a free-floating stop.
   *
   * A list, because one platform can genuinely belong to two ways: a transit
   * centre both halves of a one-way couplet pull into, or an island platform
   * between the two tracks of a line. With a single anchor the stop bound
   * to whichever way was nearest when it was placed, and every line on the
   * other one drove past a stop it plainly calls at — which a GTFS feed
   * reusing one stop_id for both directions produces on every import.
   *
   * Ordered: the first is the one a bare "which way is this on" question gets.
   * Reshaping any anchored way reprojects the shared stop coordinate.
   */
  anchors: StopAnchor[];
  /** How long a vehicle sits here before departing, in seconds — boarding/
   *  alighting time for the ambient vehicle animation (map/vehicles.ts).
   *  Undefined uses that module's own default. */
  dwellSeconds?: number;
  /** Marks a stop as a "major stop" for LABEL PRIORITY: its name shows at a
   *  lower (more zoomed-out) zoom than an ordinary stop, alongside derived
   *  interchanges. Interchange status is derived by proximity and can't be
   *  hand-set, so this is the manual override for "this stop matters" (a
   *  terminal, a timepoint) even when it isn't an interchange. The label
   *  tiering in map/layers/layerSpecs.ts already respects it (via buildFeatures'
   *  `major` property); the StopInspector control to toggle it is a
   *  near-future follow-up. */
  majorStop?: boolean;
}

/** A new, unanchored-unless-given stop at `coord` — the one place a bare
 *  Stop literal gets constructed, so editor stop commands and future
 *  importers build the identical shape. */
export function createStop(coord: LngLat, anchor?: StopAnchor): Stop {
  return { id: shortId(), coord, anchors: anchor ? [anchor] : [] };
}

/** Applies an automatic name only when the naming workflow found one. */
export function withSuggestedStopName<StopType extends Stop>(
  stop: StopType,
  name: string | null | undefined,
): StopType {
  if (!name || (stop.name === name && stop.autoNamed === true)) return stop;
  return { ...stop, name, autoNamed: true };
}

interface StopDocument {
  stops: Stop[];
}

function sameCoord(left: LngLat, right: LngLat): boolean {
  return left[0] === right[0] && left[1] === right[1];
}

function sameAnchor(left: StopAnchor | undefined, right: StopAnchor | undefined): boolean {
  return left?.wayId === right?.wayId && left?.t === right?.t;
}

function replaceStop<System extends StopDocument>(
  system: System,
  id: string,
  update: (stop: Stop) => Stop,
): System {
  const index = system.stops.findIndex((stop) => stop.id === id);
  if (index < 0) return system;
  const current = system.stops[index];
  const stop = update(current);
  if (stop === current) return system;
  const stops = [...system.stops];
  stops[index] = stop;
  return { ...system, stops };
}

/** Moves a stop and replaces its complete anchor set. */
export function moveStop<System extends StopDocument>(
  system: System,
  id: string,
  coord: LngLat,
  anchor?: StopAnchor,
): System {
  return replaceStop(system, id, (stop) => {
    const anchorCount = anchor ? 1 : 0;
    if (
      sameCoord(stop.coord, coord) &&
      stop.anchors.length === anchorCount &&
      sameAnchor(stop.anchors[0], anchor)
    ) {
      return stop;
    }
    return { ...stop, coord, anchors: anchor ? [anchor] : [] };
  });
}

/** Sets a stop name and whether future automatic naming may replace it. */
export function setStopName<System extends StopDocument>(
  system: System,
  id: string,
  name: string,
  autoNamed: boolean,
): System {
  return replaceStop(system, id, (stop) =>
    stop.name === name && (stop.autoNamed ?? false) === autoNamed
      ? stop
      : { ...stop, name, autoNamed },
  );
}

export function setStopDwellSeconds<System extends StopDocument>(
  system: System,
  id: string,
  dwellSeconds: number | undefined,
): System {
  return replaceStop(system, id, (stop) =>
    stop.dwellSeconds === dwellSeconds ? stop : { ...stop, dwellSeconds },
  );
}

export function setStopMajorStop<System extends StopDocument>(
  system: System,
  id: string,
  major: boolean,
): System {
  return replaceStop(system, id, (stop) => {
    const majorStop = major || undefined;
    return stop.majorStop === majorStop ? stop : { ...stop, majorStop };
  });
}
