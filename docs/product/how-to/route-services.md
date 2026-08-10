# Route services over infrastructure

TransitMapper supports two workflows and a bridge between them:

- **Infrastructure-first**: draw streets and track, then run services over
  them.
- **Sketch-first**: draw service lines freehand in the Network view, then
  attach real infrastructure underneath later.

The terms in this guide follow the
[editor interaction reference](../reference/editor-interactions.md). A Line is
the public map identity; a Service is one mode-specific operation; and a Way
is the physical road, track, trail, aerial span, or water route it follows.

## Run a Service over existing infrastructure

In the **Network** view, choose the Line tool with a service-compatible mode
and begin **on existing infrastructure**. Press within snapping distance of a
Way the mode can use: a bus on roads, light rail on light-rail track or
streets, and so on. Compatibility comes from the mode catalog.

Instead of laying new geometry, each click extends a _route_ through the
network: the editor finds a path from your last point to the click through
the junction graph, previews it, and follows the streets around corners. You
only click at meaningful places: where the route turns, roughly one click
per turn. `Enter` or double-click commits the whole thing as a new service;
`Esc` abandons it.

Clicks in the middle of a block are fine: the service path can enter and leave
a Way mid-segment, not only at junctions.

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

Hold **Alt** or **Option** while starting a line to lay deliberately separate
infrastructure instead — the express track beside the local one, the busway
beside the road. It applies to the whole line, and the next line you draw
shares again.

The cursor badge states which result is armed before you press: `connect` over
compatible infrastructure, `new` over empty ground, and `separate` while
`Alt`/`Option` is held. See the
[pointer-intent table](../reference/editor-interactions.md#pointer-intent-reference)
for the complete contract.

## Adopt infrastructure under a sketched line

The bridge in the other direction. Say you sketched a bus line freehand
months ago, and have since imported or drawn the real street grid under it:

1. Select the sketched service.
2. Open the inspector's **Route** tab.
3. Click **Adopt existing infrastructure**.

The editor re-routes the service through the real network, using the sketch
as a path bias so the adopted route follows the streets nearest your
original drawing. Stations re-anchor onto the adopted Ways, and the now-orphaned
sketch geometry (unnamed, hand-drawn, serving nothing else) is cleaned up.

Adoption only considers Way types the Service's mode can run on, and it
leaves shared or named infrastructure alone.

## Focus and extend a Service

A public Line may group several operations, such as local and express variants.
Each is a **Service** with exactly one mode and path. The outline hides the
Service level when a Line has only one, and reveals it when there are several.
Select a Service or one of its visible path occurrences to edit it. The map
shows a terminus handle at both ends; it does not show Way control points in
the Network view.

Drag either terminus over compatible infrastructure to preview the routed extension.
The original Line identity and the Service's mode, path, schedule, sibling Services, Ways,
junctions, and stations stay unchanged. Drop to commit one undo step, or press
`Escape` to cancel.

Dragging a terminus onto the focused Service path's interior closes a directional
loop. Dragging it to another Service with the same mode connects their paths
while keeping both Services. A different mode is refused. Dropping on the
other Service's terminus opens two choices:

- **Connect paths** extends the dragged Service and leaves the target Service
  unchanged.
- **Join into a through-service** keeps the dragged Service's schedule and
  absorbs the target Service into one continuous operation.

An explicit same-mode connection may join Way types that the mode is
allowed to use. It does not create a station.

## Shorten or divide a Service

A Service no longer has to cover a whole Way, so it can be edited at the
exact displayed point. Right-click its path and use:

- **End Service here** keeps the longer operating side and removes the shorter side.
- **Divide Service here** keeps the longer half on the original Service. The shorter
  half becomes a second Service under the same public Line and is selected.

The inspector's stop sequence also offers **Start here** and **End here** when
a named station is the convenient cut point. These service-path operations do
not split or move the Way underneath.

To divide the physical road or track instead, switch to Infrastructure view
and right-click it for **Split path here**. That creates two independently
editable Ways; it is not a Service operation.

## Merge overlapping infrastructure

A map drawn before Lines shared infrastructure by default may have the same
Way two or three times over. Select the overlapping Ways (shift-click), then
**Merge overlapping paths**. The longest is kept, the other Services move onto
it, and any Way left carrying nothing is removed — unless it was imported
or named. Ways that do not actually run alongside each other are left
alone and tell you so.

## Direction and one-way streets

Routing respects one-way profiles. A line cannot be routed against traffic:
draw from the far end of a one-way street back toward its start and the route
goes round the block instead, along whatever legally connects the two points.
Where nothing legal exists, drawing and adoption still give you the line rather
than swallowing the click, with the offending stretches flagged.

One-way Ways a Service runs over display travel-direction chevrons in the
Network view.

Turn restrictions are enforced too. Where a junction's lane connectors or turn
restrictions forbid a movement, the route goes round rather than through — on
past the junction, turn round, and back to it on a street that may turn. A
blocked turn is a detour, not a refusal, because the two points are still
connected.

A turn is refused only when EVERY lane of the arriving street forbids it. A
right-turn pocket is enough to permit the turn, which is the safe reading: the
alternative sends a line the long way round a junction it may cross.

## Convert a terminus to two one-way paths

A downtown couplet — the outward trip up one street, the return down the next
one over — is one Service with two directions, not two Services.

1. Select the Service you want to change.
2. Right-click its terminus and choose
   **Convert end to two one-way paths**. The action arms that exact end even
   though Select remains the active toolbar tool.
3. Drag the armed terminus along the Ways the inbound path follows and
   reconnect it to the Service path.
4. Drop to commit. An invalid drop or `Escape` changes nothing.

The stretch the return parallels becomes a two-direction section; everything
before the point where the inbound path rejoins stays shared. The Route tab then
lists both stop sequences, since the two directions call at different stops.

**Make it run both ways on one street** undoes it, keeping the streets the
outward trip ran.

Two things behave differently on a line like this. Trimming it back cuts both
directions, finding the matching point on the return's own street. Adopting
existing infrastructure refuses, because it replaces a Service's whole
path with one routed line and would silently discard the direction you drew.
