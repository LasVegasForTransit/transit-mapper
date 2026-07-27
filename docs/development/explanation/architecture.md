# Architecture

What the pieces are, how they talk to each other, and which boundaries are
load-bearing. [Project structure](../reference/project-structure.md) says
where things live; this says why the shape is what it is.

## Three packages, one rule

```
packages/core   →   apps/web
                →   apps/worker
```

**Core depends on nothing in the apps, and both apps depend on core.** That
is the only structural rule, and everything else follows from it.

Core is the domain: the data model, the geometry, the routing graph, the
renderer, the share contract. It is consumed straight from source — there is
no build step — through subpath imports like
`@transitmapper/core/model/catalog`.

The layering inside is **model → store → rendering and UI**, with purity
increasing toward the model. A function in `model/` takes data and returns
data. A component in `apps/web/src/ui/` reads the store and calls an action,
and holds no domain logic at all.

## Why core must run in two runtimes

The editor runs in a browser. The Worker runs in workerd. Core runs in both,
because the same code that draws a system in the editor also draws the share
card that the Worker serves.

This is the constraint that shapes core most. A browser-only global compiles
cleanly and then throws in production, in whichever runtime nobody
exercised — and the compiler cannot catch it, because core's tsconfig
includes the `DOM` lib deliberately to pick up the ambient `fetch`, `crypto`
and `structuredClone` that _both_ runtimes provide. That necessarily brings
`window` and `document` along with it.

So it is a lint rule instead: `core-runtime-purity`. It exists precisely
because the type system cannot express the thing that matters.

## The editor: one store, everything through it

`apps/web/src/editor/store.ts` is a single zustand store, and **every**
change to a system goes through an action on it. Undo checkpoints, junction
bookkeeping, station re-anchoring and NamedWay upkeep all live in those
actions rather than in the components that trigger them.

The map layer is deliberately not React. `apps/web/src/map/` keeps MapLibre
sources in sync with the store imperatively, and `sim/vehicles.ts` writes a
GeoJSON source directly, because both update at frame rate and
reconciliation at that rate is what would make it stutter.

## The Worker: the only code that reads bytes from strangers

`apps/worker/src/index.ts` handles share creation and retrieval, the GTFS
proxy, preview images, oEmbed, and the share and embed pages.

Everything security-relevant about this project is in that one file, which
is why it is the one with tests running in real workerd against a real D1
rather than against mocks.

Two decisions there are worth knowing because they look odd otherwise:

- **The Worker does not run first.** `run_worker_first` is scoped to
  `/api/*`, `/s/*` and `/e/*`. An asset served without invoking the Worker
  is free and unlimited; every request that reaches it is billed against a
  100k/day allowance, and requests past that get a 429 rather than falling
  back. A homepage visit costs zero invocations.
- **Preview cards are drawn in the browser**, not the Worker, and uploaded
  with the share. A free-plan Worker gets 10ms of CPU per request and
  rasterizing a card measured ~65ms. The Worker validates the uploaded bytes
  and hands them back; it never trusts them as markup.

## Storage, and what it means for the data model

There are two stores, and they are not mirrors of each other.

`localStorage` holds the working library — every system the person has made,
each under its own key so switching between them never touches the others,
with a small index of id, name and timestamp so the list renders without
loading everything.

D1 holds _snapshots_. A share is a copy taken at a moment, not a live
document. Nothing syncs back. That is why a share can expire and the
original survives, and why `serialize.ts` carries versioned migrations: a
snapshot taken months ago must still parse.

## Where the seams are

These are the boundaries worth preserving, in the sense that crossing them
is how the design erodes:

| Boundary                                                                  | What it protects                                                     |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| core has no DOM, no store, no React                                       | core stays runnable in both runtimes and testable without either     |
| all mutation goes through store actions                                   | undo, junction upkeep and re-anchoring cannot be bypassed            |
| `catalogStyle.ts` holds visual properties, `catalog.ts` holds domain data | adding a mode does not mean touching the renderer                    |
| `buildFeatures.ts` is the only system-to-GeoJSON projector                | the editor, the embed, exports and the share card cannot drift apart |
| the Worker never concatenates stored values into HTML                     | user-supplied names cannot become markup                             |

## What is built but not connected

`packages/core/src/auth/` and `share/claim.ts` and `share/ownership.ts` are
the first slice of accounts: OAuth URL building, PKCE, token hashing, cookie
serialization, return-path validation. They are complete, pure, and covered
by tests — and **nothing imports them but the tests.**

There are no auth routes, no users or sessions table, and no owner column.
This matters when reading nearby code, because several places already talk
about accounts as though they exist: `touchExpiry` skips rows with
`expires_at IS NULL` "because they're account-owned", and migration `0002`
reserves that null for the same reason. Those are deliberate preparation,
not a feature you have failed to find.
