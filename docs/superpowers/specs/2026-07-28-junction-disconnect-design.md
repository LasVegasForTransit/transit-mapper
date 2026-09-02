# Disconnecting a junction, and refusing to form bad ones

> **Status.** Implemented. Two departures from what is written below, both forced by the code having
> moved on: `formCrossingJunctions` had already gained its `typeId` guard, so only `crossingBetween`
> needed the rule; and the web verifier now lives at `apps/web/tests/verify.test.ts`, not
> `apps/web/scripts/verify.ts`. The Connections list also carries each arm's compass bearing,
> because four arms of two unnamed streets otherwise read as four identical rows.

> **Vocabulary.** The user-facing object is a **junction**. It is represented by `Node` in the
> current model; code identifiers such as `NodeInspector` and `sel.kind === 'node'` retain that
> representation name. See [Editor interactions](../../product/reference/editor-interactions.md).

## Context

A junction joins two or more corridors at coincident control points and is represented by a `Node`.
Nothing today lets a person undo that join. `useSelectionActions.ts` deliberately excludes junction
selections from the whole selection-action system, `NodeInspector.tsx` offers only turn-lane and
control-type tabs, and `deleteSelection` in `keymap.ts` has no branch for `sel.kind === 'node'` —
pressing Delete on a selected junction is a silent no-op.

That gap is now a live bug. `formCrossingJunctions` (`apps/web/src/editor/store.ts:1253`) auto-joins
any two ways of the same `grade` the moment a draw commits, and checks `grade` only — never
`typeId`. Draw a bus road across an existing rail line and the app wires them into one
lane-connected junction with no confirmation, producing exactly the case in the report: a road and a
rail service sharing a junction that isn't a station, with `Mode.wayTypeIds` (`catalog.ts:620-694`)
making clear the two could never carry the same vehicle. `crossingBetween`
(`packages/core/src/model/selectionRelations.ts:70-79`), which backs the explicit "Connect at
crossing" action, has the identical gap. Meanwhile `sharedEndpointNode`
(`selectionRelations.ts:48-51`), which gates end-to-end merging, already requires matching `typeId`
— the crossing path just never got the same rule.

The reader of this document is whoever implements it. When you finish, you should know why the
disconnect primitive follows `joinWayPointToWay`'s shape rather than moving into `packages/core`,
and why a 2-arm junction and a 6-arm junction go through the same code path.

## Decisions

Every item here was confirmed in brainstorming.

- Removing a way from a junction **nudges that way's point away** rather than leaving it coincident
  — the point stops being shared, and it stops being at the same coordinate, so no junction dot
  survives by construction.
- One primitive handles **any junction**, not just the 2-arm cross-type case: a 3+ arm street
  intersection can shed one arm and keep the rest.
- Junction formation on crossing (`formCrossingJunctions`, `crossingBetween`) requires an **exact
  `typeId` match**, mirroring `sharedEndpointNode`. No mode-compatibility lookup — a
  `road`/`lightRail` pair that could theoretically share a mode still doesn't auto-join.
- Junctions that already violate this (from the bug, or from the legacy `deriveNodesFromWays` load
  path) are **surfaced through `validate.ts`**, the same mechanism `findCrossingsWithoutJoining`
  already uses, rather than left for someone to find by clicking around the map.
- The trigger is a **per-arm list in `NodeInspector`**, not a keyboard shortcut. A 2-arm junction's
  list has two rows; disconnecting either one produces the same end state.

## `disconnectWayFromNode`

```ts
// apps/web/src/editor/store.ts, private, beside joinWayPointToWay (920) and
// mergeWays (1119)
function disconnectWayFromNode(system: TransitSystem, nodeId: string, wayId: string): TransitSystem;
```

A pure system transform. `joinWayPointToWay`, `formCrossingJunctions`, and `mergeWays` are all
written this way — private functions in `store.ts` that take and return a `TransitSystem` — and each
is wrapped by a same-named store action (`mergeWays: (keepWayId, otherWayId) => void` at line 408,
implemented at 2608). `disconnectWayFromNode` follows that convention rather than moving splice
logic into `packages/core`, which isn't otherwise part of this change.

1. Look up the `Node`; find the `WayPointRef` whose `wayId` matches and remove it from `refs`.
2. Compute a nudge direction: the negated sum of the unit tangent vectors of the _other_ remaining
   arms at their shared coordinate (i.e., point away from where the other ways continue). For a
   2-arm node this is just the opposite direction of the one remaining way. Move the removed way's
   control point 12m along that direction.
   - 12m clears `NODE_COORD_PRECISION`'s ~0.11m coincidence bucket (`serialize.ts:193-197`) and the
     interactive snap radius (`MAX_SNAP_M = 50` is the ceiling `snap()` ever applies, but disconnect
     isn't a drag gesture, so there's no re-snap risk regardless) by a wide margin, and reads as a
     clear gap at street-level zoom without visibly distorting the way's shape.
3. Prune any `LaneConnector` in `Node.connectors` that references the removed `wayId` — a dangling
   connector ref would otherwise break `junctionGeometry`
   (`packages/core/src/geometry/junctions.ts:57`), which assumes every connector's endpoints resolve
   to a live arm.
4. If `refs.length < 2` after removal, delete the `Node` outright. A single way passing through a
   point isn't a junction. The last remaining way's point is left exactly where it was — only the
   disconnected side moves.

This covers both shapes of the ask. The screenshot's 2-arm case: disconnecting either arm drops the
junction's `Node` to 0 or 1 refs, so it is deleted and the two corridors end up fully separated. A
real 3+ arm junction keeps its stored representation for the remaining arms.

## Bug fix: exact type match on crossing-formed junctions

Two call sites, one rule:

```ts
// apps/web/src/editor/store.ts, formCrossingJunctions's guard (line ~1281)
if (b.id === aId || b.grade !== a.grade || b.typeId !== a.typeId || b.points.length < 2) continue;
```

```ts
// packages/core/src/model/selectionRelations.ts, crossingBetween (lines 70-79)
// add typeId equality alongside the existing grade check, matching
// sharedEndpointNode's rule at lines 48-51
```

A road drawn across a rail line no longer auto-joins on commit, and "Connect at crossing" no longer
offers to join them by hand. They stay two independent ways at the same grade — which
`findCrossingsWithoutJoining` (`packages/core/src/model/validate.ts:236-466`) already flags as a
crossing that might need joining. That check is likely what prompted the bad join in the first
place, since its message doesn't currently distinguish "same corridor, should share a junction" from
"different track standard, this needs a level crossing, not a lane graph." Its message can now say
so directly for a type mismatch.

## Surfacing existing bad junctions

`packages/core/src/model/validate.ts` gains `findMismatchedTypeJunctions(system): Issue[]`, walking
`system.nodes` and reporting any `Node` whose referenced ways don't all share one `typeId`.

`Issue['target']` (`validate.ts:25-31`) gains a `{ kind: 'node'; id: string }` variant. `Selection`
in `apps/web/src/editor/store.ts:133-140` already includes `{ kind: 'node'; id: string }`, so
`selectAndFocus` (`store.ts:2026-2027`) and `MapCanvas`'s camera-focus watcher need no change — only
the `Issue` union does.

The new check merges into the same `IssuesPopover.tsx` list that `validateSystemQuick` and
`crossingsWithoutJoiningChunked` already feed. Clicking the issue selects the junction and pans to
it, same as any other issue, landing on `NodeInspector` where the new Connections tab (below) is
right there.

## UI: the Connections tab

`NodeInspector.tsx` gets a third tab alongside "Turn lanes" and "Control": **Connections**. It lists
every arm at the junction — way name and a type badge, e.g. "East Russell Road · road" / "East
Charleston Blvd · heavyRail" — each with its own **Disconnect** button.

The store gains `disconnectNodeWay: (nodeId: string, wayId: string) => void`, wrapping
`disconnectWayFromNode` the same way `setNodeControl` wraps its own transform (store.ts:382, 2569) —
`NodeInspector` already calls `setNodeControl` directly via `useEditor((s) => s.setNodeControl)` for
the Control tab, and the new Connections tab's Disconnect buttons call `disconnectNodeWay` the same
way. This isn't routed through `SelectionActionProvider`/`wayActions.ts`'s registry — that system is
for the context-menu and multi-selection surfaces, and `useSelectionActions.ts` deliberately
excludes node selections from it; `NodeInspector` has always talked to the store directly for
single-junction actions. If the `Node` is deleted as a side effect (refs drop below 2), `selection`
clears; otherwise the inspector re-renders with one fewer row.

No keyboard shortcut. `keymap.ts`'s `deleteSelection` stays untouched for `sel.kind === 'node'` —
the per-arm list is unambiguous even at 2 arms, and a second path to the same action isn't worth the
surface area.

## Tests

`selectionRelations.test.ts` (core) gets one more near-miss case alongside the existing
grade-mismatch one: two ways crossing at the same grade but different `typeId` do not count as a
connectable crossing.

`apps/web/scripts/verify.ts` gets `disconnectNodeWay` exercised in its existing sequential style,
beside the `joinWayPointToWay`/`mergeWays` cases already there (~line 1933, 6666): a 2-arm node
drops to none after one disconnect and both ways end up non-coincident; a 3+ arm node keeps standing
with the right `refs` and `connectors` after shedding one arm; a `LaneConnector` referencing the
removed way is gone afterward. Separately: draw a road across a rail line and assert no junction
forms; hand-construct a mismatched node (simulating a pre-fix document) and assert
`findMismatchedTypeJunctions` reports it and that `disconnectNodeWay` clears the issue.

## Out of scope

Mode-compatibility auto-joining (e.g. letting a `lightRail` way cross a `road` way and still join,
because `Mode.wayTypeIds` allows a tram to run on either) is rejected outright, not deferred — the
exact-`typeId` rule is the whole fix.

Migrating pre-v4 documents' `deriveNodesFromWays` output isn't touched beyond detection. A legacy
document that already has a mismatched junction gets flagged like any other; nothing auto-repairs it
on load, since the same per-arm Connections UI is the repair path either way.
