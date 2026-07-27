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
- **Lane profiles from OSM tags.** `lanes`, `lanes:forward/backward`,
  `oneway`, and `turn:lanes` are not read; imported ways keep
  `defaultProfileFor(typeId)`. See "Deferred work."
- **Traffic control from OSM.** `highway=traffic_signals` and `highway=stop`
  live on OSM *nodes*, and this query returns ways only, so no `control` is
  set on derived junctions. They import as uncontrolled.
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

**Lane profiles from OSM tags.** `lanes` and `lanes:forward/backward` map
cleanly onto `defaultProfileFor(typeId, capacity)`, which already exists and
already clamps hostile input. `oneway` maps onto `makeOneWay`. `turn:lanes`
maps onto the existing `turnPocket` lane kind — but only where the tag is
present and its `|`-separated entry count matches the lane count, and in
practice turn lanes are tagged on short intersection-approach segments
rather than whole streets. Worth doing after junctions, and worth scoping to
`lanes`/`oneway` first.
