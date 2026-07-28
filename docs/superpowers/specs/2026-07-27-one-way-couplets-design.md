# One-way couplets: a line whose two directions run different streets

For whoever next changes `Pattern`, the router, or the motion kernel. When you
finish this you should know why a pattern's path is a list of sections rather
than a list of legs, and which alternative was rejected and on what evidence.

This reverses two things the docs stated as settled: that routing treats ways
as bidirectional, and that a pattern is an ordered list of legs.

## The problem

A transit planner needs a downtown couplet — the outward trip up 4th, the
return down 3rd. Nothing in the model could express it. A `Pattern` was one
ordered list of legs, which can only describe a line that comes back the way it
went out, and sibling patterns mean _branches_ ("via Airport"), not directions.

Four layers assumed the same thing. The router pushed both edges for every
segment and never read a way's profile. The simulation computed
`roundTripMs = 2 × oneWayMs` and produced a returning vehicle's position by
walking the outward path backwards. GTFS import turned a route's two shapes
into two branches. And nothing in the UI could create a direction at all.

## The decision

A pattern's path is an ordered list of typed sections.

```ts
type PatternSection =
  | { kind: 'shared'; legs: PatternLeg[] }
  | { kind: 'split'; outbound: PatternLeg[]; inbound: PatternLeg[] }
  | { kind: 'turnaround'; legs: PatternLeg[] };
```

Outbound reads them in order; inbound reads them in reverse, flipping each leg.
A plain line is one `shared` section, which is byte-for-byte what every pattern
was before.

`PatternLeg` lost its optionals at the same time: `forward: boolean` became
`direction: 'withPoints' | 'againstPoints'`, the `fromT?`/`toT?` pair became a
tagged `extent`, and `laneId?` became a tagged `lane`.

## What was rejected, and why

**A per-leg direction tag** — keep one flat leg array, add
`run?: 'outbound' | 'inbound'`, absent meaning both. This is genuinely cheaper
and was argued for in detail during design. Because the array is ordered along
outbound travel, `splitLegs` and `removeStretchFromLegs` need no change at all,
`truncateLegs`' array-slice half is already correct for both directions, and
`mergeLegs` needs one line.

It loses on one case. An inbound-only leg's position relative to the _shared_
legs is load-bearing. Given a trunk `T1`, a couplet `A`/`B`, and a trunk `T2`:

- `[T1, A(out), B(in), T2]` reverse-reads as `T2, B, T1` — correct.
- `[T1, A(out), T2, B(in)]` reverse-reads as `B, T2, T1` — discontinuous.

Same legs, same tags, both spellings legal, and only a validator can tell them
apart. A couplet at the **end** of a line survives either spelling, which is
what makes the scheme look sound; a couplet in the **middle** does not. Under
sections the broken spelling is not constructible, because `B` lives inside the
section that sits between `T1` and `T2`.
`packages/core/src/model/patternRuns.test.ts` pins the middle case.

The counter-argument that the leg arithmetic would need rewriting turned out to
be wrong, and it is worth knowing why: splitting a way, merging two, and
removing a stretch are facts about the **infrastructure**. They apply wherever
a leg names the affected way, and a couplet's two halves are affected
independently and identically. `mapSectionLegs` is the whole adaptation.

**Two linked services.** Riders name one line. It also doubles every
service-level edit and needs a pairing relation nothing else in the model has.

## Consequences that were not obvious

`validate.ts` had to change in the same commit as the model. It walked a
pattern's legs in array order asking whether consecutive ones meet, and a
couplet boundary is two streets a block apart — so every line using the feature
would have shipped with a permanent "gap in its route" flag. It now walks each
direction separately, and an unsplit pattern keeps the exact issue ids it had
before, because those are React keys and selection targets in `IssuesPopover`.

`{ ...p, legs: X }` still compiles against a `Pattern` that has no `legs` field,
because a spread skips excess-property checking. Five of those existed and each
silently left `sections` stale. The compiler could not catch them; `verify.ts`
did, nineteen failures at once. That is the enforcement model working as
designed, and it is the reason to keep adding to that suite rather than trusting
types alone here.

`metersAtElapsed` lost its `totalMeters` argument. Folding it into the
`Timetable` is the point: there is no longer a way for a caller to walk one
direction's clock against the other's ruler.

The viewport cull in `vehicles.ts` covered only the outbound path. A lane
offset stays inside the half-viewport margin; a couplet's return street, a
block away, does not, so it would have culled return vehicles while they were
still on screen.

Three things blocked the drawing gesture from reaching the end, each of which
would have read as "the feature doesn't work": the draft refused any seam
between two fractional spans, which is all a two-point street produces;
`materializeRouteSpans` failed the whole route over a zero-length span, which
appears whenever a route starts on a way's endpoint; and the draft anchored on
whatever way sat nearest the terminus, which at a junction is often a
cross-street.

## What is still open

Turn restrictions are ignored. Honoring them needs vertex identity to become
`(arrivingWayId, nodeId)` — an edge-expanded graph — which is a bigger change
than one-way routing and deliberately did not ride along.

`SHAPE_PAIR_TERMINAL_M`, the distance within which two GTFS shapes count as
facing each other, is 400 m and is a guess. Nobody has measured it against RTC
Southern Nevada's real feed.

A stop shared between directions by `stop_id` — a transit center, a rail
platform — anchors only to the outward way on import, so the return trip finds
no dwell there. The real fix is `Station.anchors: StationAnchor[]`, a schema
change worth making only once something needs it.

Splitting a line in two (`splitServiceAt`) still works on the flattened leg
list. Trimming was made per-direction; splitting was not, because the second
half would need its own sections rebuilt rather than merely truncated.
