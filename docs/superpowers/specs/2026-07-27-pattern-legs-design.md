# Pattern legs: a service that covers part of a way

**Status:** Built · **Date:** 2026-07-27 · **Schema:** v10

## Problem

Three complaints, one cause.

1. Two lines running down the same corridor read as two separate corridors.
2. There was no way to remove part of a line — only to delete the whole thing.
3. A service always covered the entire way it was created on, so a line could
   not run over a subset of a corridor.

A `Pattern` held a bare list of way ids, so a service covered whole ways and
nothing else. Anything else was made to fit by **splitting the way underneath
it**, and `materializeRouteSpans` did exactly that whenever a route ended
mid-block.

That split was never local. `splitWay` extends every other rider's pattern,
reanchors every station on the way with two full `nearestOnPath` scans,
reindexes every node ref, and leaves a fragment behind permanently. A corridor
carrying several lines accumulated one fragment per line that terminated on
it. Drawing a line that stopped in the middle of a boulevard divided the
boulevard, for everyone, from then on.

## The model

`Pattern.wayIds` and `Pattern.lanes` become one list of legs:

```ts
export interface PatternLeg {
  wayId: string;
  forward: boolean;
  fromT?: number;
  toT?: number;
  laneId?: string;
}
```

`fromT`/`toT` are normalized arc-length along the way's own resolved path —
the same convention as `Station.anchor.t`, measured along the **way** rather
than along travel, and always stored low-to-high. `forward` is the only thing
that says which direction. Both extents are omitted when the leg covers the
whole way, which is the common case.

### Why legs rather than a trim on the first and last way

Two numbers on the pattern would have been a much smaller change, and it does
not work. `materializeShapeRun` already produces runs that join and leave one
way mid-block with more way on both sides, and `joinWayPointToWay` creates a
`Node` at an interior control point without splitting. Interior legs can be
partial, so a first-and-last-only extent cannot express what the system
already generates.

### Why legs rather than arrays beside `wayIds`

`splitWay`, `mergeWays`, and `removeWay` each reindex the id list and nothing
else. Anything index-aligned with it would desync the first time one of them
was edited, silently. A leg carries its own direction and lane, so there is
nothing to keep aligned.

### Why direction is stored

It used to be derived, in four places, which disagreed. Geometry cannot always
determine it: a single-way pattern and a neighbour sharing both endpoints are
genuinely ambiguous. Guessing wrong used to mean the wrong lane, which is
cosmetic. With extents it means the wrong half of the way, which is not.

`deriveLegDirections` keeps the geometric derivation for the two callers that
only have geometry — the v9 migration, and route materialization.

### What legs cost

A leg list can describe a route with a hole in it, which a way-id list could
not. `validateSystem` checks that consecutive legs meet. This is strictly more
checking than existed before: nothing previously verified that consecutive
ways actually touched.

## Consequences

**Routing stops splitting.** `materializeRouteSpans` is now pure — it returns
legs and touches nothing. Interior span boundaries need no extent at all,
because `routeBetween`'s graph only has vertices at way endpoints and
junction-referenced points, so consecutive spans already meet at a shared
coordinate. Only the route's own two ends can land mid-way.

**Rendering draws where a line runs.** A service emits one feature per stretch
of a way it covers, not one per way it touches. Ranges are merged first: two
branches overlapping on a shared trunk are one line on the ground.

**Riding a way stops meaning reaching every point on it.** A stop past a line's
terminus no longer takes that line's colour, counts toward its interchange
badge, or stacks a phantom dwell in the vehicle animation.

**Editing in pieces becomes possible.** Trimming a line, cutting one in two,
and taking a stretch of road out from under one are all the same operation on
a leg's range — see `model/patternEdits.ts`.

## Sharing what is already there

Drawing adopted an existing corridor only when the very first press landed on
it. On commit, every stretch of a finished line that runs along compatible
infrastructure is now rebound onto it.

The matcher already existed: `detectShapeRuns` was built to collapse
co-aligned GTFS shapes on import. Drawing a line down a street and collapsing
ten imported routes onto one boulevard are the same operation, so both go
through one `conflatePatternOntoExisting`.

Three things this needed:

- **Subdivision before matching.** `matchOneSegment` requires both ends of a
  segment within tolerance, which is fair for a GTFS shape carrying a point
  every few metres and useless for a hand-drawn way that is two points a
  kilometre apart. Geometry minted from a subdivided path is straightened back
  to the corners actually drawn.
- **Fusing only onto established corridors.** Longest-first ordering does not
  on its own stop a trunk being rebound onto a shuttle lying along part of it.
  What makes a trunk canonical is that when its turn comes there is nothing yet
  to join.
- **Closing the seam.** A line stepping between its own alignment and a shared
  one leaves a gap, because those alignments are metres apart — which is why
  they were different ways. Only geometry the same pass created is moved.

How close counts as "along" is a fact about the mode, so it lives in the
catalog as `Mode.corridorToleranceM`. A train is on the track or it is not
(6 m); a bus is somewhere in a carriageway that is itself road-width (the 20 m
default).

`Alt` opts out, for the express track beside the local one. It is armed by the
press that starts a line and survives to the commit that reads it.

## Rejected

**Auto-minting a `NamedWay` for every drawn way.** The plan called for it, on
the premise that junction splits fragment corridors and a shared identity would
hold them together. Removing service-driven splitting and sharing corridors on
commit took most of that fragmentation away, and an identity with an empty name
is clutter: it shows in the object list and triggers "shared by N segments" on
a way nobody named. Naming stays something a person does.

The empty-name rendering was fixed regardless, since `separateCarriageways`
already mints unnamed identities and those rows read as `" 1"`, `" 2"`.

## Still open

The in-progress stroke does not show which corridor it is about to join, so
committing moves the line onto the street with no warning. The preview should
say what the commit will do.
