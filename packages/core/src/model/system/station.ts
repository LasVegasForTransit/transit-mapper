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
   *  no matter what changes around it. */
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
