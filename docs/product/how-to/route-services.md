# Route services over infrastructure

TransitMapper supports two workflows and a bridge between them:

- **Infrastructure-first**: draw streets and track, then run services over
  them.
- **Sketch-first**: draw service lines freehand in the Network view, then
  attach real infrastructure underneath later.

## Run a service over existing ways

In the **Network** view, start drawing a line (the way-drawing tool with a
service-compatible mode selected) and begin **on existing infrastructure**:
press within snapping distance of a way the mode can use (bus on roads, light
rail on light-rail track or streets, and so on; compatibility comes from the
mode catalog).

Instead of laying new geometry, each click extends a _route_ through the
network: the editor finds a path from your last point to the click through
the junction graph, previews it, and follows the streets around corners. You
only click at meaningful places: where the route turns, roughly one click
per turn. `Enter` or double-click commits the whole thing as a new service;
`Esc` abandons it.

Clicks in the middle of a block are fine: the route can enter and leave a
way mid-segment, not only at junctions.

If you start a line on empty ground instead, you draw new geometry — but
only for the ground that is actually new. On commit, every stretch of the
finished line that runs along compatible infrastructure is rebound onto it,
so a line drawn beside an existing street ends up riding that street rather
than laying a second one next to it. The sketch geometry left carrying
nothing is removed, unless it was imported or named.

How close counts as "running along" depends on the mode, because it is a
physical question rather than a preference: a train is on the track or it is
not, so rail is tight; a bus is somewhere in a carriageway that is itself
road-width, so road modes are looser.

Hold **Alt** while starting a line to lay deliberately separate
infrastructure instead — the express track beside the local one, the busway
beside the road. It applies to the whole line, and the next line you draw
shares again.

## Adopt infrastructure under a sketched line

The bridge in the other direction. Say you sketched a bus line freehand
months ago, and have since imported or drawn the real street grid under it:

1. Select the sketched service.
2. Open the inspector's **Route** tab.
3. Click **Adopt existing infrastructure**.

The editor re-routes the service through the real network, using the sketch
as a corridor bias so the adopted route follows the streets nearest your
original drawing. Stops re-anchor onto the adopted ways, and the now-orphaned
sketch geometry (unnamed, hand-drawn, serving nothing else) is cleaned up.

Adoption only considers way types the service's mode can run on, and it
leaves shared or named ways alone.

## Shorten, split, or cut a line

A line no longer has to cover a whole way, so it can be edited in pieces.
All of these are in the inspector's **Route** tab, on the stop sequence —
a stop is a place a line can be cut.

- **Start here** / **End here** move one end of the line to that stop. The
  street underneath is untouched; this shortens the line, not the road.
- **Split** cuts the line in two at that stop. Both halves keep the same
  mode, schedule, and infrastructure; the new half takes a colour of its own.

To remove a piece of the road itself rather than the line, select the way
and delete a stretch of it. Every line riding it is trimmed to match, and a
line the cut passes through survives as two pieces rather than losing
whichever half was shorter.

## Fuse corridors drawn twice

A map drawn before lines shared by default has the same corridor two or
three times over. Select the ways (shift-click), then **Merge into one
corridor** in the inspector. The longest is kept, the others' lines move onto
it, and any way left carrying nothing is removed — unless it was imported or
named. Ways that do not actually run alongside each other are left alone and
tell you so.

## Direction and one-way streets

Routing respects one-way profiles. A line cannot be routed against traffic:
draw from the far end of a one-way street back toward its start and the route
goes round the block instead, along whatever legally connects the two points.
Where nothing legal exists, drawing and adoption still give you the line rather
than swallowing the click, with the offending stretches flagged.

One-way ways a service runs over display travel-direction chevrons in the
Network view.

Turn restrictions are not enforced yet, so a route may still make a turn a
junction's lane connectors forbid.

## Split a line into two one-way paths

A downtown couplet — the outward trip up one street, the return down the next
one over — is one line with two directions, not two lines.

1. Select the line and open the inspector's **Route** tab.
2. Click **Draw a separate return path**. The draft starts at the far end of
   the outward trip.
3. Trace the return along the streets it actually runs, back toward the start.
4. Finish the draft.

The stretch the return parallels becomes a two-direction section; everything
before the point where the return rejoins stays shared. The Route tab then
lists both stop sequences, since the two directions call at different stops.

**Make it run both ways on one street** undoes it, keeping the streets the
outward trip ran.

Two things behave differently on a line like this. Trimming it back cuts both
directions, finding the matching point on the return's own street. Adopting
existing infrastructure refuses, because it replaces a pattern's whole path
with one routed line and would silently discard the direction you drew.
