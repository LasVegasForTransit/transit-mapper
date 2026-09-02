# Data model

A saved document is one `TransitSystem` (defined in
[`src/model/system.ts`](../../../packages/core/src/model/system.ts)): a regional, multimodal
network. The model's central split is **infrastructure versus service**: a `Way` is the physical
carrier, a `Service` is a colored route people ride, and many services can share one way.

All kind fields (`typeId`, `modeId`, `kindId`, and so on) are string ids into the catalogs; see
[Catalogs](catalogs.md). The schema is versioned (currently v10) and migrated on load in
`packages/core/src/model/serialize.ts`, so older saves and shared snapshots keep working.

## TransitSystem

| Field                       | Meaning                                                         |
| --------------------------- | --------------------------------------------------------------- |
| `version`                   | Schema version (10).                                            |
| `id`, `name`, `description` | Identity.                                                       |
| `viewport`                  | Saved camera (`center`, `zoom`).                                |
| `ways`                      | Physical infrastructure.                                        |
| `services`                  | Transit lines.                                                  |
| `stations`                  | Stops / stations.                                               |
| `facilities`                | Catalog-typed point and area features.                          |
| `groups`                    | Bundles of members; a facility complex when it has a footprint. |
| `nodes`                     | Junctions — coordinates shared by 2+ ways.                      |
| `namedWays`                 | Shared identities across ways ("Decatur Avenue").               |
| `vehicleKinds`              | User-defined vehicle types a service can run.                   |
| `palette`                   | The system's saved colors.                                      |

## Way — physical infrastructure

One alignment on, above, or below the ground: a road, a track, a bike path, a gondola span, a ferry
route. One unified type covers all of them, discriminated by `typeId` into the way-type catalog;
there is no per-mode class hierarchy.

| Field      | Meaning                                                                |
| ---------- | ---------------------------------------------------------------------- |
| `typeId`   | Way-type catalog id (`road`, `heavyRail`, `bike`, …).                  |
| `points`   | Control vertices (`[lng, lat]`) defining the alignment.                |
| `geometry` | How the path renders between points: `straight`, `curved`, `freeform`. |
| `grade`    | `underground`, `atGrade`, or `elevated`.                               |
| `profile`  | The cross-section (below).                                             |
| `classId`  | Facility class within the type (arterial vs. local, …).                |
| `source`   | Provenance marker, e.g. `"osm:<wayId>"` for imported ways.             |

### CrossSection and LaneSpec

A way's `profile` is its full cross-section: an ordered list of lanes, **left-to-right as seen
facing forward** (the direction of increasing point index, the osm2streets convention).

```ts
interface LaneSpec {
  id: string; // stable, so junction connectors can reference it
  kindId: string; // lane-kind catalog id: drive, track, median, sidewalk, …
  widthM: number; // meters (the UI shows feet)
  direction: 'forward' | 'backward' | 'both' | 'none';
}
```

The profile is constant along a way. Where a street's section changes (a turn pocket appears, a lane
drops), the way is split and the pieces share identity through a `NamedWay`. Capacity (a road's
"lanes", a railway's "tracks") is **derived** from the profile
(`packages/core/src/model/profile.ts`), never stored.

## Node — junctions

A `Node` is a coordinate shared by two or more ways' control points: real topology, not two paths
that happen to cross visually. Every store mutation that inserts, deletes, or moves control points
keeps `refs` (`{wayId, pointIndex}` pairs) in sync.

- `control` is traffic control: `uncontrolled`, `signal`, `stop`, `roundabout`.
- `connectors` is the lane-connectivity graph: each `LaneConnector` says one specific incoming lane
  continues into one specific outgoing lane. It's stored only once the user customizes turn lanes;
  otherwise it's derived by heuristic on demand. Turn arrows are derived from connectors rather than
  stored.

Nodes are built three ways, all producing the same record. Editing forms them as a side effect of
drawing, splitting, and joining (`apps/web/src/editor/store.ts`). Loading a document that predates
stored nodes derives them from coordinate coincidence (`deriveNodesFromWays` in
`packages/core/src/model/serialize.ts`). OSM import derives them from OSM's node ids
(`packages/core/src/model/import.ts`), which is exact — two imported ways join exactly when OSM says
they share a node, so co-located but unconnected infrastructure (a tram in a street, a bridge over a
road) stays separate. An import also sets `control` where OSM records a signal, stop, or roundabout;
everything else arrives uncontrolled.

Lane-keyed components (turn restrictions) are pruned to the lanes that actually exist on every
system update, so deleting a way, merging two, or replacing a cross-section cannot leave an
invisible entry behind for a later lane to inherit.

Two ways at different `grade`s never need a junction between them, and the crossing check in
`packages/core/src/model/validate.ts` skips such pairs — an elevated way over a surface street is a
bridge, not a missing junction.

Two ways of different `typeId`s never get one from a crossing either, at any grade — a node carries
a lane graph, and the lanes of a road do not continue into the lanes of a rail line.

A junction that already exists is held to a looser rule, because deleting one destroys a connection
somebody (or OpenStreetMap) recorded on purpose: its arms must share a `junctionGroupId` (see
[Catalogs](catalogs.md)), so a bike path may meet a street but a road may not meet a railway.
`withSingleTypeArms` in `packages/core/src/model/junctions.ts` enforces that as a document loads and
as an import merges, keeping the largest compatible group of arms and dropping the rest. Nothing
moves: the ways still cross at that coordinate, which is what a level crossing looks like until the
model has one.

To take an arm out by hand, use the junction inspector's **Connections** tab. That one does move the
arm's control point clear, so the coordinate stops being shared at all.

## NamedWay — shared identity

```ts
interface NamedWay {
  id: string;
  name: string;
  wayIds: string[];
}
```

One named physical facility spanning several ways: the two one-way carriageways of a boulevard, a
trail crossing many junction-split segments. What the identity is _called_ in the UI ("Street",
"Line", "Trail") comes from the way family's catalog noun.

## Service, Pattern, SchedulePeriod

A `Service` is a colored route: `name`, `modeId` (mode catalog), `color`, and one or more
`Pattern`s. A plain line has one pattern; two or more model branches sharing the service's identity
("via Airport"). Still branches, not directions — the two directions of one path are two readings of
a single pattern, because they share a stop list, a headway and a fleet, which two branches do not.

A pattern's path is a list of sections, ordered along outbound travel, each holding legs — one leg
per way it runs over:

```ts
interface Pattern {
  id: string;
  sections: PatternSection[];
  name?: string;
}

type PatternSection =
  | { kind: 'shared'; legs: PatternLeg[] }
  | { kind: 'split'; outbound: PatternLeg[]; inbound: PatternLeg[] }
  | { kind: 'turnaround'; legs: PatternLeg[] };

interface PatternLeg {
  wayId: string;
  direction: 'withPoints' | 'againstPoints';
  extent: { kind: 'whole' } | { kind: 'stretch'; fromT: number; toT: number };
  lane: { kind: 'auto' } | { kind: 'pinned'; laneId: string };
}
```

Two axes meet here and confusing them is the mistake the naming exists to prevent. `direction` is
about a **way**: which end of that way's own stored point order the leg is entered at. A section's
kind is about a **line**: which of its two directions of service ride that stretch at all.

The outbound direction reads the sections in order, taking `legs` or `outbound`. The inbound
direction reads them in reverse, taking `legs` or `inbound`, reversed within each section and each
leg's travel direction flipped. A plain line is a single `shared` section, so its return trip is its
outward trip reversed — which is what every line was before v12.

`split` is a one-way couplet: the outward trip up one street, the return down another. `turnaround`
is ridden once, where the vehicle reverses — a loop round a block at a terminus, belonging to
neither direction.

Sections rather than a per-leg direction tag, because a tag in one flat array makes an inbound-only
leg's _position_ load-bearing: place it after a shared leg it should precede and the return path
reads discontinuous, with nothing in the type to say which spelling was meant. A couplet at the end
of a line survives either spelling; a couplet in the middle does not.

`extent` is where the leg joins and leaves its way, as normalized arc-length along that way's
resolved path — the same convention as `Station.anchor.t`, measured along the way rather than along
travel, so `direction` remains the only thing that says which way round. Extents are what let a
service cover part of a way. Before v10 a pattern named whole ways only, so a line that started or
stopped mid-block was made to fit by splitting the way underneath it — which mutated that way for
every other line riding it and left a permanent fragment behind.

`lane` pins which lane the leg rides; `auto` resolves the default at render time (see
`defaultLaneFor`), which is distinct from a pin that happens to name today's default — re-profiling
the street moves the first and leaves the second.

Consecutive legs must meet **within a direction**; `validateSystem` walks each direction separately
and reports a gap in either. A couplet's two halves are a street apart on purpose, so a single walk
across both would call every couplet broken.

Scheduling stays at the level of headways rather than timetables. These are what the simulation runs
on — see [The simulation](../explanation/simulation.md):

- Quick fields: `frequencyMinutes` (peak headway), `spanStart`/`spanEnd` (24-hour `"HH:MM"`).
- Optional detail: `schedule`, a list of `SchedulePeriod`s (`label`,
  `days: "daily" | "weekday" | "weekend"`, span, headway). When present it supersedes the quick
  fields.

## Station

| Field          | Meaning                                                                                                                                   |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `coord`        | Network-node position, snapped onto its way.                                                                                              |
| `anchor`       | `{wayId, t}` — normalized arc-length position along the way; how a station follows its way when the alignment is reshaped.                |
| `footprint`    | The station's land: a boundary polygon drawn in the Infrastructure view.                                                                  |
| `platforms`    | Platform polygons inside the station (`edges: 1` side, `2` island).                                                                       |
| `dwellSeconds` | How long a vehicle waits here. Counts toward the round trip, so it feeds fleet size — see [The simulation](../explanation/simulation.md). |
| `majorStop`    | Label this stop from a lower zoom, like an interchange.                                                                                   |

## Facility and Group

A `Facility` is a catalog-typed feature that isn't a way or station: its `geometry` is a single
point (entrance, elevator, bike dock) or a polygon (building, bus bay, platform, parking, depot), as
the facility type's `geometryKind` dictates.

A `Group` bundles any members into one unit. With a `footprint` polygon (and optionally a `color`),
it's a facility complex, a real physical site like a transfer center; without one it's a plain
logical grouping.
