# Stations, Stops, and Service Calls

## Context

TransitMapper currently saves every passenger boarding location as a `Station`
and calls a Service reaching that record a Stop. The relationship is internally
consistent, but the public language is not. A roadside bus pole is not normally
a station, a platform inside a station is not the station itself, and a Service
calling at a place is an operational event rather than a physical object.

The sidebar redesign exposed this ambiguity because the same saved records
appear as Stations in a top-level section and as Stops beneath Services. This
design replaces that overload with three concepts that match rider language and
remain precise enough for planning and simulation.

## Goals

- Make ordinary passenger-place language understandable without transit or data
  modeling expertise.
- Represent a physical boarding point independently from an optional station
  complex.
- Keep Service-specific stopping behavior operational and mode-specific.
- Preserve existing documents, geometry, names, skip rules, schedules, and
  imported data through a deterministic schema migration.
- Keep the common case compact: most people should work with Stops and never
  need to create a Station record.

## Non-goals

- Do not introduce a timetable of individual arrivals or persist every vehicle
  event.
- Do not require every Stop to belong to a Station.
- Do not infer station complexes from proximity, shared names, transfer counts,
  or the mere presence of rail service.
- Do not replace generic Facilities with Stations or use Station as a synonym
  for every passenger-facing building.
- Do not redesign fares or accessibility metadata in this change.

## Vocabulary

- **Stop** is one physical place where passengers board or leave a vehicle. A
  bus pole, curb, bay, platform, and ferry berth are all Stops.
- **Station** is an optional named passenger place or complex containing one or
  more Stops. A station may own a boundary and other complex-scale physical
  presentation. A Stop does not become a Station merely because it is busy or
  has a shelter.
- **Service call** is a particular Service serving a Stop. Calls are derived
  from the Service path, Stop anchors, direction, and skip rules. They are not
  independently saved records.
- **Interchange** is derived presentation describing useful transfers among
  distinct public Lines at a Stop or within a Station. It is not another entity
  type.

The relationship is:

```text
Station (optional passenger place)
  -> Stop (physical boarding point)
       <- Service call (derived operational relationship)
            <- Service (one-mode operation)
                 <- Line (public map identity)
```

## Document model

Schema version 16 separates the two saved physical concepts:

```ts
interface Stop {
  id: string;
  name?: string;
  autoNamed?: boolean;
  coord: LngLat;
  anchors: StopAnchor[];
  stationId?: string;
  dwellSeconds?: number;
  major?: boolean;
}

interface Station {
  id: string;
  name?: string;
  coord: LngLat;
  footprint?: LngLat[];
  platforms?: Platform[];
}

interface TransitSystem {
  version: 16;
  stops: Stop[];
  stations: Station[];
}
```

`Stop.stationId` is the one authoritative containment direction. A Stop belongs
to at most one Station. A Station may temporarily contain no Stops while it is
being drawn or edited. Reverse lookups are indexed pure projections rather than
a second stored ID list that can drift.

The current `StationAnchor` becomes `StopAnchor`, because Stops ride the Ways
that Services traverse. A Station has a coordinate for selection, labeling, and
focusing, but does not ride every Way used by its children. Moving or reshaping
a Way therefore reanchors Stops only.

`dwellSeconds` and the major-label override move to Stop. They affect a vehicle
call and stop-level map priority, not the enclosing Station. Footprints remain
on Station. Existing platform polygons remain Station-owned physical geometry;
they are not automatically equated with a Stop because the legacy records do
not encode that relationship.

## Derived Service calls

Core exposes a plain derived value for a Service calling at a Stop:

```ts
interface ServiceCall {
  serviceId: string;
  stopId: string;
  direction: RunDirection;
  distanceMeters: number;
  dwellMs: number;
}
```

The exact projection may carry additional display data, but the saved document
does not gain a `calls` array. Existing path and skipped-stop behavior remains
the authority. A Stop row nested beneath a Service represents this relationship
and selects the Service with call context. A physical Stop row selects the Stop.

Deleting a Stop removes its ID from per-direction skip rules and clears any
transient call selection. Deleting a Station preserves its Stops and removes
their `stationId`; deleting the passenger place must not silently delete every
boarding point inside it. Deleting a Service never deletes Stops or Stations.

## Migration from schema version 15

Migration is deterministic and preserves every old passenger point:

1. Each v15 `Station` becomes a v16 Stop with the same ID, name, coordinate,
   anchors, dwell time, automatic-name state, and major-label state. Keeping the
   ID preserves skip rules, group membership, and references that meant the
   physical boarding point.
2. A v15 record with a footprint or platform geometry also produces a Station.
   Its ID is derived from the Stop ID with a stable `-station` suffix, made
   collision-safe within the Station collection. It inherits the name,
   coordinate, footprint, and platforms, and the migrated Stop points to it.
3. A v15 record without station-scale infrastructure does not produce a
   Station. Proximity, mode, and naming are not sufficient evidence.
4. Existing generic Groups continue to reference the migrated Stop IDs. This
   migration does not guess that an arbitrary Group is a Station.

Parsing validates unique Stop and Station IDs, existing `stationId` references,
and existing Way anchors. Missing Station references are removed during repair
so the Stop remains usable; duplicate IDs or structurally ambiguous documents
use the existing recoverable load-failure path.

## GTFS import

GTFS `stops.txt` maps according to its declared hierarchy:

- boarding locations and platforms used by `stop_times.txt` become Stops;
- a `parent_station` relation connects that Stop to a Station;
- `location_type=1` records become Stations even when no child from the selected
  routes has yet been imported;
- a feed without hierarchy imports Stops only and does not invent Stations.

GTFS source IDs remain importer-local deduplication keys. TransitMapper mints
document IDs as it does today. Batches share both Stop and Station lookup maps
so two Lines using the same platform or parent Station resolve to one record.

## Editor experience

### Network and Diagram

The Line hierarchy continues to reveal Stops beneath the relevant Service. The
row means “this Service calls at this Stop” and includes Line or Service context
in its accessible name. Selecting it focuses the Stop and opens the Service
inspector at that call.

A separate **Stops** section lists physical boarding points that can be selected
independently of a Service. A **Stations** section appears only when real Station
records exist. Stations summarize their contained Stops and calling Lines.
Diagram remains read-only but uses the same nouns.

### Infrastructure

Stops and Stations are separate sections. Stops expose anchors and stop-scale
properties. Stations expose their name, footprint, platform geometry, and
contained Stops. Raw geometry remains on the canvas rather than flooding the
outline.

The existing passenger-place tool is labeled **Stop** in Network and creates a
Stop. In Infrastructure, drawing a footprint creates a **Station**. Creating a
Station does not fabricate a Stop; the Station inspector lets the user attach
nearby existing Stops. The inspector remains the only property-editing surface.

### Inspectors and selection

- Stop inspector: name, served-by summary, combined frequency, dwell time,
  major-label override, Way anchors, and optional Station membership.
- Station inspector: name, footprint, platforms, contained Stops, and aggregated
  calling Lines.
- Service inspector with call context: stopping/skipping behavior for that Stop
  and a link to the physical Stop.

Selection gains a physical `{ kind: 'stop', id }`. A Service call remains
`{ kind: 'service', id, stopId }`. `{ kind: 'station', id }` now means the
optional Station record only. Delete/Backspace follows those distinctions and
never treats a Service call selection as permission to delete its Service.

## Rendering and simulation

Network and Diagram render Stops from `system.stops`. A Station may contribute
its name and interchange grouping to child Stop labels but is not rendered as a
duplicate boarding marker. Infrastructure additionally renders Station
footprints and platform geometry.

Vehicle dwell, stop ordering, skipped calls, frequency aggregation, and fleet
math switch from the old `stations` input to Stops without changing their
behavior. Transfer and interchange derivation count distinct Lines across all
Stops in the same Station as well as multiple Lines at one standalone Stop.

## Failure handling and performance

Stop-to-Station and Stop-to-Way indexes are built once per document collection
identity and reused by outline, inspector, rendering, and simulation
projections. A malformed containment reference cannot crash the editor or hide
the canvas. Section error boundaries continue isolating outline failures.

Large Stop lists keep the shared bounded-rendering and full-collection search
contract. Expanding one Station must not cause repeated full-document scans for
every contained Stop.

## Documentation and tests

The data-model, editor-interaction, station-design, route-service, simulation,
GTFS import, and project-structure documentation must use the new meanings.
Tests cover:

- v15 migration with plain Stops and footprint-bearing Stations;
- v16 validation and repair;
- GTFS parent Station import and feeds without hierarchy;
- Stop reanchoring and service-call derivation;
- Station containment and deletion semantics;
- selection, keyboard deletion, inspector, and sidebar distinctions;
- Network, Infrastructure, and Diagram rendering;
- per-Station interchange aggregation without duplicate Stop markers;
- bounded outline search and accessibility labels.
