# Design principles

This page explains the reasoning behind decisions in the codebase, so
that a new situation the code doesn't already cover can be handled the
same way the existing code was. For the code-level reference, see
[Catalogs](../reference/catalogs.md) and
[Project structure](../../development/reference/project-structure.md). For how to submit
a change, see [CONTRIBUTING.md](../../../CONTRIBUTING.md).

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
in `src/style/catalogStyle.ts`. The one exception is a Line's color,
which stays with the domain data because "the red line" is part of
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

## An invalid state is either impossible or fixed automatically, never reported

The tool is meant to be forgiving to use and precise underneath — someone
should be able to draw and drag without thinking about the model's rules,
while the model stays exactly right. A warning that tells a person "you did
something wrong, go fix it" fails both halves at once: it makes the tool
less forgiving (now they owe it a fix) without making the model any more
correct (the invalid state still happened). If the code can already tell a
state is wrong, the fix belongs in the code that produced the state, not in
a message asking a person to notice and correct it.

This isn't the same as a design decision, which only a person can make — a
line running against traffic on a one-way street might be a mistake, or it
might be a documented contraflow bus lane, and the model has no way to know
which. Those stay a person's call. What doesn't stay a person's call is a
line with one point, or two street segments visibly crossing with no
junction between them — both are bugs in whatever produced them, not
questions about the network being designed.

In practice: every mutation that can shrink a way's point list refuses to
take it below 2. The editor's way and network command groups compose the same
pure transforms for `deleteWayPoint`, splitting, straightening, and every path
that can introduce a new same-type, same-grade crossing — drawing, dragging a
point, inserting one, or importing a batch of ways. A state those guards cannot
reach in practice (a hand-edited document with the same corridor type crossing
itself twice) is still checked and repaired on load
(`packages/core/src/model/serialize.ts`'s `repairedParts`), never surfaced
as something to click through. `packages/core/src/model/validate.ts`'s
`IssueAudience` split (`plan` vs `document`) is the seam: `document` issues
are checked and tested so the repair stays provable, but never shown to
anyone — there used to be a top-bar panel that showed them, and it was
deleted once the states it reported became impossible to reach.

## Waiting is something the app does, not something it asks for

Someone who opens the editor has already decided what they want to do.
Replacing the interface with a status message turns that intent into a
wait, and it does so at the moment the app knows least about whether the
wait will end. The interface is not what is missing: the HTML, the code,
the font, and an empty document are all in memory before the first byte
is read from storage. Showing a sentence instead withholds something that
costs nothing to show.

The same reasoning applies to failure. A step that did not work is a
reason to say so, not a reason to take the tool away — and it is worth
being precise about which step. Storage that cannot be reached says
nothing about whether the map draws; a basemap that will not load says
nothing about whether the work is safe. Collapsing all of them into one
blank screen tells the reader the largest possible thing went wrong,
which is almost never true. When something does fail, name the cause the
reader can act on rather than the exception text: "you're offline" is an
answer, and "Failed to fetch" is not. A failure that leaves someone
stuck also needs a way forward that does not depend on the broken thing,
or a retry that keeps failing becomes a blocker with extra steps.

Three things legitimately block, and nothing else does. A modal the
person opened themselves, because they asked for it. A render error that
has already unmounted the tree, because there is no longer an interface
to keep. And a refused change that would otherwise destroy data the app
cannot currently see — refusing an edit is not the same as refusing to
appear, and the first is sometimes the only honest option.

One tempting shortcut is worth naming as a mistake. `navigator.onLine`
being `false` is reliable and may be used to explain a failure that
already happened. `true` means only that the machine is attached to some
network, which a captive portal and a dead uplink both satisfy — so it
may never gate a control. Disabling a button on a signal that lies
invents a block out of nothing and stops the request that would have
worked.

In practice: `apps/web/src/App.tsx` has no branch for "not loaded yet" and
renders the map, workbench, and toolbars unconditionally; every wait and
every failure is a banner over a working editor, decided by
`resolveAppBanner` in `apps/web/src/ui/app-banner.ts`. What can't be
allowed yet is refused at one seam rather than hidden — the editor store's
runtime uses `documentStatus` to turn away document-changing command results
while the saved one is still arriving, and deliberately changes no chrome, so
nothing moves when it clears. `attachInitialStyleFallback` in
`apps/web/src/map/initialStyleFallback.ts` is the older instance of the
same rule: a basemap that does not answer within 1.5 seconds is swapped
for a bundled blank style and mentioned in a banner, rather than being
waited on. Messages are stored as causes (`NoticeCause`) rather than as
sentences, so the wording is derived at render time and a failure can be
reworded by something that changes afterwards — which is how a blank
basemap starts naming the network the moment the browser goes offline.
