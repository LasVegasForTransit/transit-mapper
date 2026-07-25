# Design principles

This page explains the reasoning behind decisions in the codebase, so
that a new situation the code doesn't already cover can be handled the
same way the existing code was. For the code-level reference, see
[Catalogs](../reference/catalogs.md) and
[Project structure](../reference/project-structure.md). For how to submit
a change, see [CONTRIBUTING.md](../../CONTRIBUTING.md).

## New capabilities should be data, not code changes

Supporting a new transit mode, lane type, or facility should mean adding
an entry to a table, not changing how the editor behaves. If adding
something new requires touching a switch statement or an if/else chain
elsewhere in the code, the wrong thing was hardcoded.

In practice: every mode, way type, lane kind, and facility type is a
record in `src/model/catalog.ts`, and application code reads fields off
those records instead of checking which one it got.

## What something looks like is a separate decision from what it is

A drive lane's identity (it's a travel lane, about 11 feet wide, counts
toward capacity) shouldn't depend on how it's drawn (asphalt gray, white
dashes), and vice versa. Keeping the two separate means the underlying
model can be tested without caring about colors, and a visual restyle
never needs a data migration.

In practice: domain data lives in `src/model/`, and how it renders lives
in `src/style/catalogStyle.ts`. The one exception is a service's line
color, which stays with the domain data because "the red line" is part of
the line's identity, not just its paint.

## The rules of the system should be checkable without a browser

If figuring out whether the routing logic or the junction geometry is
correct requires clicking around in the app, that logic is entangled
with things that don't need to be there.

In practice: `src/model/` and `src/geometry/` take data in and return
data out, with no DOM, network, or store access, so `pnpm verify` can
exercise migrations, junction geometry, and routing as plain function
calls.

## If it can be computed, it shouldn't also be stored

A value that's stored and also derivable from other stored data will
eventually drift out of sync with the thing it was derived from. Keeping
only the source data avoids that entire category of bug.

In practice: lane polygons, junction footprints, turn arrows, and
capacity numbers are all computed on demand from a way's points and
profile, not saved alongside them.

## A control's label is a promise about what happens next

If a button says it draws a road, clicking it should draw a road, not
place a placeholder that needs a second step to become one. Variants and
settings belong near the control they modify, not buried somewhere
unrelated.

In practice: the bottom dock's buttons are modes (Road draws a road,
Station draws a station); variants live in that tool's flyout menu, and
contextual settings live in the options row above the dock.

## Something people name in real life should be one thing in the model

A street or a rail line often corresponds to several separate technical
pieces underneath (segments split at every junction), but the person
using the tool thinks of it as one named thing. The model should match
that mental picture, not force people to think in terms of the pieces.

In practice: a shared name (like "Decatur Avenue") is its own record, a
`NamedWay`, that a street's segments all point back to, rather than being
a property duplicated on each segment.
