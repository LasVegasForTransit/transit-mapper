// Document-level value types with no single entity owner — shared vocabulary
// every other system/ file draws from. No real function fits any of these
// individually (they're plain coordinate/enum/scalar shapes), so this file
// is a deliberate, accepted exception to "no pure-types module" — the same
// standing share/contract.ts already has as a cross-package wire contract.

export type LngLat = [number, number];

// How a way's path is drawn between its control points.
export type LineGeometry = 'straight' | 'curved' | 'freeform';

export interface Viewport {
  center: LngLat;
  zoom: number;
}

/** Which physical side of a two-way road forward-direction traffic keeps to
 *  — a regional/jurisdictional property, one value for the whole document
 *  (you don't mix driving sides within one contiguous network), never
 *  per-way. Defaults to "right" (Las Vegas; most of the world) so every
 *  existing document keeps behaving identically unless explicitly changed. */
export type DrivingSide = 'left' | 'right';

/** Travel direction of a lane, relative to its way's point order. "both" is
 *  a bidirectional lane (center turn lane, single-track rail, a path);
 *  "none" is a lane nothing travels along (median, parking). */
export type LaneDirection = 'forward' | 'backward' | 'both' | 'none';

/** How traffic through a junction is controlled — rendering + (later)
 *  simulation semantics, not topology. `levelCrossing` is distinct from the
 *  rest: it's not a traffic-control choice someone picks, but the marker a
 *  guideway-crosses-a-non-major-road junction always carries (see
 *  formCrossingJunctions in model/crossing-edits.ts) — a real at-grade
 *  crossing between two physically incompatible way types, gates and all,
 *  as opposed to an ordinary same-type intersection. */
export type NodeControl =
  'uncontrolled' | 'signal' | 'stop' | 'yield' | 'roundabout' | 'levelCrossing';

/** Which days a SchedulePeriod runs. Deliberately coarse (not a specific
 *  weekday set or calendar) — this is a fantasy-system planning tool, not a
 *  GTFS calendar_dates.txt editor. */
export type ScheduleDayScope = 'daily' | 'weekday' | 'weekend';
