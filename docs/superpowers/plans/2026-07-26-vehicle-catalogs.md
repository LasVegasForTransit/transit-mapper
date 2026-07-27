# Vehicle Catalogs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a person define custom vehicle kinds (label, real size, passenger capacity, top speed) inside their transit system, assign one to a service, and see both its Infrastructure-view footprint and its simulated speed change accordingly — while every service that never touches this feature keeps behaving exactly as it does today.

**Architecture:** `VehicleKind` becomes a new top-level array on `TransitSystem` (system-scoped data, like stations/ways/services), with `Service.vehicleKindId?` pointing at one. A single resolver function in `sim/vehicles.ts` (`effectiveVehicleKind`) looks up a service's assigned kind — falling back to the existing per-mode default (from the previous spec's `vehicleFootprint`) and the existing global default speed when unset or when the assigned kind no longer exists — and both the Infrastructure-view polygon renderer and the timetable/speed math read from it instead of their old hardcoded sources. A `ServiceInspector` dropdown assigns a kind; a new `VehicleKindsDialog` (same live-commit pattern as the existing `ScheduleDialog`) manages the system's list.

**Tech Stack:** TypeScript, React, Zustand, MapLibre GL, the `check()`-based verification harness (`apps/web/scripts/verify.ts`).

**Spec:** [docs/superpowers/specs/2026-07-26-vehicle-catalogs-design.md](../specs/2026-07-26-vehicle-catalogs-design.md)

**Depends on:** [Vehicles in Infrastructure view](2026-07-26-vehicles-in-infrastructure-view.md) — must be implemented first; this plan reuses its `vehicleFootprint` fallback table and its Infrastructure-view rendering path.

---

### Task 1: `VehicleKind` type + `TransitSystem`/`Service` fields

**Files:**
- Create: `packages/core/src/model/system/vehicleKind.ts`
- Modify: `packages/core/src/model/system.ts` (barrel export)
- Modify: `packages/core/src/model/system/document.ts` (`TransitSystem.vehicleKinds`)
- Modify: `packages/core/src/model/system/service.ts` (`Service.vehicleKindId`)

- [x] **Step 1: Create the `VehicleKind` type**

Create `packages/core/src/model/system/vehicleKind.ts`:

```ts
/** A specific piece of rolling stock/equipment a service can be assigned to
 *  run — lets someone testing a transit system idea choose which vehicle a
 *  line actually uses (a short single-unit LRV vs. a long double-consist
 *  one, say), rather than every service of a mode sharing one fixed size
 *  and speed. Part of the transit system document, like stations/ways/
 *  services — not a hardcoded catalog entry, since these are meant to be
 *  created and tuned by the person planning the system, not a developer. */
export interface VehicleKind {
  id: string;
  /** Mode catalog id this kind is usable for — constrains which services
   *  it can be assigned to. */
  modeId: string;
  /** e.g. "Siemens S700", "40' Standard Bus". */
  label: string;
  widthM: number;
  lengthM: number;
  /** Informational only — nothing in this app simulates ridership/capacity
   *  yet; this is a label for the person planning, not a simulation input. */
  capacityPax?: number;
  /** Drives simulated travel time (apps/web/src/sim/vehicles.ts) — unset
   *  falls back to the app's ambient default speed, same as an unassigned
   *  service today. */
  topSpeedKmh?: number;
}
```

- [x] **Step 2: Export it from the `system.ts` barrel**

In `packages/core/src/model/system.ts`, add a line to the existing `export * from "./system/..."` list:

```ts
export * from "./system/vehicleKind";
```

- [x] **Step 3: Add `vehicleKinds` to `TransitSystem`**

In `packages/core/src/model/system/document.ts`, add the import and field:

```ts
import type { VehicleKind } from "./vehicleKind";
```

(add alongside the existing type imports), and in the `TransitSystem` interface, add after `namedWays`:

```ts
  /** Named identities across ways ("Decatur Avenue"). See NamedWay. */
  namedWays: NamedWay[];
  /** Custom vehicle kinds available in this system — a service's
   *  `vehicleKindId` points at one; unset uses the mode's plain default.
   *  See VehicleKind. */
  vehicleKinds: VehicleKind[];
```

Bump the schema version comment/literal from `8` to `9`:

```ts
  /** Schema version, for migrations. */
  version: 9;
```

- [x] **Step 4: Add `vehicleKindId` to `Service`**

In `packages/core/src/model/system/service.ts`, add to the `Service` interface after `modeId`:

```ts
  /** Mode catalog id: "subway" | "bus" | "tram" | "gondola" | … */
  modeId: string;
  /** A specific VehicleKind (system.vehicleKinds) this service runs —
   *  unset (the common case) uses the mode's plain default size/speed. */
  vehicleKindId?: string;
```

- [x] **Step 5: Typecheck**

Run: `npx tsc -b --noEmit`
Expected: errors in `serialize.ts` (missing `vehicleKinds` in the object literals it builds, `version: 9` mismatch) — that's expected; Task 2 fixes them. Confirm the errors are ONLY in `serialize.ts` and nowhere else.

- [x] **Step 6: Stage**

```bash
git add packages/core/src/model/system/vehicleKind.ts packages/core/src/model/system.ts packages/core/src/model/system/document.ts packages/core/src/model/system/service.ts
```

---

### Task 2: Serialize — parse, migrate, and seed `vehicleKinds`

**Files:**
- Modify: `packages/core/src/model/serialize.ts`
- Modify: `apps/web/scripts/verify.ts`

Every system shape (v1 legacy, v2 legacy, v3+) already funnels through one `finish()` function before returning — there is no separate per-version migration branch to add; a new field just needs parsing and a default there.

- [x] **Step 1: Add a `parseVehicleKinds` helper**

In `packages/core/src/model/serialize.ts`, add near the other `parse*` helpers (e.g. near `parseNamedWays`):

```ts
function parseVehicleKinds(raw: unknown): VehicleKind[] {
  if (!Array.isArray(raw)) return [];
  const out: VehicleKind[] = [];
  for (const v of raw) {
    const r = v as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.modeId !== "string" || typeof r.label !== "string") continue;
    if (typeof r.widthM !== "number" || typeof r.lengthM !== "number") continue;
    out.push({
      id: r.id,
      modeId: r.modeId,
      label: r.label,
      widthM: r.widthM,
      lengthM: r.lengthM,
      capacityPax: typeof r.capacityPax === "number" ? r.capacityPax : undefined,
      topSpeedKmh: typeof r.topSpeedKmh === "number" ? r.topSpeedKmh : undefined,
    });
  }
  return out;
}
```

Add `VehicleKind` to the existing `import type { ... } from "./system";` block at the top of the file.

- [x] **Step 2: Wire it into `finish()`**

In `finish()`, add `vehicleKinds: parseVehicleKinds(o.vehicleKinds),` to the returned object (next to `approachControls`), and bump the hardcoded `version: 8` there to `version: 9`.

- [x] **Step 3: Add `vehicleKindId` parsing to the v3+ service parser**

In `parseV3`'s `services: rawServices.map(...)` block, add to the returned object:

```ts
    vehicleKindId: typeof r.vehicleKindId === "string" ? r.vehicleKindId : undefined,
```

- [x] **Step 4: Update `createEmptySystem`**

In `createEmptySystem`, bump `version: 8` to `version: 9` (update its comment too) and add `vehicleKinds: [],` next to `approachControls: {},`.

- [x] **Step 5: Typecheck**

Run: `npx tsc -b --noEmit`
Expected: no errors anywhere in the repo.

- [x] **Step 6: Add migration + resolution checks**

In `apps/web/scripts/verify.ts`, find the existing checks that exercise `parseSystem` on an old-shaped object (search for `parseSystem(` calls near the migration test section), and add a block near them:

```ts
{
  const legacy = parseSystem({
    version: 8,
    id: "v8sys",
    name: "V8",
    viewport: { center: [-115.17, 36.11], zoom: 12 },
    createdAt: 1,
    updatedAt: 1,
    ways: [],
    services: [],
    stations: [],
    facilities: [],
    groups: [],
    nodes: [],
    namedWays: [],
    palette: [],
    drivingSide: "right",
    turnRestrictions: {},
    medians: {},
    approachControls: {},
  });
  check("a v8 system migrates with an empty vehicleKinds list", Array.isArray(legacy.vehicleKinds) && legacy.vehicleKinds.length === 0);
  check("a v8 system migrates to the current version", legacy.version === 9);

  const withKinds = parseSystem({
    ...legacy,
    vehicleKinds: [
      { id: "vk1", modeId: "bus", label: "Articulated bus", widthM: 2.6, lengthM: 18, topSpeedKmh: 60 },
      { id: "vk-bad", modeId: "bus" }, // missing widthM/lengthM — dropped, not thrown
    ],
  });
  check("a well-formed vehicle kind round-trips", withKinds.vehicleKinds.length === 1 && withKinds.vehicleKinds[0].label === "Articulated bus");

  check("createEmptySystem starts with an empty vehicle-kind list", createEmptySystem().vehicleKinds.length === 0);
}
```

- [x] **Step 7: Run verify, confirm pass**

Run: `npx tsx apps/web/scripts/verify.ts`
Expected: `ALL PASS`.

- [x] **Step 8: Stage**

```bash
git add packages/core/src/model/serialize.ts apps/web/scripts/verify.ts
```

---

### Task 3: Store actions — `setVehicleKinds`, `setServiceVehicleKind`

**Files:**
- Modify: `apps/web/src/editor/store.ts`

Mirrors the existing `setServiceSchedule` design exactly (see its own comment in `store.ts`): the dialog owns local add/edit/delete logic and commits the whole array in one shot, rather than the store exposing a setter per field.

- [x] **Step 1: Add the action signatures**

In the `EditorState` interface, add near `setServiceSchedule`:

```ts
  /** Replaces the system's whole vehicle-kind list in one shot — same
   *  live-commit convention as setServiceSchedule; VehicleKindsDialog owns
   *  add/edit/delete locally. */
  setVehicleKinds: (kinds: VehicleKind[]) => void;
  /** Assigns (or clears, with undefined) which VehicleKind a service runs. */
  setServiceVehicleKind: (id: string, vehicleKindId: string | undefined) => void;
```

Add `VehicleKind` to this file's existing `@transitmapper/core/model/system` type import.

- [x] **Step 2: Add the implementations**

Near `setServiceSchedule`'s implementation, add:

```ts
    setVehicleKinds: (kinds) => set((s) => ({ system: touch({ ...s.system, vehicleKinds: kinds }) })),
    setServiceVehicleKind: (id, vehicleKindId) =>
      set((s) => ({
        system: touch({ ...s.system, services: s.system.services.map((sv) => (sv.id === id ? { ...sv, vehicleKindId } : sv)) }),
      })),
```

- [x] **Step 3: Typecheck**

Run: `npx tsc -b --noEmit`
Expected: no errors.

- [x] **Step 4: Add checks**

In `apps/web/scripts/verify.ts`, find the store-action test section (it already creates a store via `createEditorStore()` and calls actions like `store.getState().setServiceMode(...)`), and add nearby:

```ts
{
  fresh();
  const wayId = store.getState().beginWay("road", "straight");
  store.getState().addWayPoint(wayId, [-115.2, 36.1]);
  store.getState().addWayPoint(wayId, [-115.19, 36.1]);
  store.getState().finishWay();
  store.getState().setDraftMode("bus");
  const serviceId = store.getState().addServiceToWay(wayId)!;

  store.getState().setVehicleKinds([{ id: "vk1", modeId: "bus", label: "Test bus", widthM: 2.6, lengthM: 12 }]);
  check("setVehicleKinds replaces the system's whole list", store.getState().system.vehicleKinds.length === 1);

  store.getState().setServiceVehicleKind(serviceId, "vk1");
  check("setServiceVehicleKind assigns a kind to a service", store.getState().system.services.find((s) => s.id === serviceId)?.vehicleKindId === "vk1");

  store.getState().setServiceVehicleKind(serviceId, undefined);
  check("setServiceVehicleKind(undefined) clears the assignment", store.getState().system.services.find((s) => s.id === serviceId)?.vehicleKindId === undefined);
}
```

- [x] **Step 5: Run verify, confirm pass**

Run: `npx tsx apps/web/scripts/verify.ts`
Expected: `ALL PASS`.

- [x] **Step 6: Stage**

```bash
git add apps/web/src/editor/store.ts apps/web/scripts/verify.ts
```

---

### Task 4: Resolve effective vehicle kind in the simulation

**Files:**
- Modify: `apps/web/src/sim/vehicles.ts`
- Modify: `apps/web/scripts/verify.ts`

This is where an assigned (or unassigned) vehicle kind actually changes rendering and timing. `buildTimetable`/`metersAtElapsed` gain a `speedMps` parameter with a default equal to today's constant, so the two existing verify.ts checks that call them with no speed argument keep passing unchanged.

- [x] **Step 1: Add `effectiveVehicleKind`**

In `apps/web/src/sim/vehicles.ts`, add after the `VehicleGate` interface:

```ts
/** Which real vehicle a service's animation/rendering should use: its
 *  assigned VehicleKind if it has one and it still exists, else the
 *  mode's plain default (vehicleFootprint) at the app's ambient default
 *  speed — the exact behavior every service had before vehicle kinds
 *  existed, so an unassigned service is never affected by this feature. */
export function effectiveVehicleKind(system: TransitSystem, service: Service): { widthM: number; lengthM: number; speedMps: number } {
  const kind = service.vehicleKindId ? system.vehicleKinds.find((k) => k.id === service.vehicleKindId) : undefined;
  if (kind) {
    return { widthM: kind.widthM, lengthM: kind.lengthM, speedMps: kind.topSpeedKmh !== undefined ? kind.topSpeedKmh / 3.6 : VEHICLE_SPEED_MPS };
  }
  const fallback = vehicleFootprint(service.modeId);
  return { widthM: fallback.widthM, lengthM: fallback.lengthM, speedMps: VEHICLE_SPEED_MPS };
}
```

- [x] **Step 2: Give `buildTimetable`/`metersAtElapsed` a speed parameter**

Replace their signatures:

```ts
export function buildTimetable(totalMeters: number, stops: DwellStop[], speedMps: number = VEHICLE_SPEED_MPS): Timetable {
  const travelMs = (totalMeters / speedMps) * 1000;
  const dwellMs = stops.reduce((sum, s) => sum + s.dwellMs, 0);
  return { oneWayMs: travelMs + dwellMs, stops };
}
```

```ts
export function metersAtElapsed(totalMeters: number, timetable: Timetable, elapsedMs: number, speedMps: number = VEHICLE_SPEED_MPS): number {
  let clock = 0;
  let lastDist = 0;
  for (const stop of timetable.stops) {
    const legMs = ((stop.distMeters - lastDist) / speedMps) * 1000;
    if (elapsedMs < clock + legMs) return lastDist + ((elapsedMs - clock) / 1000) * speedMps;
    clock += legMs;
    if (elapsedMs < clock + stop.dwellMs) return stop.distMeters;
    clock += stop.dwellMs;
    lastDist = stop.distMeters;
  }
  return Math.min(totalMeters, lastDist + ((elapsedMs - clock) / 1000) * speedMps);
}
```

- [x] **Step 3: Thread speed through both geometry resolvers and their caches**

Replace `resolvePatternGeometry` and its cache:

```ts
interface CachedPatternGeometry extends PatternGeometry {
  forWays: Way[];
  forStations: Station[];
  forSpeedMps: number;
}
const patternGeometryCache = new WeakMap<Pattern, CachedPatternGeometry>();

function resolvePatternGeometry(system: TransitSystem, pattern: Pattern, speedMps: number): PatternGeometry | null {
  const cached = patternGeometryCache.get(pattern);
  if (cached && cached.forWays === system.ways && cached.forStations === system.stations && cached.forSpeedMps === speedMps) return cached;
  const path = patternPath(system.ways, pattern);
  if (path.length < 2) return null;
  const meters = pathLengthMeters(path);
  if (meters === 0) return null;
  const stops = dwellStopsForPattern(system, pattern, path, meters);
  const timetable = buildTimetable(meters, stops, speedMps);
  const geometry: CachedPatternGeometry = { path, meters, timetable, forWays: system.ways, forStations: system.stations, forSpeedMps: speedMps };
  patternGeometryCache.set(pattern, geometry);
  return geometry;
}
```

And `resolveInfraPatternGeometry`:

```ts
interface CachedInfraPatternGeometry extends PatternGeometry {
  forWays: Way[];
  forStations: Station[];
  forModeId: string;
  forSpeedMps: number;
}
const infraPatternGeometryCache = new WeakMap<Pattern, CachedInfraPatternGeometry>();

function resolveInfraPatternGeometry(system: TransitSystem, pattern: Pattern, modeId: string, speedMps: number): PatternGeometry | null {
  const cached = infraPatternGeometryCache.get(pattern);
  if (
    cached &&
    cached.forWays === system.ways &&
    cached.forStations === system.stations &&
    cached.forModeId === modeId &&
    cached.forSpeedMps === speedMps
  )
    return cached;
  const path = patternLanePath(system.ways, pattern, modeId);
  if (path.length < 2) return null;
  const meters = pathLengthMeters(path);
  if (meters === 0) return null;
  const stops = dwellStopsForPattern(system, pattern, path, meters);
  const timetable = buildTimetable(meters, stops, speedMps);
  const geometry: CachedInfraPatternGeometry = {
    path,
    meters,
    timetable,
    forWays: system.ways,
    forStations: system.stations,
    forModeId: modeId,
    forSpeedMps: speedMps,
  };
  infraPatternGeometryCache.set(pattern, geometry);
  return geometry;
}
```

- [x] **Step 4: Use `effectiveVehicleKind` in the tick loop**

In `attachVehicleAnimation`'s tick function, replace the per-pattern geometry resolution and the infra feature's dimensions:

```ts
      for (const service of system.services) {
        if (!gate.isVisible(service)) continue;
        const headwayMinutes = effectiveHeadwayMinutes(service);
        const { widthM, lengthM, speedMps } = effectiveVehicleKind(system, service);
        for (const pattern of service.patterns) {
          const geometry =
            viewMode === "network"
              ? resolvePatternGeometry(system, pattern, speedMps)
              : resolveInfraPatternGeometry(system, pattern, service.modeId, speedMps);
          if (!geometry) continue;
```

And further down, where the infra polygon is built, drop the now-redundant `vehicleFootprint` call in favor of the already-resolved `widthM`/`lengthM`:

```ts
            } else {
              const center = pointAtT(path, t);
              const bearing = bearingAtT(path, t);
              infraFeatures.push({
                type: "Feature",
                properties: { color: service.color },
                geometry: { type: "Polygon", coordinates: [rotatedRectPolygon(center, bearing, widthM, lengthM)] },
              });
            }
```

`vehicleFootprint` is still imported and used — now only inside `effectiveVehicleKind`, not directly in the tick loop; leave the import as-is.

- [x] **Step 5: Typecheck**

Run: `npx tsc -b --noEmit`
Expected: no errors.

- [x] **Step 6: Add checks**

In `apps/web/scripts/verify.ts`, add `effectiveVehicleKind` to the existing `../src/sim/vehicles` import, then add a block near the `buildTimetable`/`metersAtElapsed` checks:

```ts
{
  const busService: Service = { id: "evk-bus", name: "Bus", modeId: "bus", color: "#2ea44f", patterns: [] };
  const sysNoKinds: TransitSystem = { ...createEmptySystem(), vehicleKinds: [] };

  const unassigned = effectiveVehicleKind(sysNoKinds, busService);
  const busDefault = vehicleFootprint("bus");
  check("an unassigned service resolves to its mode's plain default size", unassigned.widthM === busDefault.widthM && unassigned.lengthM === busDefault.lengthM);
  check("an unassigned service resolves to the app's default speed", unassigned.speedMps === VEHICLE_SPEED_MPS);

  const sysWithKind: TransitSystem = {
    ...sysNoKinds,
    vehicleKinds: [{ id: "evk1", modeId: "bus", label: "Articulated", widthM: 2.6, lengthM: 18, topSpeedKmh: 72 }],
  };
  const assigned = effectiveVehicleKind(sysWithKind, { ...busService, vehicleKindId: "evk1" });
  check("an assigned service uses its vehicle kind's own dimensions", assigned.widthM === 2.6 && assigned.lengthM === 18);
  check("an assigned service's top speed converts km/h to m/s", Math.abs(assigned.speedMps - 20) < 1e-9);

  const kindNoSpeed: TransitSystem = { ...sysNoKinds, vehicleKinds: [{ id: "evk2", modeId: "bus", label: "No speed set", widthM: 3, lengthM: 20 }] };
  const assignedNoSpeed = effectiveVehicleKind(kindNoSpeed, { ...busService, vehicleKindId: "evk2" });
  check("an assigned kind with no topSpeedKmh falls back to the app's default speed", assignedNoSpeed.speedMps === VEHICLE_SPEED_MPS);

  const danglingRef = effectiveVehicleKind(sysNoKinds, { ...busService, vehicleKindId: "does-not-exist" });
  check("a vehicleKindId pointing at a deleted kind falls back to the mode default, not a crash", danglingRef.widthM === busDefault.widthM);
}
```

- [x] **Step 7: Run verify, confirm pass**

Run: `npx tsx apps/web/scripts/verify.ts`
Expected: `ALL PASS`.

- [x] **Step 8: Stage**

```bash
git add apps/web/src/sim/vehicles.ts apps/web/scripts/verify.ts
```

---

### Task 5: `VehicleKindsDialog`

**Files:**
- Create: `apps/web/src/ui/VehicleKindsDialog.tsx`

Same live-commit local-state pattern as `apps/web/src/ui/ScheduleDialog.tsx` — no separate Save step, every edit commits immediately via `onSave`.

- [x] **Step 1: Write the component**

Create `apps/web/src/ui/VehicleKindsDialog.tsx`:

```tsx
import { useState } from "react";
import { shortId } from "@transitmapper/core/model/ids";
import { MODES, MODE_ORDER } from "@transitmapper/core/model/catalog";
import type { VehicleKind } from "@transitmapper/core/model/system";
import { blurOnEnter } from "./formUtils";
import { Icon } from "./Icon";
import { IconButton } from "./IconButton";
import { Modal } from "./Modal";

interface VehicleKindsDialogProps {
  /** The service that opened this dialog — a newly added kind defaults to
   *  its mode, but every kind in the system (any mode) is listed here. */
  modeId: string;
  vehicleKinds: VehicleKind[];
  readOnly: boolean;
  onSave: (kinds: VehicleKind[]) => void;
  onClose: () => void;
}

/**
 * System-wide manager for custom vehicle kinds — lets someone testing a
 * transit system idea define specific equipment (real size + top speed)
 * a line can be assigned to run, instead of every service of a mode
 * sharing one fixed default. Same live-commit local-array pattern as
 * ScheduleDialog: owns its own draft array, commits the WHOLE array back
 * via onSave on every change (store.ts's setVehicleKinds is a one-shot
 * replace), no separate Save step.
 */
export function VehicleKindsDialog({ modeId, vehicleKinds, readOnly, onSave, onClose }: VehicleKindsDialogProps) {
  const [kinds, setKinds] = useState<VehicleKind[]>(vehicleKinds);

  const commit = (next: VehicleKind[]) => {
    setKinds(next);
    onSave(next);
  };

  const updateKind = (kid: string, patch: Partial<VehicleKind>) => commit(kinds.map((k) => (k.id === kid ? { ...k, ...patch } : k)));
  const removeKind = (kid: string) => commit(kinds.filter((k) => k.id !== kid));
  const addKind = () => commit([...kinds, { id: shortId(), modeId, label: `${MODES[modeId]?.label ?? "Vehicle"} kind`, widthM: 2.6, lengthM: 12 }]);

  return (
    <Modal
      title="Vehicle kinds"
      description="Define specific vehicles a line can be assigned to run — its real size (drives the Infrastructure-view footprint) and top speed (drives how fast it animates). A service left unassigned keeps using its mode's plain default."
      onClose={onClose}
      className="schedule-modal"
    >
      {kinds.length === 0 ? (
        <p className="panel-hint">No custom vehicle kinds yet — every service is using its mode's plain default size and speed.</p>
      ) : (
        <ul className="schedule-list">
          {kinds.map((k) => (
            <li key={k.id} className="schedule-editor-row">
              <div className="schedule-editor-row-head">
                <input
                  className="schedule-label-input"
                  aria-label="Vehicle kind name"
                  value={k.label}
                  disabled={readOnly}
                  placeholder="Vehicle name"
                  onChange={(e) => updateKind(k.id, { label: e.target.value })}
                  onKeyDown={blurOnEnter}
                />
                {!readOnly && <IconButton icon="trash" size={15} label={`Delete ${k.label || "this vehicle kind"}`} onClick={() => removeKind(k.id)} />}
              </div>

              <label className="field-label" htmlFor={`vk-mode-${k.id}`}>
                Mode
              </label>
              <select
                id={`vk-mode-${k.id}`}
                className="opt-select"
                style={{ width: "100%", marginBottom: 8 }}
                disabled={readOnly}
                value={k.modeId}
                onChange={(e) => updateKind(k.id, { modeId: e.target.value })}
              >
                {MODE_ORDER.map((mid) => (
                  <option key={mid} value={mid}>
                    {MODES[mid].label}
                  </option>
                ))}
              </select>

              <div className="freq-row">
                <input
                  type="number"
                  min={0.5}
                  step={0.1}
                  className="freq-input"
                  aria-label={`${k.label || "Vehicle"} width in meters`}
                  value={k.widthM}
                  disabled={readOnly}
                  onChange={(e) => updateKind(k.id, { widthM: Math.max(0.5, Number(e.target.value) || 0.5) })}
                />
                <span className="freq-suffix">m wide</span>
                <input
                  type="number"
                  min={1}
                  step={0.5}
                  className="freq-input"
                  aria-label={`${k.label || "Vehicle"} length in meters`}
                  value={k.lengthM}
                  disabled={readOnly}
                  onChange={(e) => updateKind(k.id, { lengthM: Math.max(1, Number(e.target.value) || 1) })}
                />
                <span className="freq-suffix">m long</span>
              </div>

              <div className="freq-row">
                <input
                  type="number"
                  min={0}
                  className="freq-input"
                  aria-label={`${k.label || "Vehicle"} passenger capacity`}
                  placeholder="Not set"
                  value={k.capacityPax ?? ""}
                  disabled={readOnly}
                  onChange={(e) => updateKind(k.id, { capacityPax: e.target.value === "" ? undefined : Math.max(0, Math.round(Number(e.target.value))) })}
                />
                <span className="freq-suffix">passengers</span>
                <input
                  type="number"
                  min={0}
                  className="freq-input"
                  aria-label={`${k.label || "Vehicle"} top speed in km/h`}
                  placeholder="Not set"
                  value={k.topSpeedKmh ?? ""}
                  disabled={readOnly}
                  onChange={(e) => updateKind(k.id, { topSpeedKmh: e.target.value === "" ? undefined : Math.max(0, Number(e.target.value)) })}
                />
                <span className="freq-suffix">km/h top speed</span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!readOnly && (
        <button type="button" className="ghost-btn" style={{ width: "100%", justifyContent: "center" }} onClick={addKind}>
          <Icon name="plus" size={17} /> Add vehicle kind
        </button>
      )}
    </Modal>
  );
}
```

- [x] **Step 2: Typecheck**

Run: `npx tsc -b --noEmit`
Expected: no errors.

- [x] **Step 3: Stage**

```bash
git add apps/web/src/ui/VehicleKindsDialog.tsx
```

---

### Task 6: Wire the dialog and picker into `ServiceInspector`

**Files:**
- Modify: `apps/web/src/ui/inspector/ServiceInspector.tsx`

- [x] **Step 1: Add imports and state**

Add near the top, alongside the existing `ScheduleDialog` lazy import:

```ts
const VehicleKindsDialog = lazy(() => import("../VehicleKindsDialog").then((m) => ({ default: m.VehicleKindsDialog })));
```

Inside the component, alongside the existing `scheduleOpen` state:

```ts
  const [vehicleKindsOpen, setVehicleKindsOpen] = useState(false);
```

Alongside the existing selectors (`setServiceSchedule`, etc.):

```ts
  const vehicleKinds = useEditor((s) => s.system.vehicleKinds);
  const setServiceVehicleKind = useEditor((s) => s.setServiceVehicleKind);
  const setVehicleKinds = useEditor((s) => s.setVehicleKinds);
```

- [x] **Step 2: Add the picker to the "line" tab**

In the `tab === "line"` block, after the Mode chip-row's closing `</div>` and before the `ColorField`'s wrapping `<div className="insp-field">`, insert:

```tsx
          <label className="field-label" htmlFor="vehicle-kind-select">
            Vehicle
          </label>
          <select
            id="vehicle-kind-select"
            className="opt-select"
            style={{ width: "100%", marginBottom: 4 }}
            disabled={readOnly}
            value={service.vehicleKindId ?? ""}
            onChange={(e) => setServiceVehicleKind(id, e.target.value || undefined)}
          >
            <option value="">Default {MODES[service.modeId]?.label ?? "vehicle"}</option>
            {vehicleKinds
              .filter((k) => k.modeId === service.modeId)
              .map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
          </select>
          {!readOnly && (
            <button type="button" className="link-btn" style={{ display: "block", marginBottom: 12 }} onClick={() => setVehicleKindsOpen(true)}>
              Manage vehicle kinds…
            </button>
          )}
```

- [x] **Step 3: Render the dialog**

Alongside the existing `{scheduleOpen && (...)}` block:

```tsx
      {vehicleKindsOpen && (
        <Suspense fallback={null}>
          <VehicleKindsDialog
            modeId={service.modeId}
            vehicleKinds={vehicleKinds}
            readOnly={readOnly}
            onSave={setVehicleKinds}
            onClose={() => setVehicleKindsOpen(false)}
          />
        </Suspense>
      )}
```

- [x] **Step 4: Typecheck**

Run: `npx tsc -b --noEmit`
Expected: no errors.

- [x] **Step 5: Stage**

```bash
git add apps/web/src/ui/inspector/ServiceInspector.tsx
```

---

### Task 7: Browser verification

- [x] **Step 1: Start the dev server, select a bus or rail service**

Open the app, select an existing service (or draw one), open its Inspector. Confirm the new "Vehicle" dropdown shows "Default <Mode>" and a "Manage vehicle kinds…" link.

- [x] **Step 2: Create a custom vehicle kind**

Click "Manage vehicle kinds…", add one (e.g. a bus, 3m wide, 20m long, 90 km/h top speed), close the dialog. Confirm the service's Vehicle dropdown now lists it.

- [x] **Step 3: Assign it and confirm both effects**

Assign the new kind to the service. Switch to Infrastructure view — confirm the rendered vehicle rectangle is now visibly bigger (matches the custom dimensions, not the mode default). Watch it animate — confirm it now moves faster than an unassigned service of the same mode (visually, over a short observation window).

- [x] **Step 4: Confirm deletion falls back cleanly**

Reopen "Manage vehicle kinds…", delete the assigned kind, close. Confirm the service's Vehicle dropdown falls back to "Default <Mode>" and the vehicle's rendered size/speed reverts to the mode default — no crash, no stuck stale state.

- [x] **Step 5: Confirm an untouched service is unaffected**

Check a different, never-assigned service of the same mode — confirm its size/speed never changed throughout the above steps.

---

## Commits

As with the previous plan, steps say "stage" rather than "commit" — commits happen only with explicit user go-ahead once this plan (and its browser verification) is complete.
