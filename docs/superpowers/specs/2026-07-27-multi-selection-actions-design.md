# Relationship-aware actions on a multi-selection

## Context

Selecting two lines that cross and asking the app to merge them is not possible today, and three
separate gaps stand in the way.

**Selection contradicts itself.** Plain-clicking a service line selects the service
(`interactions.ts`, the `SERVICE_LAYERS` branch of `onClick`), but shift-clicking the same pixel
selects the way underneath it (the `oe.shiftKey` branch of the select tool's mousedown).
Shift-clicking two visible transit lines therefore produces two ways. `MultiSelectItem` is
`way | station | facility`, so it could not hold a service even if the hit test resolved one.

**There is no context menu.** Right-click pans on drag, branches a one-way segment off an endpoint,
finishes a live draw, and otherwise calls `select(null)`. The `contextmenu` event is only ever
`preventDefault`ed.

**Merges are scattered and unconditional.** Three merge operations exist and mean different things:
`mergeWays` joins two ways end-to-end at a shared two-way node, `mergeWaysIntoCorridor` fuses ways
that run alongside each other, and `mergeServiceInto` makes one line's patterns into branches of
another. The first is reachable only from a single selected way's inspector, the third only from a
dropdown buried in `ServiceInspector`, and the second is offered whenever two or more ways are
selected whether or not it can do anything — when it absorbs nothing it reports that with
`window.alert`.

Meanwhile two ways drawn across each other are connected only if something called
`formCrossingJunctions`, which runs on `finishWay` and on endpoint drag-release. Ways that cross for
any other reason stay as disconnected as an overpass, and nothing in the interface says so or offers
to fix it.

The reader of this document is whoever implements it. When you finish, you should know which module
owns each decision and which existing function each action calls.

## Decisions

Every item here was confirmed in brainstorming.

- Actions are chosen by the **kinds selected and the geometric relationship between them**, not by a
  fixed menu. Two ways offer way merges, two services offer line merges.
- **Actions that do not apply are hidden**, in both surfaces. Every action therefore needs an
  availability predicate, including corridor merge.
- The same list appears in a **right-click menu at the cursor** and in the **inspector**, computed
  once. Neither surface knows how any operation works.
- The menu appears for **one selected object as well as several**. Property editing stays in the
  inspector; only actions move.
- Two ways that cross mid-span at the same grade offer **connect at crossing**, which splits both
  and gives them a shared node so a real junction forms.
- Two services offer **join into a through-route** when their termini meet and **merge into one
  line** when they overlap or cross.
- Services become multi-selectable from the **map, the Lines panel, and a drag-select**.
- Drag-selecting lines belongs to a **new bottom-toolbar tool shown only in Network view**, rather
  than to a rule that reinterprets the existing marquee based on the current view.

## Selection model

`MultiSelectItem` gains `'service'`, and the type itself moves down into core as `SelectionRef`,
with the store aliasing it so no call site changes. It has to move: the action module below takes a
selection as input, and core cannot import a type from `apps/web`. Three entry points fill it.

Shift-clicking on the map resolves a hit the same way a plain click does: a service line adds the
service, and a bare way or a control handle adds the way. This removes the contradiction described
above. The Select tool keeps everything else it does today, including plain-clicking a line to
select the service.

The Lines panel follows list convention rather than map convention: ctrl/cmd-click toggles one line
and shift-click extends a range. Shift toggles on the map and extends in the list, which reads as
inconsistent written down but is what every list in every other application does. Two lines that
barely touch on screen can still be picked without hunting for them.

A new tool in the bottom toolbar ("Select lines", hotkey E) drag-selects services. It is rendered
only when `viewMode === 'network'`, which `Toolbar.tsx` already computes as `network`. Its marquee
adds every service whose path intersects the box and adds nothing else. The Select tool's own
marquee is untouched and still adds ways, stations, and facilities. The two share the marquee
gesture and differ only in a collector callback, so "where did the box land" and "what counts as
caught by it" stay separate.

Two existing group operations need a rule for service members. `nudgeMultiSelection` skips them,
because moving a line means moving the street it rides and the ways are selectable in their own
right. `deleteMultiSelection` deletes them as services, leaving the infrastructure alone.

One flaw surfaced in testing and is fixed here rather than lived with: `toggleMultiSelect` cleared
the single selection instead of absorbing it, so clicking one line and shift-clicking a second left
a group of ONE and no pairwise action within reach. Absorbing it inside `toggleMultiSelect` was too
broad — creating anything selects it, so a just-placed station would be swept into the next group.
The grouping gesture is therefore its own action, `extendSelection`, which both shift-click and
ctrl/cmd-click call; `toggleMultiSelect` stays a plain toggle for programmatic use.

## What the app offers, and when

| Selection  | Relationship                  | Action                    | Backed by                       |
| ---------- | ----------------------------- | ------------------------- | ------------------------------- |
| 2 ways     | share an endpoint node        | Join end to end           | `mergeWays`                     |
| 2 ways     | interior crossing, same grade | Connect at crossing       | `formCrossingJunctions`, scoped |
| 2+ ways    | run alongside each other      | Merge into one corridor   | `mergeWaysIntoCorridor`         |
| 2 services | termini meet, same mode       | Join into a through-route | `throughRouteServices`, **new** |
| 2 services | overlap or cross, same mode   | Merge into one line       | `mergeServiceInto`              |
| any        | —                             | Delete                    | `deleteMultiSelection`          |

Everything else is absent. Two ways that cross at different grades offer no connect action, because
that crossing is an overpass by construction — the grade check already lives in
`formCrossingJunctions` and this reuses it. Two services of different modes offer no merge, because
`mergeServiceInto` refuses that pairing already.

Hiding a blocked action leaves a person staring at two lines that visibly touch with nothing on
offer. So when exactly two objects are selected and a merge is blocked by a property rather than by
geometry — they do cross, but at different grades; they do meet, but one is a bus and one is rail —
the inspector carries one line of prose saying which property blocked it. That is a note in the
persistent surface, not a disabled entry, and the right-click menu stays silent.

## A registry, not a switch

A closed `SelectionActionId` union with a dispatch table in the store would mean that adding one
action edits an enum, a table, and both renderers. So the list is built from **providers**: a
callback that inspects the context and returns whatever actions it has to offer, each carrying its
own behaviour. Adding an action means registering a provider and touching nothing else.

Four modules split the work, each with one job.

**`packages/core/src/model/selectionActions.ts` — the contract.** Types and a registry that collects
providers and queries them. It knows nothing about ways, services, or menus.

```ts
export interface SelectionRef {
  kind: 'way' | 'station' | 'facility' | 'service';
  id: string;
}

export interface ActionContext {
  system: TransitSystem;
  refs: SelectionRef[];
}

export interface SelectionAction {
  /** Stable across renders, so a menu can key on it. Namespaced by its
   *  provider ("way.joinEndToEnd") purely as a convention. */
  id: string;
  label: string;
  /** One clause of context under the label, or undefined. */
  hint?: string;
  /** Groups separated by a rule in the menu, in first-seen order. */
  group?: string;
  run: () => void;
}

export type SelectionActionProvider = (ctx: ActionContext) => SelectionAction[];

export interface SelectionActionRegistry {
  register: (provider: SelectionActionProvider) => void;
  actionsFor: (ctx: ActionContext) => SelectionAction[];
}

export function createSelectionActionRegistry(): SelectionActionRegistry;
```

**`packages/core/src/model/selectionRelations.ts` — the predicates.** Pure functions answering how
two objects relate, and nothing about what to do about it: `sharedEndpointNode`, `crossingBetween`,
`runsAlongside`, `terminiMeet`. Every one is testable against a hand-built system with no registry
in sight.

**`apps/web/src/editor/actions/*.ts` — the providers.** `wayActions.ts`, `serviceActions.ts`, and
`commonActions.ts` each read the relations and return actions whose `run` closes over the store. A
provider is the only place that knows both a relationship and an operation, which is what keeps core
free of the store and the store free of menu vocabulary.

**`apps/web/src/editor/actions/index.ts` — the composition root.** One function builds a registry
and registers the providers against a store. `EditorProvider` calls it and hands the instance down
through context, so nothing reaches for a module-level singleton and a test can build its own
registry over its own store.

Every relationship predicate reuses geometry that already exists. A shared endpoint node comes from
`system.nodes`, matching the two-way-node rule `WayInspector` already applies so the app never
offers a join `mergeWays` would refuse. An interior crossing comes from `wayCrossings` in
`model/validate.ts`, generalized to `polylineCrossings` so a service's resolved path can be tested
the same way; it already excludes endpoint touches, because a shared junction vertex is not a
crossing. Terminus adjacency comes from the ends of each pattern's resolved path.

Co-alignment was going to be an approximation of the matcher and is not. `detectShapeRuns` — the
same function `conflatePatternOntoExisting` uses to decide what to absorb — is called directly, so
the predicate and the merge cannot disagree about whether two ways run together.

One gap survives that and belongs to the provider rather than the predicate: `mergeWaysIntoCorridor`
moves SERVICES onto the keeper, so a co-aligned way carrying no line is left where it is and the
merge would do nothing. The provider pairs `runsAlongside` with a carries-a-service check for that
reason.

Operand order is settled inside the provider that builds the action and captured in its `run`
closure, so no renderer ever re-derives which way is kept. Corridor merge orders longest first,
matching what `mergeWaysIntoCorridor` already does internally.

## Store changes

The store gains no dispatch entry point at all — an action carries its own behaviour, and the
providers are what bind an operation to a relationship. Two existing store actions do change.

`formCrossingJunctions` takes an optional second argument naming the one other way to consider.
Without it, connecting two selected streets would also junction every third street they happen to
cross, which is not what the person asked for. The existing callers pass nothing and keep today's
behaviour.

`mergeWaysIntoCorridor` already returns how many ways it absorbed. The inspector reports a zero
result as prose instead of an alert.

## `throughRouteServices` — the one new operation

Joining two lines whose termini meet into one continuous line does not exist today.
`mergeServiceInto` is not it: that produces one service with two disjoint branches, which is a
different thing from a route that runs the whole way through.

The operation lives beside `patternEdits.ts` in core, because it is leg surgery and the module
boundary there is already "pure, geometry-free, the caller supplies the measurement."

```ts
export function throughRouteServices(
  system: TransitSystem,
  keepId: string,
  otherId: string,
): TransitSystem | null;
```

It picks the pattern on each service whose terminus is the one that meets, concatenates the legs,
and reverses one side when the ends meet head to head. Reversal is order-reversal plus flipping each
leg's `forward` flag — `mergeLegs` already does exactly that when a way is reversed into another, so
there is precedent to follow rather than arithmetic to invent.

The joined line keeps `keepId`'s name, colour, and schedule. Any remaining patterns on the source
service carry over as branches, named after the source if they had no name of their own, which is
what `mergeServiceInto` does today. The source service is then deleted.

Two termini within `TERMINI_MEET_M` (100 m) are close enough to look at, but closeness is not the
test. `validateSystemQuick` reports any pattern whose consecutive legs sit more than a metre apart,
so concatenating two lines that end forty metres apart would mint a line the app immediately calls
broken. Instead, when the ends are not already the same point, `routeBetween` is asked for a path
between them over mode-compatible infrastructure and `materializeRouteSpans` turns that path into
the legs that bridge them. No path, no through-route: a null return, and the action never appears.

That makes the operation mean something physical. Two lines whose ends face each other across a gap
with no track between them cannot be through-routed, because no vehicle could make the trip.

`materializeRouteSpans` moved out of the editor store into `packages/core/src/model/routeLegs.ts` to
make this possible. It was already pure and documented as such; the alternative was a second copy of
it in core.

## Surfaces

`MapContextMenu` renders the action list at a cursor position held in `UiProvider`, in its own
context beside import progress and for the same reason: every always-mounted `useUi()` consumer
would otherwise re-render each time a menu opens.

It is built on Radix's DropdownMenu, not its ContextMenu, with a zero-size trigger parked at the
cursor and the open state controlled from outside. The gesture that opens it is not a DOM
`contextmenu` event — the map has to tell a right-drag from a right-click first — so a
trigger-driven ContextMenu cannot see it. Positioning, collision handling, and arrow-key navigation
still come from Radix, the same as `DropdownMenu.tsx`.

The right-click wiring goes in the `rightButton && !moved` branch of the pan gesture's `onUp`, which
is where `select(null)` lives today. The endpoint- branch and finish-the-draw cases above it are
untouched. Right-clicking an object that is not in the current selection selects it first, then
opens the menu; right-clicking empty space still clears the selection and opens nothing.

`MultiInspector` renders the same list as buttons and loses its hardcoded corridor button and its
`window.alert`.

## Tests

`selectionRelations.test.ts` in core gets one case per relationship and per near-miss, each named as
the rule it enforces — "two ways crossing at different grades do not count as a crossing".
`selectionActions.test.ts` covers the registry itself against stub providers: registration order is
preserved, a provider offering nothing contributes nothing, and one provider throwing does not take
the others down with it. The web providers are then tested in `verify.ts` against the real store,
which is the only place a relationship and an operation meet. `throughRoute.test.ts` covers a
head-to-head join, a tail-to-head join, a mismatched-mode refusal, a source line carrying extra
branches, and two lines whose ends are close but unconnected. One case asserts the joined line
leaves nothing for `validateSystemQuick` to report, since the whole reason the connector is routed
rather than assumed is to keep that true.

`apps/web/scripts/verify.ts` gets service multi-selection appended in its existing sequential style,
beside the multi-selection cases already there.

## Out of scope, and open questions

Making Infrastructure view "feel more permanent" is deferred. It could mean guarding deletions that
would break the services riding a street, scoping the action list to the layer the view is about, or
rendering the substrate more solidly, and those are three different jobs. Nothing here assumes any
of them.

The 100 m terminus-adjacency threshold is a guess, though a much less load-bearing one than it
looked: it only decides which pairs are worth asking the router about, and routability is what
actually gates the join. A pair that is close but unconnected is refused regardless of the number.

The co-alignment predicate now runs the merge's own matcher, so the two cannot disagree about
geometry. What remains is that a corridor merge can still absorb nothing when the carries-a-service
check passes but conflation fails for some other reason. That case reports quietly in the inspector
instead of raising `window.alert`.

Picking up the Lines tool does not clear an infrastructure selection, so a marquee there can add
lines to a group that already holds ways and end up mixed, with no action applying to it. That
follows the existing rule that a marquee only ever adds, and clearing on a tool switch would change
behaviour for every tool, so it was left alone.

Nothing here changes what the Select tool does with a plain click, so a line is still selectable
without the new tool. That leaves a deliberate overlap between the two tools, which is a cost
accepted to avoid taking away a familiar interaction.
