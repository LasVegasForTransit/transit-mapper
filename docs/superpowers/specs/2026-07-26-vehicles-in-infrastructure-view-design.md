# Vehicles rendered as real 2D shapes in Infrastructure view

## Context

Moving vehicles ("agents" — buses, trains) already animate along their
service's route: `apps/web/src/sim/vehicles.ts` walks each visible
`Pattern`'s path every animation frame and writes `Point` features (a
`color` property, nothing else) into the `SRC_VEHICLES` GeoJSON source,
drawn by a plain `circle` layer. They are gated to Network view only, by one
line in `MapCanvas.tsx` (`viewMode === "network"`), and the path they walk
(`patternPath`, `packages/core/src/model/geo/servicePaths.ts`) is always the
way's raw centerline — never lane-aware.

Infrastructure view can fan a multi-lane way (`capacity > 1`) into its
constituent lanes. At most zoom levels this is a cheap pixel-offset visual
trick with no real per-lane coordinates (`emitCrossSection`,
`packages/core/src/render/buildFeatures.ts`); only at lane-detail zoom
(≥15, `LANE_DETAIL_MIN_ZOOM`) does real per-lane geometry get computed
(`wayLaneGeometry`, `packages/core/src/geometry/streets.ts`), memoized per
`Way`.

The project has an established convention for physical, real-world-scale
things: station footprints and platforms are actual drawn polygon geometry
(`Station.footprint`/`platforms`), rendered via `fill`+stroke layers
(`FOOTPRINT_FILL`/`PLATFORM_FILL` etc. in
`packages/core/src/style/catalogStyle.ts`) — never points or icons standing
in for them. This spec extends that same treatment to vehicles: in
Infrastructure view, a vehicle is drawn as its actual physical footprint (a
real, correctly-sized, correctly-rotated polygon sitting in its real lane),
not a dot or a raster icon.

## Goals

- In Infrastructure view, every visible vehicle renders as a real 2D
  polygon shape, scaled to its mode's approximate true-world dimensions
  (width × length in meters), rotated to face its direction of travel, and
  positioned in the actual physical lane it is running in — not the way's
  centerline.
- Vehicle shape size alone gives real mode differentiation (e.g. a ~27m
  rail car reads unmistakably differently from a ~12m bus at true scale).
- Network view is unaffected: same small colored dot, same centerline
  position, as today.
- Works correctly at RTC-scale data (thousands of stations, hundreds of
  patterns) without introducing a new per-frame hot path — reuse existing
  per-`Way` memoization wherever possible.

## Non-goals

- Per-mode custom silhouette outlines (rounded train ends, a ferry hull
  shape, a gondola cabin). v1 ships true-to-scale **rectangles** per mode;
  richer per-mode outlines are a follow-on polish pass on the same
  pipeline, not required here.
- Upgrading Network view's vehicle rendering (e.g. to small per-mode
  icons). Explicitly out of scope for this change; the existing dot stays.
- Vehicles in Diagram view. They are not rendered there today and stay
  that way.
- Persisting a user-editable lane assignment per route in the data model.
  Lane choice is derived at render time (see below), not stored.
- Fixing `patternPath`'s pre-existing lack of direction-awareness for
  Network view. That function is untouched; the new direction-detection
  logic below is additive and local to the new lane-aware path.

## Architecture

### 1. Direction detection (new)

`Pattern.wayIds` is just an ordered list of way IDs — nothing today records
whether a pattern traverses a given way *with* or *against* that way's own
stored point order. This has never mattered before because a plain
centerline path looks the same either way; it matters now because lane
selection needs to know which physical direction the vehicle is going.

New helper in `packages/core/src/model/geo/servicePaths.ts` (or a sibling
file) walks `pattern.wayIds` in order and, for each way after the first,
compares the way's own raw endpoints against the previous way's resolved
exit point — whichever endpoint is closer determines whether this way is
walked forward or reversed for this pattern. The first way in a pattern has
no prior segment to compare against and defaults to its stored order.

### 2. Lane selection heuristic (new)

Given a way, a resolved travel direction through it, and the vehicle's
mode, pick which of the way's real lanes (`wayLaneGeometry(way).lanes`) the
vehicle rides:

1. Filter to lanes whose `direction` matches (`"both"` always matches).
2. Prefer a lane whose `kindId` is in the mode's `preferredLaneKindIds`
   (new field on `MODES`, `packages/core/src/model/catalog.ts` — e.g. bus/
   brt prefer `["bus", "drive"]`; tram/light rail running on a `road` way
   prefer `["track", "drive"]`; rail modes on their own dedicated way type
   only ever see `track` lanes, so no ambiguity there). This lives in the
   catalog, not the style module — it's domain data about which physical
   lane a mode is compatible with, the same category as `wayTypeIds`.
3. If more than one candidate remains (e.g. a two-lane one-way road), pick
   the one closest to the way's centerline (smallest `|offsetM|`),
   deterministically. No per-vehicle memory needed — a way's lane set is
   fixed along its whole length.

### 3. Lane-accurate pattern path (new)

A new function, same shape as `patternPath` (`(ways, pattern) => LngLat[]`),
stitches each way's *selected lane path* (from step 2, using its
`WayLaneGeometry.lanes[i].path` — already correctly oriented for direction
via the existing `arrows` handling in `streets.ts`) instead of the way's
centerline. Everything downstream — `resolvePatternGeometry`'s caching,
`metersAtElapsed`, `pointAtT` — is unchanged; only the input polyline
differs. This is computed lazily, only when Infrastructure view is actually
active, alongside (not replacing) the existing centerline path used by
Network view.

### 4. Vehicle footprint and rendering (new)

Per animation frame, for each visible vehicle in Infrastructure view:

- Position: `pointAtT` on the lane-accurate path from step 3.
- Bearing: local tangent of that path at the current `t` (same technique
  already used for lane direction arrows).
- Shape: a rotated rectangle polygon, generated by a new small helper
  (alongside `offsetPolyline` in `packages/core/src/model/geo/planar.ts`)
  taking a center point, bearing, width (m), and length (m).
- Dimensions: a new per-mode table in `catalogStyle.ts` (approximate real
  width/length in meters; rail-family modes can share one entry). Style
  module, not catalog — this governs how big to *draw* the mode, the same
  category as `MODE_RENDER`'s color/width today.

These polygons go into a new source (`SRC_VEHICLES_INFRA`) and a new layer
(`fill` + outline, structurally the same pair as `LYR_FOOTPRINTS`/
`LYR_PLATFORMS`), visible only in Infrastructure view. Unlike footprints
(monochrome ink fill, since they belong to no single service), a vehicle's
fill is its route color — the same color the Network-view dot already
uses — with an ink outline stroke, since a vehicle *does* belong to one
service.

Network view's existing `SRC_VEHICLES` circle layer, and the centerline
path it uses, are untouched.

## Testing

- Unit coverage for the direction-detection helper (a pattern whose ways
  alternate stored orientation) and the lane-selection heuristic (mode
  preference, direction filter, centerline tie-break), in the project's
  existing test convention.
- Browser verification: a multi-lane road carrying more than one mode,
  confirming each vehicle sits in a plausible real lane, rotates correctly
  along a curve, and switches lanes sensibly at a lane-count change:
  through a junction, at RTC-scale data to confirm no new per-frame hot
  path (reuse the `__perf`/`__panBench` harness).

## Open follow-ups (not blocking this spec)

- Per-mode custom silhouettes beyond a plain rectangle.
- Small per-mode icons for Network view (currently explicitly out of
  scope, using the same icon-registration pipeline facilities already
  use).
- Letting a person choose *which* vehicle a mode runs (different real
  dimensions/speed for the same mode), rather than one fixed size per
  mode. See [Vehicle catalogs](2026-07-26-vehicle-catalogs-design.md),
  which builds directly on this spec's per-mode default table and
  polygon rendering.
