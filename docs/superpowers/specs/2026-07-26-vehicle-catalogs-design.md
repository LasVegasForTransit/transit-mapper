# Vehicle catalogs — custom vehicle kinds per system

## Context

[Vehicles in Infrastructure view](2026-07-26-vehicles-in-infrastructure-view-design.md)
renders each mode's vehicles as true-to-scale polygons, sized from a flat
per-mode default table (bus ≈2.6×12m, light rail car ≈2.65×27m, …). That
spec assumes one fixed size per mode.

This spec lets a person testing a transit system idea choose _which_
vehicle a line actually runs — e.g. a short single-unit LRV vs. a long
double-consist one, for the same "light rail" mode — and see that choice
reflected both in the rendered footprint and in how fast the line runs.

Separately, `apps/web/src/sim/vehicles.ts` runs every single vehicle, of
every mode, at one hardcoded global speed
(`VEHICLE_SPEED_MPS = 11`, explicitly commented "ambient delight, not
simulation"). This spec makes that speed a property of the chosen vehicle
kind instead.

## Goals

- A person can define custom **vehicle kinds** within their transit system:
  a label, a mode it belongs to, physical size (width/length in meters),
  passenger capacity, and a top speed.
- A service can be assigned a specific vehicle kind. Assigning one changes
  both its rendered footprint (Infrastructure view) and its simulated
  travel speed.
- Every mode still works with zero setup — an unassigned service falls
  back to a sensible built-in default kind for its mode (the same
  dimensions/behavior as before this spec existed).
- Vehicle kinds are part of the transit system document, saved and shared/
  forked with it, same as stations, ways, and services already are.

## Non-goals

- A personal library of vehicle kinds shared across different systems.
  Explicitly rejected — kinds belong to one system, matching every other
  piece of user-created data in this app.
- Per-`Pattern` vehicle kind overrides. Assignment is per-`Service`, the
  same granularity `modeId` already uses.
- Capacity actually constraining or informing anything simulated
  (ridership, crowding). It is a stored, displayed number only — this app
  has no ridership modeling at all yet (a later milestone per the
  project's own roadmap), and adding one is well outside this spec.
- A custom color/livery per vehicle kind. Rendered fill stays the
  service's route color, per the previous spec — a vehicle kind changes
  size and speed, not paint.
- Real acceleration/deceleration curves, or top speed varying by way type
  (e.g. slower through a station throat). The sim stays a constant-speed
  walk, as it is today — only which constant it uses becomes configurable.

## Architecture

### Data model

New type, alongside `Service`/`Pattern` in `packages/core/src/model/system`:

```ts
interface VehicleKind {
  id: string;
  modeId: string; // which mode this kind is usable for
  label: string; // "Siemens S700", "40' Standard Bus"
  widthM: number;
  lengthM: number;
  capacityPax?: number; // informational only, see Non-goals
  topSpeedKmh?: number; // drives simulated travel time; see below
}
```

`TransitSystem` gains `vehicleKinds: VehicleKind[]`. Migration (new
`serialize.ts` version) adds `vehicleKinds: []` to older saves — an empty
list changes nothing, since every mode already has an implicit default
(next section).

`Service` gains `vehicleKindId?: string`. Unset means "use this mode's
default."

### Defaults

Each mode's per-mode entry in `catalogStyle.ts` (introduced by the
previous spec, for the plain-default case) becomes the seed for a
synthesized default `VehicleKind` per mode — same width/length, top speed
defaulting to today's global `VEHICLE_SPEED_MPS`. A service with no
`vehicleKindId` resolves to its mode's synthesized default. This is how
"every mode works with zero setup" holds: nothing about existing systems'
behavior changes until someone actively creates and assigns a custom kind.

### Rendering (extends the previous spec)

The rotated-rectangle polygon width/length (previous spec, section 4) is
sourced from the service's _resolved_ vehicle kind — assigned kind if
`vehicleKindId` is set, else the mode's synthesized default — instead of
reading the per-mode table directly. The per-mode table doesn't go away;
it just moves one layer down, to where defaults are seeded from.

### Simulation speed

`buildTimetable`/`metersAtElapsed` (`apps/web/src/sim/vehicles.ts`) take an
explicit speed-in-m/s parameter instead of reading the module-level
`VEHICLE_SPEED_MPS` constant directly. `resolvePatternGeometry` resolves
this once per pattern: `service.vehicleKindId` → matching `VehicleKind` in
`system.vehicleKinds` → `topSpeedKmh` converted to m/s, falling back to
`VEHICLE_SPEED_MPS` when the kind has no `topSpeedKmh` or none is
assigned. The existing cache-invalidation convention (`forWays`/
`forStations` reference checks) gains a third check, `forVehicleKinds:
system.vehicleKinds`, so editing or reassigning a vehicle kind invalidates
the cached timetable the same way editing a way already does.

### UI

- `ServiceInspector` gains a "Vehicle" field: a dropdown of vehicle kinds
  whose `modeId` matches the service (plus the mode's default, always
  listed first), and an inline "+ New vehicle kind" action opening a small
  form (label, width, length, capacity, top speed) that creates and
  immediately assigns it — no context switch required for the common case.
- A separate lightweight management view lists every vehicle kind in the
  system for editing/deleting, in the same floating-dialog style as
  `ImportDialog` — not a second permanent sidebar, consistent with this
  project's one-dynamic-surface rule (the Inspector stays the only
  per-selection contextual panel; this is a system-wide list, like
  `LinesPanel` is for services).

## Testing

- Unit coverage: resolving a service's effective vehicle kind (assigned →
  found; assigned → deleted/missing, falls back to default; unset → mode
  default), and the migration adding `vehicleKinds: []` to an old save.
- Browser verification: create a custom vehicle kind, assign it to a
  service, confirm both the Infrastructure-view footprint size and the
  vehicle's animated speed visibly change; confirm an untouched service
  still renders/runs exactly as before this spec.

## Open follow-ups (not blocking this spec)

- A cross-system personal vehicle-kind library.
- Per-`Pattern` overrides for branches that genuinely run different
  equipment than their trunk service.
- Capacity/ridership actually feeding into anything.
