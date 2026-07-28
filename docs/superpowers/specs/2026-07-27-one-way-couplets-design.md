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

## What was closed afterwards, and how

**Turn restrictions.** The deferral said vertex identity had to become
`(arrivingWayId, nodeId)`. That was right, but the expansion belongs in the
SEARCH rather than in the construction: Dijkstra's state is now the pair, and
`buildGraph` stays a description of the network instead of a description of the
ways through it. The chicken-and-egg — restrictions are per-lane, and a route
has not picked a lane — is resolved by asking whether ANY lane of the arriving
way permits the movement. That is the safe direction: over-refusing sends a
line the long way round a junction it is allowed to cross.

Two things fell out of it that were not visible beforehand. A zero-length hop
laundered a forbidden turn — enter on A, "use" B for no distance, leave on C,
and the A→C rule is never consulted — so a hop covering no ground no longer
changes which way the route is on. And span merging collapsed an out-and-back
on one street into a span from a point to itself, which is exactly what a legal
U-turn round a forbidden turn looks like; merging now requires the two spans to
run the same direction.

A blocked turn is a detour, not a refusal. The router goes straight on, turns
round, and comes back on a street that may turn — because the two points are
still connected, just not by that turn.

**Splitting a couplet.** Cutting a line in two is trimming it twice from
opposite ends, and trimming was already couplet-aware, so it is now literally
that. Both halves come out couplets.

**Stops shared between directions.** Rather than `Station.anchors[]`, the stop
derivation admits a station on the other direction's way when this direction
passes within 150 m — a platform pair or a transit center, and deliberately far
short of a block, since a stop a block away on the return street is a different
stop this direction genuinely drives past.

**The GTFS pairing threshold.** No longer a constant. It scales with the
shorter shape's own length, floored at a platform pair and capped at a long
block, and the two terminals are judged separately so a good end cannot pay for
a bad one.

## The follow-ups, and what they turned out to be

**Wrong-way feedback was a promise nothing kept — twice.** The router marked
spans `wrongWay` and nothing read the flag, so a draft that had to route
against traffic showed the planner a line and told them nothing. And the
durable check the routing commit named as the half to build first was not
built at all: nothing re-routes an existing line, so a street made one-way
UNDERNEATH one left it running the wrong way with the draft flag long gone.
Both exist now, the second recomputed from the profile every time so it
appears and clears itself as the street changes.

**Per-direction stop lists were delivered in part.** The couplet case works
for free and a shared platform works by proximity; the case that needed new
data — a stop on a stretch both directions ride, called at one way and passed
the other — needed `Pattern.skippedStops`. A denylist, not a served-list,
because stops are derived and a served-list goes stale by LOSING stops.

**`turnaround` was unreachable, and the reason was a bug.** No gesture built
one because `attachReturnPath` refused exactly the case it describes: a return
path rejoining at the far terminus leaves nothing diverged, which was read as
failure. It is a loop round the block, ridden once, and it now produces the
section it always should have.

That surfaced `patternHasSplit` doing double duty. It means "the two directions
cover different ground", which a turnaround satisfies — right for the geometry,
simulation and validation, wrong for telling a person their line "runs two
one-way paths". `patternHasCouplet` is the narrow question the UI asks.

## What is still open

`Station.anchors: StationAnchor[]` remains the real answer for a platform that
genuinely belongs to two ways; the 150 m proximity rule above stands in for it.

Turn restrictions are honoured for ROUTING but not for the lane a service ends
up pinned to, so a route may take a turn its eventual lane could not.
