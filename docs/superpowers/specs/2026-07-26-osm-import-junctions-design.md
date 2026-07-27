# OSM import builds real junctions

## Context

OSM import ([packages/core/src/model/import.ts](../../../packages/core/src/model/import.ts))
fetches ways from the Overpass API and appends them to `system.ways`. It
creates no nodes. `importWays` in
[apps/web/src/editor/store.ts:1433](../../../apps/web/src/editor/store.ts)
is a one-line append:

```ts
importWays: (ways) =>
  set((s) => ({ system: touch({ ...s.system, ways: [...s.system.ways, ...ways] }) })),
```

So an imported street grid is a pile of disconnected line segments. Every
intersection in it is a visual coincidence, not a junction: nothing in
`system.nodes` says those ways meet. The lane graph
([routeGraph.ts](../../../packages/core/src/model/routeGraph.ts)) reads
`system.nodes`, so an imported network is not routable and not lane-connected
until a person manually runs `splitWayAt`/`mergeWays` across every crossing.
For a viewport of real streets that is hundreds of manual operations.

The obvious fix is coordinate snapping: find endpoints that are close enough
and weld them. This spec does not do that. OSM already stores exact
topology, Overpass already returns it, and the import throws it away — so
the fix is to stop discarding it rather than to reconstruct it by guessing.

### Overpass returns node identity, not just geometry

`out geom;` is `out body geom;`. The `body` verbosity includes a way's
`nodes` array — the OSM node IDs — and `geom` adds the resolved `geometry`
coordinates. Both arrays are returned, index-aligned. Verified against live
Overpass data for a 1 km box over West Flamingo Road, Las Vegas
(36.110,-115.180 to 36.120,-115.170):

- 149 ways returned, 149 with a `nodes` array
- `nodes.length === geometry.length` for every way
- 406 distinct node IDs, of which 117 are referenced by two or more ways
- up to 5 ways meeting at a single node

The current parser drops `nodes` on the floor and reads only `geometry`
([import.ts:94](../../../packages/core/src/model/import.ts)). Recovering it
is a parsing change, not a geometry algorithm.

## Goals

- An OSM import produces a connected network: ways that share an OSM node
  share a `Node` in `system.nodes`.
- Junction detection is exact: ways connect exactly where OSM says they do,
  with no coordinate rounding in the path.
- Ways that merely overlap without connecting — a tram line down a street,
  a cycleway beside a road — stay unconnected.
- The derivation is a pure function over the Overpass response, testable
  from fixtures without network access, matching how `classifyOsmWay` and
  `osmElementsToWays` are already tested.

## Non-goals

- **Connecting imported ways to ways already in the system.** An import that
  lands on top of hand-drawn work will not weld itself to that work. That
  problem genuinely needs coordinate snapping and would reuse the existing
  `snap()` / `joinWayPointToWay` infrastructure
  ([snapIndex.ts:57](../../../packages/core/src/model/geo/snapIndex.ts),
  [store.ts:614](../../../apps/web/src/editor/store.ts)). It is deferred; see
  "Deferred work."
- **Lane profiles from OSM tags.** Not part of the junction work — but built
  straight after it, once a real import showed every road arriving as the
  same four-lane two-way default. See "Follow-on: lane profiles."
- **Traffic control from OSM.** Not part of the junction work: this query
  returns ways only, so junctions import uncontrolled. Added afterwards, and
  the naive version of it turned out to do nothing at all — see "Follow-on:
  grade and traffic control."
- Turn restrictions, which OSM stores as relations. Not fetched at all.

## Architecture

### Where the node IDs enter the model

`OsmWayElement` gains an optional `nodes: number[]` field alongside the
existing `geometry`. It is optional because the field's absence must degrade
to today's behavior rather than throw: a fixture written before this change,
or a response from an Overpass mirror configured differently, should still
import ways — just without junctions.

### Deriving junctions

A new pure function in `import.ts`:

```ts
export interface ImportedNetwork {
  ways: Way[];
  nodes: Node[];
}

export function osmElementsToNetwork(elements: OsmWayElement[]): ImportedNetwork
```

(`ImportedNetwork` gained a third field, `namedWays`, in the follow-on
below. The reasoning for returning the pieces together is unchanged.)

It supersedes `osmElementsToWays` as the entry point, and works in two
phases:

1. **Collect.** While converting each element to a `Way` (unchanged logic),
   build `Map<number, WayPointRef[]>` keyed by OSM node ID. For element
   index `i`, `el.nodes[i]` is the OSM node at `el.geometry[i]`, which
   becomes `Way.points[i]` — so the ref is `{ wayId: way.id, pointIndex: i }`.
   The index alignment is what makes this work, and it is the one invariant
   worth asserting: an element whose `nodes.length !== geometry.length` is
   treated as having no `nodes` at all, contributing geometry but no refs.

2. **Emit.** For each OSM node ID with two or more refs, emit
   `Node { id: shortId(), coord, refs }`, where `coord` is the shared
   point's `LngLat`. IDs with a single ref are ordinary points along one
   way and produce nothing — a `Node` per vertex would be both wrong and
   enormous.

Refs from skipped elements never enter the map, since collection happens
only for elements that survived `classifyOsmWay`. A residential street
meeting an unimported footpath therefore yields a single-ref node ID and no
junction, which is correct.

One case looks like a violation of `Node`'s "shared by two or more ways" and
is not. A closed way — every roundabout and loop road — repeats its first
node ID last, so that ID collects two refs from a *single* way and emits a
junction of one way meeting itself. This is wanted: `routeGraph` keys
vertices through node identity, so sharing the node is what makes the loop
close in the graph rather than dead-ending, and it keeps the two ends moving
together when either is dragged. Pinned by test, since the obvious "fix" —
requiring two distinct way IDs — would silently break loop routing.

`osmElementsToWays` stays exported and keeps its signature, implemented as
`osmElementsToNetwork(elements).ways`. It has existing callers and tests;
nothing is gained by breaking them.

`importOsmWays` returns `ImportedNetwork` instead of `Way[]`. This is a
breaking change to one call site
([ImportDialog.tsx:62](../../../apps/web/src/ui/ImportDialog.tsx)) and is
worth it: a function that returns only half the imported data invites the
caller to forget the other half.

### Why node identity, and not coordinate matching

The codebase already contains a coordinate-matching junction builder:
`deriveNodesFromWays` ([serialize.ts:192](../../../packages/core/src/model/serialize.ts))
groups every way's control points by `coordKey` — a 6-decimal-place string,
roughly 0.11 m — and emits a `Node` wherever two or more refs land in the
same bucket. It exists for loading v3 documents that predate stored nodes.

The structure described above is deliberately the same: group refs by a key,
emit a `Node` where a key has two or more. Only the key differs — an OSM
node ID instead of a rounded coordinate.

It is worth being straight about how much that buys, because the obvious
argument for it is wrong. The tempting claim is that coordinate matching
would weld a bridge to the road beneath it. It would not: at a grade
separation neither OSM way has a control point at the crossing, so there is
no coordinate to coincide, and both approaches correctly produce nothing.

The real differences are narrower:

- **Distinct nodes that round together.** Two genuinely separate OSM nodes
  closer than ~0.11 m collapse into one junction under `coordKey`. This is
  rare but real in detailed urban mapping, and silent when it happens.
- **Co-located ways of different modes.** This import fetches several
  categories at once. A tram line drawn down the middle of a street shares
  coordinates with the roadway at points without sharing nodes, and a
  cycleway drawn along a road does the same. Coordinate matching welds them
  into junctions that do not exist; node identity does not. This is the case
  most likely to actually bite here, because importing `road` plus
  `lightRail` together is a normal thing to do in this app.
- **No dependence on serialization precision.** Overpass emits 7 decimal
  places and `coordKey` rounds to 6. That happens to be safe today. Node IDs
  do not rely on it being safe.

Neither approach needs a tolerance to be *tuned* — `coordKey`'s precision is
fixed, not a knob. The argument for node IDs is that they are exact and cost
the same, not that coordinate matching would be a disaster.

Reusing `deriveNodesFromWays` directly was considered and rejected: it is
module-private, it takes a whole-system way list rather than an import's,
and calling it would mean importing OSM data and then throwing away the
topology OSM handed us in favor of re-deriving a slightly worse version of
it.

### Store integration

`importWays` takes the network rather than a way array:

```ts
importWays: (network: ImportedNetwork) => void;
```

and appends both collections:

```ts
importWays: ({ ways, nodes }) =>
  set((s) => ({
    system: touch({
      ...s.system,
      ways: [...s.system.ways, ...ways],
      nodes: [...s.system.nodes, ...nodes],
    }),
  })),
```

Appending is safe without renumbering because every id is a fresh
`shortId()` and every ref points at a way created in the same import. No
existing node's `refs` are touched, so the `shiftNodeRefsFor*` invariants
that the rest of the store maintains
([store.ts:565](../../../apps/web/src/editor/store.ts)) are not disturbed.

The doc comment on `importWays` ([store.ts:235](../../../apps/web/src/editor/store.ts))
needs updating: it currently contrasts itself with `importGtfs` on the
grounds that it appends bare ways. It still creates no services or stations,
which is the real distinction, but it is no longer ways-only.

## Testing

`osmElementsToNetwork` is pure, so it is fixture-tested like its neighbors:

- Two ways sharing one node ID mid-path produce one `Node` with two refs at
  the right `pointIndex` on each.
- A node ID shared by five ways produces one `Node` with five refs, not four
  pairwise nodes.
- Ways with no shared IDs produce zero nodes.
- Two ways with an identical coordinate but different node IDs produce zero
  nodes — the co-located-modes case (tram on street), and the one that would
  regress if someone later "helpfully" adds coordinate matching.
- An element missing `nodes` imports its way and contributes no refs.
- An element whose `nodes.length !== geometry.length` does the same.
- A node shared between an imported way and a skipped (unclassified)
  element produces no junction.

The Flamingo Road response captured while writing this spec is a reasonable
basis for one realistic fixture, trimmed to a handful of ways.

### Measured against live data

Running the implemented pipeline against the same Overpass box
(36.110,-115.180 to 36.120,-115.170), streets plus light rail:

| | result |
|---|---|
| ways imported | 149 |
| junctions built | 117 |
| widest junction | 5 arms |
| dangling or out-of-range refs | none |
| junctions whose coord disagrees with a ref's point | none |
| connected components, before | 149 |
| connected components, after | 2 |

The component count is the metric that matters, and it is the one to use if
this is ever measured again. The unjoined-crossing count is not: it was 4
both before and after, because OSM splits ways at intersections, so ways
meet end-to-end rather than geometrically crossing, and the crossing
validator never flagged those meetings either way.

All four residual crossings are the same real grade separation — West
Flamingo Road (`bridge=yes`, `layer=2`) passing over Frank Sinatra Drive —
which must stay unjoined. The two remaining components are the network and
a fragment whose continuation lies outside the imported box.

## Deferred work

Both were considered for this change and cut deliberately.

**Snapping imports onto existing ways.** Needed when a person imports over
work already drawn. It is a different mechanism — `snap()` against the
current system, then `joinWayPointToWay` per match — with its own tolerance
question, and it does not block the blank-slate import case that this spec
makes correct.

**Lane profiles from OSM tags.** ~~Deferred.~~ Built immediately after this
change — see "Follow-on: lane profiles" below.

## Follow-on: lane profiles from OSM tags

Junctions alone were not enough to make an import look like a real street.
Every road still arrived as `defaultProfileFor("road")` — four lanes, two-way,
sidewalks both sides — because the catalog's road type has one
`defaultProfile` shared by all four classes and `defaultProfileFor` takes no
class. On the Strip, where nearly every arterial is a pair of one-way
carriageways, that drew two four-lane two-way streets with a centre line
each where there should have been two one-way carriageways.

### What is read

`profileFromOsmTags(typeId, classId, tags)` in `import.ts` replaces the flat
default for roads only — `lanes` and `turn:lanes` are road vocabulary, and
rail and bike ways are already right with a single bidirectional lane.

| tag | effect |
|---|---|
| `oneway=yes\|true\|1` | every lane runs forward |
| `oneway=-1\|reverse` | every lane runs backward |
| `lanes` | total travel lanes, centre turn lane included |
| `lanes:forward` / `lanes:backward` | the split; one side implies the other from `lanes` |
| `lanes:both_ways` | a shared centre `turnPocket` |
| `turn:lanes` (+`:forward`/`:backward`) | turn-only lanes become `turnPocket` |
| `sidewalk`, `sidewalk:left`, `sidewalk:right` | which edges keep a sidewalk |

Where OSM says nothing, the class supplies a total (`ROAD_LANES_BY_CLASS`:
transitway and arterial 4, collector and local 2), halved for a one-way way
on the reasoning that it is one carriageway of a street that wide.

### Decisions worth keeping

- **A lane that can still go straight is not a pocket.** `through;right`
  stays a travel lane; `turnPocket` means a lane you cannot continue from.
  `merge_to_left`/`merge_to_right` are travel lanes too.
- **A mismatched `turn:lanes` is ignored, not truncated.** Padding or
  truncating would silently put a pocket in the wrong lane, and in real data
  a mismatch usually means the tag describes a different segment.
- **`turn:lanes:backward` maps on reversed.** Lanes are stored left-to-right
  facing forward, but OSM lists turns left-to-right as the *driver* sees
  them, so for backward lanes the two orders are opposites.
- **`sidewalk=separate` drops the sidewalk.** It means OSM maps the footway
  as its own way; drawing one here as well would double it.
- **Untrusted counts are clamped** to `MAX_PRIMARY_LANES` before any array is
  allocated, since `lanes` is user-entered free text and reaches us straight
  from `JSON.parse`. The clamp is on the **total**, not per tag: clamping
  each tag alone still let `lanes:forward=999` plus `lanes:backward=999`
  allocate 64 lanes, which is the ceiling's whole purpose defeated. An
  over-large split is scaled proportionally rather than truncated on one
  side, so 30/10 becomes 24/8 rather than 32/0.

`profileWithPrimaryLanes(typeId, primary, edges)` was extracted in
`profile.ts` to hold the "wrap a block of travel lanes in the type's edge
lanes" logic that `defaultProfileFor` already had inline; both use it now.

### Measured, same viewport

44 roads imported around Flamingo and Las Vegas Boulevard: 40 one-way and 4
two-way (was 44 two-way), 15 carrying turn pockets (was 0), travel-lane
counts spread 1–5 (was 44 ways at exactly 4), and 34 with no sidewalk where
OSM maps the footway separately (was 44 with two each).

### Still not read

Bus lanes (`busway`, `lanes:bus`), on-street parking (`parking:lane:*`),
cycleways tagged as a modifier on the roadway rather than their own way
(`cycleway:right=lane`), and `width`. Lane order assumes right-hand traffic,
matching `defaultProfileFor`; a left-hand-traffic import comes in mirrored.

## Follow-on: street names → NamedWay

OSM splits a street into a way per block and per direction, all carrying the
same `name` — exactly the identity `NamedWay` exists to hold, and unused by
the import until now. Ways are grouped by name *and* way type, since a street
and the tram line along it often share a name in OSM without being one
facility. A name matching a single way gets no NamedWay; the identity would
add nothing over the way itself.

Creating the records was not enough to show them. `LinesPanel` labelled every
row `${type.label} ${i + 1}` with no reference to `namedWays`, so the objects
list still read "Road 1 … Road 439" after the import was already producing 12
identities. The label now prefers the identity's name, numbering segments
within a street — a dozen rows all reading "West Flamingo Road" is no more
navigable than the ordinals were. `WayInspector` and `NodeInspector` already
consumed `namedWays`, so those needed nothing.

## Follow-on: grade and traffic control

### Grade, and the crossing check that ignored it

`bridge`/`tunnel` are the explicit signals and `layer` the fallback, mapping
onto the existing `Grade`. Everything imported at `atGrade` before this.

The more valuable half was a pre-existing defect this exposed:
`findCrossingsWithoutJoining` never read `Way.grade`, so **any** elevated way
over a surface street — hand-drawn or imported — was reported as needing a
junction the user could not correctly create. `CrossSegment` now carries
`grade` and pairs at different grades are skipped.

### Traffic control, and why the obvious mapping did nothing

`NodeControl` already had `signal`/`stop`/`roundabout`, and OSM tags all
three. The first implementation matched control nodes to junctions by node
id — and applied **zero** controls to real data.

Measured over the same viewport: of 37 control nodes, **none** sat on a
shared junction node. OSM puts `highway=traffic_signals` on the approach way
at the stop line, a median of 15 m short of the junction (p90 55 m), so the
node has one ref, is never a junction, and the mapping silently no-ops.

Control nodes are now walked along their own way to the nearest junction
within `CONTROL_STOPLINE_METERS` (40 m — claims 25 of 28 while excluding a
229 m outlier). The walk follows the way rather than taking the nearest
junction by straight-line distance, which matters precisely here: the two
carriageways of a boulevard sit 15–20 m apart, the same order as the stop-line
distance, so a straight-line match would routinely signalize the junction on
the opposite carriageway. Claims are ranked (signal > stop > roundabout) so a
junction with any signalized approach is signalized.

Roundabouts come from the way tag `junction=roundabout`, not a node tag, and
apply to the junctions along the circulatory way.

## Follow-on: Overpass endpoint fallback

Overpass returned 504 repeatedly during this work, surfacing as "import
failed". The import now tries a second public server before giving up.

Two things learned the hard way. A mirror that answers `curl` is useless if
it omits CORS headers — `overpass.osm.jp` was in the list until a browser
check showed it failing preflight, and both remaining endpoints were verified
from a browser rather than a terminal. And Overpass's *error* responses often
drop the CORS headers its successful ones carry, so an overloaded server
reaches the app as a thrown `TypeError` with no status: the retry loop treats
a thrown fetch as "try the next mirror", and the failure message says only
that no server answered rather than claiming the network is down.

### Measured end to end

139 ways over the same viewport: 13 named identities covering most of them,
111 junctions of which 20 signals and 2 stops, 1 elevated way and 1
underground, and 0 unjoined crossings — down from 4, all of which were the
same bridge now correctly imported as elevated.

### Still not read

Bus lanes (`busway`, `lanes:bus`), on-street parking (`parking:lane:*`),
cycleways tagged as a modifier on the roadway rather than their own way
(`cycleway:right=lane`), `width`, and `maxspeed` (which has no field in the
model at all). Per-approach control is not carried: `highway=stop` sets the
whole junction. Turn restriction relations are not fetched.

## Follow-on: left-hand traffic

`profileFromOsmTags` built every cross-section right-hand-traffic first and
stopped there, so a system set to left-hand traffic imported streets mirrored
— forward traffic on the wrong side of every road. The system already had a
`drivingSide`; the import simply never asked for it.

It is threaded from `ImportDialog` through `importOsmWays` and
`osmElementsToNetwork` into `profileFromOsmTags`, which mirrors the finished
profile by reversing its left-to-right order and leaving each lane's
direction alone. That is the same cross-section seen from the other side, and
it carries the asymmetric parts — a turn pocket, a sidewalk on one side only
— to the correct side without special cases.

Changing the setting later does not re-mirror ways already imported; that
would be a bulk mutation of the user's existing work, not a setting change.
