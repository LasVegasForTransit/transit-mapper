# Dragging a branch terminus onto another corridor

> **Status.** Historical design note. The current branch-specific behavior and vocabulary are
> normative in [Editor interactions](../../product/reference/editor-interactions.md). The first
> implementation's simple-`Pattern` restriction described below was superseded by dedicated termini
> for both ends of every branch.

For whoever next touches service-path drafting, the terminus handles, or `routeGraph.ts`. When you
finish this you should know why the drag reuses `routeBetween` directly instead of the click-based
`routeDraft` state, and why a failed drag leaves the branch untouched rather than extending partway.

## The problem

A branch's termini were only editable by re-drawing: pick the Line tool, click along the corridor
you want to add, commit. There was no way to grab the visible end of an existing line and pull it
further. The map had handles for a corridor endpoint (`startHandleDrag`/`startExtendDrag` in
`interactions.ts`, which reshape or grow the physical corridor) but none for a service terminus,
which is a different thing: where one branch's service path stops.

This surfaced alongside a rendering bug (bundled service lines visibly separating at a bend, fixed
separately in `mergeServiceLines.ts`) because the same instinct — "grab the end of this line and
connect it to that one" — has no home in the editor at all. Nothing previews what a drag like that
would do, because nothing does anything.

## The decision

A new draggable handle at each simple branch's start and end, derived from its `Pattern`. Dragging
it runs the same pathfinder route drawing already uses (`routeBetween` in `model/routeGraph.ts`)
from the branch's current terminus to the cursor, live, on every frame; dropping it extends the
branch's service path to cover whatever path was found. The service's identity, color, and schedule
are untouched.

**Stateless per-frame query, not the click-based draft.** `startRouteDraft`/
`extendRouteDraft`/`commitRouteDraft` exist for building a route up over several clicks,
accumulating spans in `routeDraft` between commits. A drag has no intermediate commits — one
gesture, one query. So `onMove` resolves the cursor the same way `startDraw` resolves a click —
`snap(candidateWays, cursorCoord, snapMeters(SNAP_PX))` filtered to the service's own mode's way
types, then `anchorOnWay` on whatever it lands on — and, only when that snap succeeds, calls
`routeBetween(system, fixedAnchor, cursorAnchor, { allowedTypeIds, travel: 'legal' })` fresh every
frame (discarding the previous frame's attempt, the same shape as `startExtendDrag`'s
`previewEnd`/`resolveEnd`). `onUp` converts whatever the last frame found into legs. `routeDraft`
state is not touched and gains no new fields.

**Reuses the three preview layers drawing already has**, so this reads as the same affordance a
person already knows from drawing a line onto existing infrastructure, not a new one to learn:

- `SRC_PREVIEW` — the rubber-band line from the terminus to the resolved point.
- `SRC_SHARING` — the corridor it will ride, highlighted, exactly like the in-progress draw stroke
  previews what it will conflate onto.
- `SRC_ENDPOINT_HINT` — the existing "connects here" ring, at the resolved point.

All three clear the instant a frame finds no legal path — the absence of the ring/highlight/preview
line IS the "this will not connect" signal. Nothing new to build for the "this won't work" case.

**A failed drop leaves the branch exactly as it was.** The real `Pattern` data is never touched
during the drag — only the preview sources are — so "snap back" costs nothing to implement: `onUp`
either commits (a hint was showing) or does nothing (it wasn't). No revert path to write, no partial
extension to reconcile.

**One new store action**, mirroring `attachReturnPath`'s shape without its split/rejoin logic (there
is no rejoin to find — this only ever grows the route past its own current end):

```ts
extendPatternEnd(
  serviceId: string,
  patternId: string,
  side: 'start' | 'end',
  spans: RouteSpan[],
): boolean
```

Anchors the query on the pattern's OWN last (or first) leg's way — not whichever way happens to be
nearest the terminus coordinate, the same reason `startReturnPathDraft` does this: at a junction
those differ, and anchoring on the wrong one turns the first hop into a seam the router then has to
re-cross. `materializeRouteSpans` turns the result into legs exactly as it does for a freshly-drawn
line (nothing is spliced into the way, nothing is split — nothing here is a mutation to the street
network, only to the pattern's own leg list). For `side: 'end'` the query runs
`routeBetween(system, currentEndAnchor, dropAnchor, …)` and the resulting legs are appended; for
`side: 'start'` the anchors are swapped (`routeBetween(system, dropAnchor, currentStartAnchor, …)`)
so the new legs already read in the direction that leads into the existing route, and are prepended.

**`travel: 'legal'`, not `'preferLegal'`.** Drawing a fresh line is lenient — it would rather show
you a wrong-way stretch than refuse the gesture outright, because a bare refusal there is
indistinguishable from a missed click. This drag has a cleaner "nothing happened" signal available
(no ring, no preview), so it can afford to be strict: if the only path to the drop point runs a
one-way street backwards, that is treated the same as no path at all.

## Scope for this pass

**Network view only.** Route-drawing-by-snapping-to-streets is already gated to Network view
(`isNetworkMode()` in `startDraw`); Infrastructure view is for editing the physical street itself,
where dragging an endpoint already means something else (`startHandleDrag`/`startExtendDrag`). The
terminus handle simply isn't rendered in Infrastructure view.

**The first pass limited handles to patterns with a single `shared` section**
(`!patternHasSplit(pattern)`). A couplet's outward and return trips meet at a turnaround or diverge
into a split; growing "the end" of a pattern like that means picking which leg of a fork to extend,
and there's no single terminus coordinate to anchor the drag preview on in the first place.
Extending a couplet's own branches is a real feature, just not this one — it needs its own design
once there's a concrete case to build it against, rather than guessing at the interaction now.

**Both ends of every branch**, not just the service's outermost stops — a branched service (several
`Pattern` records) gets a handle at each branch's own start and end, consistent with how the model
treats a branch as a first-class service path with its own extent.

## What was rejected

**Through-routing into the other line** (combining both services end-to-end into one,
`throughRouteInto`'s existing job) — rejected because it changes which service exists, not just what
it covers. The ask here is narrower: keep riding the SAME line, just further. Interlining two
existing services from a drag is a real gesture too, but a different one, triggered differently (it
needs both services already terminating at the same point, not a drag toward an arbitrary corridor)
— worth its own design if it comes up.

**Reusing `routeDraft`/`returnFor`** — the click-based draft exists to accumulate several distinct
clicked anchors into one committed route, refusing a way it's already used along the way. None of
that machinery does anything useful for a single continuous drag with exactly one start and one end;
adding a `side: 'start' | 'end'` variant to `returnFor` would grow a state shape built for a
different gesture instead of writing the much shorter stateless version.

**Wrong-way leniency on the drop**, matching what drawing does — rejected. Drawing marks a wrong-way
stretch because refusing outright is worse than showing the person what's wrong with the click they
just made. A drag that simply doesn't connect (no ring, no preview, snaps back) is already a clear
enough signal; extending a real, saved pattern onto a street it runs the wrong way down by default
would be a worse default than asking the person to notice and fix the street's direction (or draw
the wrong-way stretch deliberately) themselves.

## Testing

`packages/core`: `extendPatternEnd`-equivalent leg arithmetic is exercised the way
`patternEdits.ts`'s splitWay/mergeWays/removeWay rescaling already is — direct unit tests over legs,
no map involved. Cases: extends past a whole last leg onto a new way; extends further along the SAME
way when the current end is a partial stretch; refuses (returns false, pattern unchanged) when no
legal path reaches the drop anchor; refuses across a mode-incompatible way; `side: 'start'` prepends
in the correct running direction, verified against `patternRunPath`.

`apps/web`: the interaction itself (handle rendering gated to Network view and `!patternHasSplit`,
drag preview appearing/clearing, commit on drop) is UI behavior with no browser-free test path today
— verified by hand in the running app, per this repo's existing rule that anything checkable without
a browser belongs in `packages/core`.
