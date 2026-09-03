# The three views

TransitMapper's core idea is that one system needs more than one
representation. The same document renders three ways:

- **Network** — the schematic. One colored stripe per Line and point stops.
  This is the transit map as riders think of it, and the view where you draw
  and route _services_.
- **Infrastructure** — the physical world. Roads with lanes, tracks,
  junction footprints, Station boundaries, platforms, buildings. This is where you draw and
  edit _infrastructure_.
- **Diagram** — a read-only straightened diagram of the network, in the
  tradition of printed transit maps.

The unifying principle: **a unified model that can represent complex
physical infrastructure as a simple network**. In one document a divided
six-lane boulevard is simultaneously "the red line goes down Decatur" and
two one-way carriageways with specific lanes, medians, and signalized
junctions. Neither view is a simplification of the other; they're
projections of the same data.

## A Line is what Network draws

Network and Diagram paint the public identity, not the operation. A Line
served by a weekday plan and a weekend one is a single stripe, and clicking it
selects the Line; its ServicePlans and Patterns are inspector actions reached
from there. One-way direction is an operational fact about a plan rather than
a property of the Line, so it shows in Infrastructure as lane arrows and in
Network only on the transient overlay the editor draws while somebody inspects
a Pattern.

## Screen-space detail

The two geographic views choose detail from how wide each corridor appears on
screen, not from one fixed zoom number. In Infrastructure, Overview is one
clean silhouette regardless of lane count, District expands to the aggregate
physical width, and Street introduces lane, marking, junction, and connector
detail. Network uses the same bands to move service paths from a centered
schematic placement toward their assigned lanes without displaying physical
lane furniture. Adjacent scales blend over a few displayed pixels so a camera
move does not make the map pop between drawings.

This changes only what is legible at the current display size. It does not
discard lanes, alter service routing, or produce a different settled export.
Diagram remains a separate schematic projection; it does not pretend that its
straightened geometry is geographic Street detail.

## Why the Infrastructure view is 2D

This rule does real work: **everything drawn in the Infrastructure view
has physical extent.** Ways have cross-sections with real widths. Stations
are land; the boundary you draw defines the station's identity in this
view. Buildings and bus bays are shapes on that land.

The rule exists because point placement in a physical view lies. A station
dot on an infrastructure map defers every real question: where the
platforms are, how big the site is, what it displaces. Those questions
are the point of an infrastructure view. Abstraction to a point is the
Network view's job. So the shared passenger-place shortcut presents a
**Station** tool that draws land in Infrastructure and a **Stop** tool that
places boarding points in Network. Genuinely point-like things
(an entrance, an elevator) are the only facilities placed as points.

## Why drawing infrastructure never creates a service

Roads exist independently of buses. When drawing a road also spawned a
service, the model claimed every street was a transit line, and the UI had
to ask about frequencies while you were laying asphalt. So the views'
responsibilities are strict: Infrastructure produces ways, Network produces
services over ways. The bridge between them is explicit and two-directional:
you can route a service over existing infrastructure, or adopt real
infrastructure under a sketched line. Neither happens as an implicit side
effect of drawing.

## You can sketch first or build the streets first

Some people start with a fantasy network map and only later care about
streets; some start by importing a real city and running service over it.
The two bridges exist so neither workflow is a dead end: a freehand sketch
can adopt real streets later, and real streets can carry a routed service
from the first click.
