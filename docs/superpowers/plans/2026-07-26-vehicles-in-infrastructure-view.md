# Vehicles in Infrastructure View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render each service's animated vehicles in Infrastructure view as real, true-to-scale rotated-rectangle polygons riding their actual physical lane — not the raw way centerline, and not a raster icon — while leaving Network view's existing colored-dot rendering untouched.

**Architecture:** A new `geometry/vehicleLane.ts` module derives, per pattern, which direction it travels each way (nothing tracks this today) and which real lane it rides (mode preference → direction filter → nearest-centerline tie-break), then stitches those lane paths into one polyline the same shape as today's `patternPath`. `sim/vehicles.ts` gains a parallel, lazily-computed geometry cache built from that lane-aware path, and its per-frame tick pushes rotated-rectangle `Polygon` features (real width/length in meters, rotated to bearing) to a new source/layer pair in Infrastructure view, while Network view keeps pushing `Point` features to the existing source exactly as before.

**Tech Stack:** TypeScript, MapLibre GL, the monorepo's existing `check()`-based verification harness (`apps/web/scripts/verify.ts`, run via `npm run verify` / `tsx apps/web/scripts/verify.ts` — this repo does not use vitest/jest yet).

**Spec:** [docs/superpowers/specs/2026-07-26-vehicles-in-infrastructure-view-design.md](../specs/2026-07-26-vehicles-in-infrastructure-view-design.md)

**A note on "TDD" in this codebase:** there is no per-file test runner — every check lives in one compiled TypeScript file (`apps/web/scripts/verify.ts`) that imports the real modules directly. Writing a `check()` call against a function that doesn't exist yet fails the whole file to *compile*, not just that one check — so the practical red/green cycle here is: implement a small, focused function → add `check()` calls exercising it → run the whole harness once → confirm every check (old and new) prints `ok`. Each task below still lands one focused unit at a time.

---

### Task 1: Direction detection + lane selection + lane-aware pattern path

**Files:**
- Create: `packages/core/src/geometry/vehicleLane.ts`
- Modify: `apps/web/scripts/verify.ts` (add imports + checks)

This is the core of the feature. It must live in `geometry/`, not `model/geo/` — `geometry/streets.ts` already imports from `model/`, so a `model/` file importing back from `geometry/` would be circular. `geometry/` already depends on `model/`, so this new file can safely import both.

- [x] **Step 1: Write `patternWayTraversals` (direction detection)**

Create `packages/core/src/geometry/vehicleLane.ts`:

```ts
// Vehicle-in-Infrastructure-view geometry: which direction a pattern
// travels each of its ways, which real physical lane it rides, and the
// lane-aware polyline that results — the Infrastructure-view analog of
// model/geo/servicePaths.ts's patternPath, which only ever produces the
// way's raw centerline. Lives in geometry/, not model/geo/, because it
// needs wayLaneGeometry (geometry/streets.ts), which itself depends on
// model/ — a model/ file reaching back into geometry/ would be circular.

import { haversineMeters, resolveWayPath, wayById } from "../model/geo";
import { mode } from "../model/catalog";
import type { LaneDirection, LngLat, Pattern, Way } from "../model/system";
import { wayLaneGeometry, type LanePath } from "./streets";

/** One way in a pattern's sequence, with which direction (relative to the
 *  way's own stored point order) the pattern travels it. Nothing in the
 *  data model records this today — `Pattern.wayIds` is just an ordered
 *  list of ids — so it's derived by continuity: each way after the first
 *  is oriented toward whichever of its own endpoints sits closer to the
 *  previous way's resolved exit point. The first way has no prior segment
 *  to compare against and keeps its stored order. */
export interface WayTraversal {
  way: Way;
  forward: boolean;
}

export function patternWayTraversals(ways: Way[], pattern: Pattern): WayTraversal[] {
  const byId = wayById(ways);
  const out: WayTraversal[] = [];
  let prevEnd: LngLat | null = null;
  for (const wayId of pattern.wayIds) {
    const way = byId.get(wayId);
    if (!way) continue;
    const raw = resolveWayPath(way);
    if (raw.length < 2) continue;
    const start = raw[0];
    const end = raw[raw.length - 1];
    // Explicit annotation, not inferred — TS 7 (this repo's compiler as of
    // this plan) flags this as circular without it (TS7022), even though
    // `prevEnd` is already explicitly typed above.
    const forward: boolean = prevEnd === null || haversineMeters(prevEnd, start) <= haversineMeters(prevEnd, end);
    out.push({ way, forward });
    prevEnd = forward ? end : start;
  }
  return out;
}
```

- [x] **Step 2: Add checks for `patternWayTraversals`**

In `apps/web/scripts/verify.ts`, add to the import from `@transitmapper/core/geometry/vehicleLane` (new import block near the other `@transitmapper/core/geometry/*` import):

```ts
import { patternWayTraversals, selectVehicleLane, patternLanePath } from "@transitmapper/core/geometry/vehicleLane";
```

Add checks (anchor: search for an existing `wayLaneGeometry` check and add this block after it):

```ts
{
  // Two ways end-to-start, end-to-start — the natural "keep going forward"
  // case: way B's stored points already run the direction of travel.
  const wayA: Way = {
    id: "va", typeId: "road", geometry: "straight", grade: "atGrade",
    points: [[-115.2, 36.1], [-115.19, 36.1]],
    profile: { lanes: [] },
  };
  const wayB: Way = {
    id: "vb", typeId: "road", geometry: "straight", grade: "atGrade",
    points: [[-115.19, 36.1], [-115.18, 36.1]],
    profile: { lanes: [] },
  };
  const traversals = patternWayTraversals([wayA, wayB], { id: "p1", wayIds: ["va", "vb"] });
  check("first way in a pattern defaults to forward", traversals[0].forward === true);
  check("a way continuing in its own stored order is forward", traversals[1].forward === true);

  // way C's own points run the OPPOSITE direction of travel (start where
  // way A ends up, at the far end) — traversing it means walking it backward.
  const wayC: Way = {
    id: "vc", typeId: "road", geometry: "straight", grade: "atGrade",
    points: [[-115.18, 36.1], [-115.19, 36.1]],
    profile: { lanes: [] },
  };
  const reversedTraversals = patternWayTraversals([wayA, wayC], { id: "p2", wayIds: ["va", "vc"] });
  check("a way stored opposite the direction of travel is detected as backward", reversedTraversals[1].forward === false);
}
```

- [x] **Step 3: Run verify, confirm it fails to compile (selectVehicleLane/patternLanePath don't exist yet)**

Run: `npx tsx apps/web/scripts/verify.ts`
Expected: FAIL — TypeScript error, `"selectVehicleLane" is not exported` / `"patternLanePath" is not exported` from `@transitmapper/core/geometry/vehicleLane`.

- [x] **Step 4: Write `selectVehicleLane` (lane selection heuristic)**

Append to `packages/core/src/geometry/vehicleLane.ts`:

```ts
/** A lane's path, oriented so index 0 → last matches the pattern's actual
 *  direction of travel through this way (lane.path itself always follows
 *  the way's own stored point order, same convention wayLaneGeometry's
 *  `arrows` field already uses for backward-direction lanes). */
function orientedLanePath(lane: LanePath, forward: boolean): LngLat[] {
  return forward ? lane.path : [...lane.path].reverse();
}

/**
 * Which of a way's real lanes a mode's vehicle rides, given the direction
 * the pattern travels this way: filter to lanes going that direction (or
 * bidirectional), prefer a lane kind the mode lists in
 * `preferredLaneKindIds` (checked in order, first kind with any match
 * wins), then break remaining ties by whichever lane sits closest to the
 * way's centerline. Returns null when the way has no lanes at all (no
 * profile, or nothing going this direction) — callers fall back to the
 * way's raw centerline.
 */
export function selectVehicleLane(way: Way, forward: boolean, modeId: string): LanePath | null {
  const geometry = wayLaneGeometry(way);
  const direction: LaneDirection = forward ? "forward" : "backward";
  const candidates = geometry.lanes.filter((l) => l.direction === direction || l.direction === "both");
  if (candidates.length === 0) return null;

  const preferredKindIds = mode(modeId).preferredLaneKindIds ?? [];
  let pool = candidates;
  for (const kindId of preferredKindIds) {
    const matches = candidates.filter((l) => l.kindId === kindId);
    if (matches.length > 0) {
      pool = matches;
      break;
    }
  }
  return pool.reduce((best, l) => (Math.abs(l.offsetM) < Math.abs(best.offsetM) ? l : best));
}
```

- [x] **Step 5: Add checks for `selectVehicleLane`**

Append to the same check block in `apps/web/scripts/verify.ts` from Step 2:

```ts
{
  // A 4-lane road: sidewalk, 2 backward drive, 1 forward bus, 1 forward
  // drive, sidewalk — built directly as a profile so the test doesn't
  // depend on catalog defaults changing later.
  const road: Way = {
    id: "vroad", typeId: "road", geometry: "straight", grade: "atGrade",
    points: [[-115.2, 36.1], [-115.19, 36.1]],
    profile: {
      lanes: [
        { id: "sw1", kindId: "sidewalk", widthM: 2, direction: "both" },
        { id: "d1", kindId: "drive", widthM: 3.3, direction: "backward" },
        { id: "d2", kindId: "drive", widthM: 3.3, direction: "backward" },
        { id: "b1", kindId: "bus", widthM: 3.6, direction: "forward" },
        { id: "d3", kindId: "drive", widthM: 3.3, direction: "forward" },
        { id: "sw2", kindId: "sidewalk", widthM: 2, direction: "both" },
      ],
    },
  };
  const busLane = selectVehicleLane(road, true, "bus");
  check("a bus prefers the dedicated bus lane over a general drive lane", busLane?.kindId === "bus");

  const brtLane = selectVehicleLane(road, true, "brt");
  check("BRT also prefers the bus lane (shares bus's preference list)", brtLane?.kindId === "bus");

  const carModeLane = selectVehicleLane(road, true, "subway"); // subway has no preferredLaneKindIds
  check("a mode with no lane preference falls back to whichever direction-matching lane is nearest centerline (here, the bus lane at offset 1.65m beats the drive lane at 5.1m)", carModeLane?.kindId === "bus");

  const backwardLane = selectVehicleLane(road, false, "bus");
  check("no bus lane going backward on this road — falls back to a backward drive lane", backwardLane?.kindId === "drive");
  check("the backward fallback is the one closest to centerline, not the outer one", backwardLane?.laneId === "d2");

  const noProfileWay: Way = { id: "vempty", typeId: "road", geometry: "straight", grade: "atGrade", points: [[-115.2, 36.1], [-115.19, 36.1]], profile: { lanes: [] } };
  check("a way with no profile at all returns no lane (caller falls back to centerline)", selectVehicleLane(noProfileWay, true, "bus") === null);
}
```

- [x] **Step 6: Run verify, confirm it still fails (patternLanePath missing)**

Run: `npx tsx apps/web/scripts/verify.ts`
Expected: FAIL — `"patternLanePath" is not exported`.

- [x] **Step 7: Write `patternLanePath`**

Append to `packages/core/src/geometry/vehicleLane.ts`:

```ts
/**
 * The Infrastructure-view analog of servicePaths.ts's patternPath: the
 * concatenated polyline a pattern actually rides once every way is
 * resolved to ITS SELECTED LANE (oriented for direction of travel)
 * instead of its bare centerline. A way with no matching lane (no
 * profile, or nothing going this direction) falls back to that way's
 * plain oriented centerline, so a pattern never just vanishes because one
 * of its ways happens to be bare/unprofiled infrastructure.
 */
export function patternLanePath(ways: Way[], pattern: Pattern, modeId: string): LngLat[] {
  const traversals = patternWayTraversals(ways, pattern);
  const path: LngLat[] = [];
  for (const { way, forward } of traversals) {
    const lane = selectVehicleLane(way, forward, modeId);
    const raw = resolveWayPath(way);
    const seg = lane ? orientedLanePath(lane, forward) : forward ? raw : [...raw].reverse();
    if (seg.length < 2) continue;
    path.push(...(path.length ? seg.slice(1) : seg));
  }
  return path;
}
```

- [x] **Step 8: Add a check for `patternLanePath`**

Append to the same block:

```ts
{
  const wayA: Way = {
    id: "lp-a", typeId: "road", geometry: "straight", grade: "atGrade",
    points: [[-115.2, 36.1], [-115.19, 36.1]],
    profile: { lanes: [{ id: "a-d1", kindId: "drive", widthM: 3.3, direction: "forward" }, { id: "a-d2", kindId: "drive", widthM: 3.3, direction: "backward" }] },
  };
  const wayB: Way = {
    id: "lp-b", typeId: "road", geometry: "straight", grade: "atGrade",
    points: [[-115.19, 36.1], [-115.18, 36.1]],
    profile: { lanes: [{ id: "b-d1", kindId: "drive", widthM: 3.3, direction: "forward" }, { id: "b-d2", kindId: "drive", widthM: 3.3, direction: "backward" }] },
  };
  const path = patternLanePath([wayA, wayB], { id: "lp1", wayIds: ["lp-a", "lp-b"] }, "bus");
  check("patternLanePath produces a continuous path across both ways", path.length >= 2);
  check("patternLanePath's endpoints roughly track the ways' own endpoints (offset by lane width, not miles)", Math.abs(path[0][1] - 36.1) < 0.001 && Math.abs(path[path.length - 1][1] - 36.1) < 0.001);
}
```

- [x] **Step 9: Run verify, confirm everything passes**

Run: `npx tsx apps/web/scripts/verify.ts`
Expected: every check prints `ok`, ends with `ALL PASS`, exit code 0.

- [x] **Step 10: Commit (stage only — do not run `git commit`; this plan's commits are batched for explicit approval, see the end of this document)**

```bash
git add packages/core/src/geometry/vehicleLane.ts apps/web/scripts/verify.ts
```

---

### Task 2: Bearing helper

**Files:**
- Modify: `packages/core/src/model/geo/measurement.ts`
- Modify: `apps/web/scripts/verify.ts`

- [x] **Step 1: Write `bearingAtT`**

`packages/core/src/model/geo/spherical.ts` already has `bearingDegrees(a, b)` (great-circle bearing between two points — the same one the way-drawing bearing readout uses). Reuse it rather than writing a second, flat-approximation bearing formula. In `packages/core/src/model/geo/measurement.ts`, change the top import to add `bearingDegrees`:

```ts
import { bearingDegrees, haversineMeters, toRad } from "./spherical";
```

Then add, after `pointAtT`:

```ts
/** Compass bearing in degrees (0 = north, clockwise) of a polyline's
 *  direction of travel at normalized arc-length position t ∈ [0,1] — the
 *  segment straddling t, or the path's last segment past its end. Used to
 *  rotate a vehicle's rendered footprint to face its direction of travel.
 *  Reuses the same great-circle bearingDegrees the way-drawing bearing
 *  readout already uses, rather than a separate flat approximation. */
export function bearingAtT(path: LngLat[], t: number): number {
  if (path.length < 2) return 0;
  const total = pathLengthMeters(path);
  if (total === 0) return 0;
  const target = Math.max(0, Math.min(1, t)) * total;
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    const seg = haversineMeters(path[i - 1], path[i]);
    if (acc + seg >= target || i === path.length - 1) {
      return bearingDegrees(path[i - 1], path[i]);
    }
    acc += seg;
  }
  return bearingDegrees(path[path.length - 2], path[path.length - 1]);
}
```

- [x] **Step 2: Add checks**

In `apps/web/scripts/verify.ts`, add `bearingAtT` to the existing `@transitmapper/core/model/geo` import list, then add a check near the other `pointAtT`/`nearestOnPath` checks:

```ts
{
  const dueNorth: LngLat[] = [[-115.2, 36.1], [-115.2, 36.11]];
  check("bearingAtT reads ~0° (north) for a due-north path", Math.abs(bearingAtT(dueNorth, 0.5)) < 1 || Math.abs(bearingAtT(dueNorth, 0.5) - 360) < 1);

  const dueEast: LngLat[] = [[-115.2, 36.1], [-115.19, 36.1]];
  check("bearingAtT reads ~90° (east) for a due-east path", Math.abs(bearingAtT(dueEast, 0.5) - 90) < 1);

  check("bearingAtT on a too-short path returns 0 rather than throwing", bearingAtT([[-115.2, 36.1]], 0.5) === 0);
}
```

- [x] **Step 3: Run verify, confirm pass**

Run: `npx tsx apps/web/scripts/verify.ts`
Expected: `ALL PASS`.

- [x] **Step 4: Stage**

```bash
git add packages/core/src/model/geo/measurement.ts apps/web/scripts/verify.ts
```

---

### Task 3: Rotated-rectangle polygon helper

**Files:**
- Modify: `packages/core/src/model/geo/planar.ts`
- Modify: `apps/web/scripts/verify.ts`

- [x] **Step 1: Write `rotatedRectPolygon`**

In `packages/core/src/model/geo/planar.ts`, add after `squareFootprint`:

```ts
/** A closed polygon ring for a rectangle centered on `center`, `lengthM`
 *  long along `bearingDeg` (compass degrees, 0 = north, clockwise) and
 *  `widthM` wide perpendicular to that — a vehicle's true-scale
 *  real-world footprint, rotated to face its direction of travel. */
export function rotatedRectPolygon(center: LngLat, bearingDeg: number, widthM: number, lengthM: number): LngLat[] {
  const rad = (bearingDeg * Math.PI) / 180;
  const fwd: [number, number] = [Math.sin(rad), Math.cos(rad)];
  const right: [number, number] = [Math.cos(rad), -Math.sin(rad)];
  const hl = lengthM / 2;
  const hw = widthM / 2;
  const corner = (f: number, r: number): LngLat => offsetMeters(center, fwd[0] * f + right[0] * r, fwd[1] * f + right[1] * r);
  const ring: LngLat[] = [corner(hl, -hw), corner(hl, hw), corner(-hl, hw), corner(-hl, -hw)];
  return [...ring, ring[0]];
}
```

- [x] **Step 2: Add checks**

In `apps/web/scripts/verify.ts`, add `rotatedRectPolygon` to the existing `@transitmapper/core/model/geo` import list, then:

```ts
{
  const center: LngLat = [-115.2, 36.1];
  const ring = rotatedRectPolygon(center, 0, 3, 10); // facing due north
  check("rotatedRectPolygon returns a closed ring (5 points, first === last)", ring.length === 5 && ring[0][0] === ring[4][0] && ring[0][1] === ring[4][1]);

  const [dx, dy] = metersFromOrigin(center, ring[0]);
  check("facing north, a corner sits ~half-length north/south and ~half-width east/west of center", Math.abs(Math.abs(dy) - 5) < 0.1 && Math.abs(Math.abs(dx) - 1.5) < 0.1);
}
```

- [x] **Step 3: Run verify, confirm pass**

Run: `npx tsx apps/web/scripts/verify.ts`
Expected: `ALL PASS`.

- [x] **Step 4: Stage**

```bash
git add packages/core/src/model/geo/planar.ts apps/web/scripts/verify.ts
```

---

### Task 4: Catalog — `preferredLaneKindIds` on `MODES`

**Files:**
- Modify: `packages/core/src/model/catalog.ts:484-506`

- [x] **Step 1: Extend the `Mode` interface and populate preferences**

Replace the `Mode` interface and `MODES` table in `packages/core/src/model/catalog.ts`:

```ts
export interface Mode {
  id: string;
  label: string;
  /** Way types this mode is compatible with. */
  wayTypeIds: string[];
  /** Lane kinds this mode prefers when a way offers more than one lane
   *  going its direction — e.g. a bus prefers a dedicated bus lane over a
   *  general drive lane when one exists. Checked in order; first kind
   *  with any match wins. Falls back to any direction-matching lane when
   *  unset or none of the preferred kinds are present on this way. See
   *  geometry/vehicleLane.ts's selectVehicleLane. */
  preferredLaneKindIds?: string[];
}

export const MODES: Record<string, Mode> = {
  // Heavy rail: subway and commuter rail are operationally different services
  // but ride the same track standard, so both are compatible with heavyRail.
  subway: { id: "subway", label: "Subway / metro", wayTypeIds: ["heavyRail"] },
  commuterRail: { id: "commuterRail", label: "Commuter rail", wayTypeIds: ["heavyRail"] },
  // Light rail & trams share the light-rail track standard — trams typically
  // run shorter, city-center alignments and more often street-run in a road's
  // right-of-way, which is why both also list "road" as compatible.
  lightRail: { id: "lightRail", label: "Light rail", wayTypeIds: ["lightRail", "road"], preferredLaneKindIds: ["track", "drive"] },
  tram: { id: "tram", label: "Tram / streetcar", wayTypeIds: ["lightRail", "road"], preferredLaneKindIds: ["track", "drive"] },
  monorail: { id: "monorail", label: "Monorail", wayTypeIds: ["monorail"] },
  brt: { id: "brt", label: "BRT", wayTypeIds: ["road"], preferredLaneKindIds: ["bus", "drive"] },
  bus: { id: "bus", label: "Bus", wayTypeIds: ["road"], preferredLaneKindIds: ["bus", "drive"] },
  gondola: { id: "gondola", label: "Gondola / aerial", wayTypeIds: ["aerial"] },
  ferry: { id: "ferry", label: "Ferry", wayTypeIds: ["water"] },
};
```

- [x] **Step 2: Add a check**

In `apps/web/scripts/verify.ts`, near the existing `MODES`/`modesForWayType` checks:

```ts
check("bus mode prefers a dedicated bus lane over a general drive lane", MODES.bus.preferredLaneKindIds?.[0] === "bus");
check("subway has no lane preference (its only way type has one lane kind, no ambiguity)", MODES.subway.preferredLaneKindIds === undefined);
```

- [x] **Step 3: Run verify, confirm pass**

Run: `npx tsx apps/web/scripts/verify.ts`
Expected: `ALL PASS`.

- [x] **Step 4: Stage**

```bash
git add packages/core/src/model/catalog.ts apps/web/scripts/verify.ts
```

---

### Task 5: Style — vehicle footprint dimensions and paint constants

**Files:**
- Modify: `packages/core/src/style/catalogStyle.ts`
- Modify: `apps/web/scripts/verify.ts`

- [x] **Step 1: Add the per-mode footprint table and paint constants**

In `packages/core/src/style/catalogStyle.ts`, add after the `MODE_RENDER`/`modeRender` block (after line 124):

```ts
// ---- Vehicle footprint (Infrastructure view) --------------------------------
// A mode's approximate true-world size, in meters — drives the rotated-
// rectangle polygon sim/vehicles.ts renders in Infrastructure view. Rail-
// family modes share dimensions with their nearest real-world equivalent;
// exact figures aren't load-bearing (a per-system custom vehicle catalog,
// see the follow-on "Vehicle catalogs" spec, is where real precision goes —
// this table is only ever the fallback default).
export interface VehicleFootprint {
  widthM: number;
  lengthM: number;
}

export const VEHICLE_FOOTPRINT_M: Record<string, VehicleFootprint> = {
  subway: { widthM: 2.65, lengthM: 22 },
  commuterRail: { widthM: 2.9, lengthM: 25 },
  lightRail: { widthM: 2.65, lengthM: 27 },
  tram: { widthM: 2.4, lengthM: 18 },
  monorail: { widthM: 3, lengthM: 12 },
  brt: { widthM: 2.6, lengthM: 12 },
  bus: { widthM: 2.6, lengthM: 12 },
  gondola: { widthM: 2, lengthM: 3 },
  ferry: { widthM: 6, lengthM: 20 },
};

export function vehicleFootprint(modeId: string): VehicleFootprint {
  return VEHICLE_FOOTPRINT_M[modeId] ?? VEHICLE_FOOTPRINT_M.bus;
}

// A vehicle's fill is its own route color (the `color` GeoJSON property,
// same value the Network-view dot already uses) — unlike a footprint or
// platform, a vehicle belongs to exactly one service, so it gets that
// service's color rather than the shared monochrome ink fill.
export const VEHICLE_STROKE = "#191a17";
export const VEHICLE_FILL_OPACITY = 0.92;
```

- [x] **Step 2: Add a check**

In `apps/web/scripts/verify.ts`, add `vehicleFootprint`, `VEHICLE_FOOTPRINT_M` to the `@transitmapper/core/style/catalogStyle` import (or add a new import line if none exists yet — search the file for `catalogStyle` to find the existing import block), then:

```ts
check("a light rail vehicle is longer than a bus (real mode differentiation from size alone)", vehicleFootprint("lightRail").lengthM > vehicleFootprint("bus").lengthM);
check("an unknown mode falls back to the bus footprint", vehicleFootprint("nonexistent-mode").lengthM === vehicleFootprint("bus").lengthM);
```

- [x] **Step 3: Run verify, confirm pass**

Run: `npx tsx apps/web/scripts/verify.ts`
Expected: `ALL PASS`.

- [x] **Step 4: Stage**

```bash
git add packages/core/src/style/catalogStyle.ts apps/web/scripts/verify.ts
```

---

### Task 6: New source + layer pair for Infrastructure-view vehicles

**Files:**
- Modify: `apps/web/src/map/layers/constants.ts`
- Modify: `apps/web/src/map/layers/layerSpecs.ts`

- [x] **Step 1: Add the new source/layer id constants**

In `apps/web/src/map/layers/constants.ts`, add next to `SRC_VEHICLES`/`LYR_VEHICLES`:

```ts
export const SRC_VEHICLES_INFRA = "tm-vehicles-infra";
```

and next to `LYR_VEHICLES`:

```ts
export const LYR_VEHICLES_INFRA_FILL = "tm-vehicles-infra-fill";
export const LYR_VEHICLES_INFRA_STROKE = "tm-vehicles-infra-stroke";
```

- [x] **Step 2: Add the fill + stroke layer pair**

In `apps/web/src/map/layers/layerSpecs.ts`, add `SRC_VEHICLES_INFRA`, `LYR_VEHICLES_INFRA_FILL`, `LYR_VEHICLES_INFRA_STROKE` to the existing import blocks from `"./constants"` and `"@transitmapper/core/style/catalogStyle"` (add `VEHICLE_FILL_OPACITY`, `VEHICLE_STROKE` to the latter), then insert this pair immediately after the existing `LYR_VEHICLES` entry (so it paints in the same position in the stack, right after the Network-view dot):

```ts
  {
    // Infrastructure-view vehicles: a real rotated-rectangle polygon per
    // vehicle, true-to-scale and riding its actual physical lane (see
    // sim/vehicles.ts + geometry/vehicleLane.ts) — the same class of
    // feature as a station footprint/platform (LYR_FOOTPRINTS_FILL/
    // LYR_PLATFORMS_FILL above), not a raster icon. Filled with the
    // vehicle's own route color, unlike the monochrome footprint fill,
    // since a vehicle belongs to one service.
    id: LYR_VEHICLES_INFRA_FILL,
    type: "fill",
    source: SRC_VEHICLES_INFRA,
    paint: { "fill-color": ["get", "color"], "fill-opacity": VEHICLE_FILL_OPACITY },
  },
  {
    id: LYR_VEHICLES_INFRA_STROKE,
    type: "line",
    source: SRC_VEHICLES_INFRA,
    paint: { "line-color": VEHICLE_STROKE, "line-width": 1 },
  },
```

- [x] **Step 3: Typecheck**

Run: `npx tsc -b --noEmit` (from repo root, or `cd apps/web && npx tsc -b --noEmit` if the root command doesn't cover the app)
Expected: no errors.

- [x] **Step 4: Stage**

```bash
git add apps/web/src/map/layers/constants.ts apps/web/src/map/layers/layerSpecs.ts
```

---

### Task 7: Wire lane-aware geometry and rendering into `sim/vehicles.ts`

**Files:**
- Modify: `apps/web/src/sim/vehicles.ts`

This is the task that actually makes vehicles appear in Infrastructure view. `VehicleGate` changes shape: `isVisible` becomes a pure mode-filter check (view-mode gating moves into this file, since the tick loop now needs to know the current view mode to decide which source/shape to render). `resolvePatternGeometry` (Network, unchanged) gets a sibling `resolveInfraPatternGeometry` built from `patternLanePath` instead of `patternPath`.

- [x] **Step 1: Update imports and the `VehicleGate` interface**

In `apps/web/src/sim/vehicles.ts`, replace the top of the file through the `VehicleGate` interface:

```ts
import type { Feature, Point, Polygon } from "geojson";
import type { GeoJSONSource, Map as MLMap } from "maplibre-gl";
import type { EditorStore } from "../editor/store";
import { bearingAtT, nearestOnPath, pathLengthMeters, patternPath, pointAtT, rotatedRectPolygon } from "@transitmapper/core/model/geo";
import { patternLanePath } from "@transitmapper/core/geometry/vehicleLane";
import { vehicleFootprint } from "@transitmapper/core/style/catalogStyle";
import type { LngLat, Pattern, SchedulePeriod, Service, Station, TransitSystem, Way } from "@transitmapper/core/model/system";
import { SRC_VEHICLES, SRC_VEHICLES_INFRA } from "../map/layers";

export const VEHICLE_SPEED_MPS = 11; // ~40 km/h — a plausible light-rail/tram running speed
const MIN_PERIOD_MS = 6000; // a floor so even a very short line doesn't blur past instantly
// A very short headway on a long line could otherwise imply dozens of
// vehicles — capped so "every 5 min" reads as "frequent", not as a swarm.
const MAX_VEHICLES_PER_PATTERN = 6;
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
  viewMode: () => "network" | "infrastructure" | "diagram";
}
```

- [x] **Step 2: Add the parallel infra geometry cache and resolver**

After the existing `resolvePatternGeometry` function (after its closing brace), add:

```ts
// Same shape and invalidation convention as patternGeometryCache above, but
// built from the lane-aware path (patternLanePath) instead of the raw
// centerline — Infrastructure view's vehicles ride their actual physical
// lane, not the way's middle. A separate cache (not a variant of the
// existing one) because it depends on one more thing the network path
// doesn't: the service's modeId, which determines lane preference.
interface CachedInfraPatternGeometry extends PatternGeometry {
  forWays: Way[];
  forStations: Station[];
  forModeId: string;
}
const infraPatternGeometryCache = new WeakMap<Pattern, CachedInfraPatternGeometry>();

function resolveInfraPatternGeometry(system: TransitSystem, pattern: Pattern, modeId: string): PatternGeometry | null {
  const cached = infraPatternGeometryCache.get(pattern);
  if (cached && cached.forWays === system.ways && cached.forStations === system.stations && cached.forModeId === modeId) return cached;
  const path = patternLanePath(system.ways, pattern, modeId);
  if (path.length < 2) return null;
  const meters = pathLengthMeters(path);
  if (meters === 0) return null;
  const stops = dwellStopsForPattern(system, pattern, path, meters);
  const timetable = buildTimetable(meters, stops);
  const geometry: CachedInfraPatternGeometry = { path, meters, timetable, forWays: system.ways, forStations: system.stations, forModeId: modeId };
  infraPatternGeometryCache.set(pattern, geometry);
  return geometry;
}
```

- [x] **Step 3: Rewrite `attachVehicleAnimation`'s tick loop**

Replace the whole `attachVehicleAnimation` function body:

```ts
export function attachVehicleAnimation(map: MLMap, store: EditorStore, gate: VehicleGate): () => void {
  let frame: number;
  const tick = () => {
    frame = requestAnimationFrame(tick);
    const source = map.getSource(SRC_VEHICLES) as GeoJSONSource | undefined;
    const infraSource = map.getSource(SRC_VEHICLES_INFRA) as GeoJSONSource | undefined;
    if (!source && !infraSource) return;
    const { system } = store.getState();
    const now = performance.now();
    const viewMode = gate.viewMode();
    const features: Feature<Point>[] = [];
    const infraFeatures: Feature<Polygon>[] = [];

    if (viewMode === "network" || viewMode === "infrastructure") {
      for (const service of system.services) {
        if (!gate.isVisible(service)) continue;
        const headwayMinutes = effectiveHeadwayMinutes(service);
        for (const pattern of service.patterns) {
          const geometry =
            viewMode === "network" ? resolvePatternGeometry(system, pattern) : resolveInfraPatternGeometry(system, pattern, service.modeId);
          if (!geometry) continue;
          const { path, meters, timetable } = geometry;
          // periodMs is the animation's own out-and-back cycle — floored so
          // even a short, stopless line doesn't blur past instantly.
          const periodMs = Math.max(MIN_PERIOD_MS, 2 * timetable.oneWayMs);
          const roundTripMinutes = (2 * timetable.oneWayMs) / 60000;
          const count = headwayMinutes ? Math.min(MAX_VEHICLES_PER_PATTERN, Math.max(1, Math.floor(roundTripMinutes / headwayMinutes))) : 1;
          for (let i = 0; i < count; i++) {
            const phase = (now / periodMs + i / count) % 1;
            const elapsedMs = phase * periodMs;
            // First half of the cycle: outbound (start→end). Second half:
            // the same timetable mirrored, since dwell points are the same
            // physical stations regardless of direction of travel.
            const outbound = elapsedMs <= timetable.oneWayMs;
            const legElapsed = outbound ? elapsedMs : elapsedMs - timetable.oneWayMs;
            const distFromStart = outbound
              ? metersAtElapsed(meters, timetable, legElapsed)
              : meters - metersAtElapsed(meters, timetable, legElapsed);
            const t = meters === 0 ? 0 : distFromStart / meters;
            if (viewMode === "network") {
              features.push({
                type: "Feature",
                properties: { color: service.color },
                geometry: { type: "Point", coordinates: pointAtT(path, t) },
              });
            } else {
              const center = pointAtT(path, t);
              const bearing = bearingAtT(path, t);
              const { widthM, lengthM } = vehicleFootprint(service.modeId);
              infraFeatures.push({
                type: "Feature",
                properties: { color: service.color },
                geometry: { type: "Polygon", coordinates: [rotatedRectPolygon(center, bearing, widthM, lengthM)] },
              });
            }
          }
        }
      }
    }
    source?.setData({ type: "FeatureCollection", features });
    infraSource?.setData({ type: "FeatureCollection", features: infraFeatures });
  };
  frame = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(frame);
}
```

- [x] **Step 4: Typecheck**

Run: `npx tsc -b --noEmit`
Expected: no errors. (`patternPath` stays imported/used by `resolvePatternGeometry`, unchanged above this diff — if the typechecker reports it unused, that means Step 1's import line accidentally dropped it; re-check the import list includes `patternPath`.)

- [x] **Step 5: Stage**

```bash
git add apps/web/src/sim/vehicles.ts
```

---

### Task 8: Wire the new source into `MapCanvas.tsx`

**Files:**
- Modify: `apps/web/src/map/MapCanvas.tsx`

- [x] **Step 1: Add `SRC_VEHICLES_INFRA` to `ALL_SOURCES`**

Find the `ALL_SOURCES` array (search for `SRC_VEHICLES,` inside it) and add `SRC_VEHICLES_INFRA` right after `SRC_VEHICLES`:

```ts
    const ALL_SOURCES = [
      SRC_WAYS, SRC_SERVICES, SRC_STATIONS, SRC_HANDLES, SRC_PREVIEW,
      SRC_ENDPOINT_HINT, SRC_MARQUEE, SRC_FOOTPRINTS, SRC_PLATFORMS,
      SRC_FACILITIES, SRC_PHYSICAL_HANDLES, SRC_VEHICLES, SRC_VEHICLES_INFRA, SRC_LANES,
      SRC_LANE_MARKINGS, SRC_LANE_ARROWS, SRC_JUNCTIONS, SRC_CONNECTORS,
      SRC_WAY_LABELS,
    ];
```

Add `SRC_VEHICLES_INFRA` to this file's import from `./layers` (find the existing `SRC_VEHICLES,` in that import list and add it alongside).

- [x] **Step 2: Update the `attachVehicleAnimation` call site**

Find:

```ts
      detachVehicles = attachVehicleAnimation(map, store, {
        isVisible: (service) => viewRef.current.viewMode === "network" && viewRef.current.visibleModes.has(service.modeId),
      });
```

Replace with:

```ts
      detachVehicles = attachVehicleAnimation(map, store, {
        isVisible: (service) => viewRef.current.visibleModes.has(service.modeId),
        viewMode: () => viewRef.current.viewMode,
      });
```

- [x] **Step 3: Typecheck**

Run: `npx tsc -b --noEmit`
Expected: no errors.

- [x] **Step 4: Stage**

```bash
git add apps/web/src/map/MapCanvas.tsx
```

---

### Task 9: Browser verification

Not a code change — confirms the whole chain actually works end to end, per the spec's Testing section.

- [x] **Step 1: Start the dev server and open a system with a multi-lane road carrying more than one mode**

Use the project's preview tooling (`.claude/launch.json`, `npm run dev` on :5173) to load the app. Draw or open a system with: a 4+ lane road carrying a bus service, and a rail line (any rail mode) with at least 2 tracks. Give both services a headway so at least one vehicle animates (Service Inspector → Peak headway).

- [x] **Step 2: Switch to Infrastructure view and confirm real polygons**

Confirm: each vehicle now renders as a filled, route-colored rectangle (not a dot, not an icon), sized differently between the bus and the rail vehicle (rail longer), sitting inside one of the road's real lanes (not floating across the whole fanned-out group) and rotated to face its direction of travel.

- [x] **Step 3: Confirm Network view is unchanged**

Switch back to Network view. Confirm vehicles are still the original small colored dots at the way's centerline, exactly as before this plan.

- [x] **Step 4: Confirm a curve rotates the vehicle smoothly**

Find or draw a curved way carrying a service; confirm the Infrastructure-view vehicle's rotation visibly follows the curve rather than snapping.

- [x] **Step 5: Confirm a lane-count change at a junction doesn't break the path**

Find or create a junction where a road's lane count changes (e.g. a 4-lane arterial narrowing to a 2-lane local street) with a bus service running through it. Confirm the vehicle continues smoothly through the junction without jumping or disappearing.

- [x] **Step 6: RTC-scale performance check**

If the RTC Southern Nevada GTFS import is available in this environment (see project memory on the GTFS import feature), load it, switch to Infrastructure view, and confirm the tab stays responsive (use the existing `__perf`/`__panBench` dev harness if present) — this feature must not reintroduce a per-frame hot path at real-agency scale.

---

## Commits

This plan's steps say "stage" rather than "commit" — per this project's standing policy, commits happen only with explicit user go-ahead, batched rather than one per task. Once all 9 tasks are complete and verified, ask the user for permission to commit the whole plan's changes (or split however they prefer) before running `git commit`.
