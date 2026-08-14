# Geometry and routing

How TransitMapper turns a small stored model (points, profiles, junctions)
into street-level geometry and routable networks. Everything on this page is
derived at render or query time; none of it is saved.

## From centerline to lanes

A way stores only a centerline and a cross-section (an ordered lane list
with widths). `src/geometry/streets.ts` derives the rest in two forms: a
lane centerline for routing, vehicles, and arrows, and a closed `LaneSurface`
polygon for rendering. It resolves each cross-section boundary once, then
shares that boundary with its two neighbouring surfaces. This avoids tiny
gaps on curves and gives MapLibre and SVG the same physical asphalt or
guideway. Divider lines come from those same boundaries (dashed between
same-direction lanes, yellow between opposing lanes, edge lines at the
border).

A rail track uses its lane centerline differently: it resolves to a standard
gauge pair of running rails and a regular set of ties. The ties travel as one
multi-line feature rather than thousands of unrelated map features; SVG
expands that same geometry when it writes the drawing. At lower detail the
corridor remains the clean guideway line, so rail hardware appears only when
it can read as physical structure rather than texture.

The lane-list convention follows osm2streets: left-to-right as seen facing
the way's forward direction. Adopting an existing convention meant lane
ordering, flipping, and one-way logic had prior art to check against.

This detail is expensive at scale, so it's gated: lane geometry is derived
only in the Infrastructure view, above a zoom threshold, for ways
intersecting the viewport, and it's memoized per way, so a drag invalidates
one way rather than the world. Below the threshold, ways render as the cheap
lines the Network view always uses.

At the intermediate District detail, the renderer uses the same offsetting
rule to fill one closed carriageway footprint. That is deliberately separate
from both the Overview centerline and Street's individual lane surfaces: each
view reveals the amount of physical structure it can actually support.

## Junction footprints

Where ways meet at a node, drawing every way at full width would overlap
messily. `src/geometry/junctions.ts` computes, per arm, how far to trim the
way back: sort the arms around the junction, intersect each arm's edge line
with its neighbor's, and trim to the farthest intersection (capped so a
tiny side street can't consume a long block). The trimmed arm ends are then
connected into the junction's surface polygon. Two collinear arms (a
segment boundary, not a real junction) get no polygon at all.

Trim distances feed back into lane derivation, so lanes visibly stop at the
junction edge. This trim-back approach follows the intersection algorithm
A/B Street documented for osm2streets.

## The lane-connectivity graph

A junction also carries meaning: which incoming lane may continue into
which outgoing lane. Defaults are derived by heuristic (through lanes pair
up index-aligned from the right; the leftmost approach lane may also turn
left, the rightmost also right; no U-turns), and the turn-lane editor
stores explicit connectors only once a junction is customized. Turn arrows
and the guide curves through the junction come from the same connectors,
since stored turn arrows could contradict the graph while derived ones
can't. The graph is also the foundation for future lane-level routing and
simulation.

## Routing

Service drawing and infrastructure adoption both ride
`src/model/routeGraph.ts`. The graph's vertices are junction nodes and way
endpoints; its edges are the way segments between them, weighted by length
and filtered to way types the service's mode can use. Path-finding is
Dijkstra's algorithm, with two refinements:

- **Mid-way anchors.** A click in the middle of a block shouldn't force
  the route to the nearest junction. The clicked point becomes a temporary
  vertex on that way, connected to the way's real vertices, so routes can
  begin and end anywhere along a way.
- **Corridor bias.** Adoption re-routes a service near its original
  sketch by discounting edges close to the sketched path, so among many
  plausible street routings the one following the user's drawing wins.

Committing a route turns it into the line's **legs** — one per way it runs
over, each naming which direction it travels that way and, where the route
begins or ends mid-block, how much of it the route covers. No control points
are inserted and no way is split, so routing a line over existing streets
leaves those streets exactly as they were.

This reverses an earlier decision, and it is worth saying why. Routing used to
materialize a mid-way anchor by splicing in a real control point and splitting
the way around it, so a pattern could go on naming whole ways. That kept the
service model uniform at the cost of changing the infrastructure: every split
extended every other rider's pattern, reanchored every station on the way, and
left a fragment behind for good. A busy corridor accumulated one fragment per
line that terminated on it, which is most of why a street carrying several
lines stopped reading as one street. Uniformity was the wrong thing to buy.

Interior span boundaries still need no extent, because the routing graph only
has vertices at way endpoints and junction-referenced points — consecutive
spans already meet at a genuinely shared coordinate. Only a route's own two
ends can land mid-way.

Routing honors one-way profiles. The graph reads each way's traversal from its
lane directions and pushes only the edges that traversal permits, so a two-way
street still gets both and a system with no one-way ways routes exactly as it
did. Two places create traversals and both are gated: a way's own segment
edges, and the four edges spliced in for an anchor that landed mid-block.

The same-way shortcut hands off to the graph rather than refusing. Two points
on a one-way street are still connected — by going round the block and back up
its couplet twin — and refusing there is what would make a couplet undrawable.

Callers choose how hard the rule bites. Drawing and adoption ask for
`preferLegal`, because a bare refusal is indistinguishable from a missed click:
they get the line with its wrong-way stretches marked. Import asks for `legal`,
because a GTFS shape already knows its direction and a miss should fall through
to fresh geometry.

That flag is feedback for the gesture in progress and nothing persists it — a
street made one-way _under_ an existing line never grows one. The durable
answer has to recompute from the profile.

Turn restrictions are honoured. A restriction is a fact about a PAIR of ways
meeting at a junction, so "may I leave along B" depends on how the route
arrived — which a plain per-vertex search state cannot express. The search
state is therefore the pair `(vertex, way arrived on)`: the edge-expanded graph,
done in the search rather than in the construction, so `buildGraph` stays a
description of the network instead of a description of the ways through it. The
extra states are bounded by junction degree and only appear where a junction
really has several arms.

Both records that can forbid a turn are per-LANE, and a route has not chosen a
lane yet. A turn is refused only when every lane of the arriving way forbids
it — over-refusing would send a line the long way round a junction it is
allowed to cross, which is worse than letting one through that a lane-level
check would later catch. An absent connector list permits everything, because
connectors are derived by heuristic when unset and enforcing our own guess
would refuse turns nobody forbade.

A route may now cover the same way twice, as long as the two visits do not
overlap in the same direction. Out along a street and back up a later block of
it is ordinary, and it is what routing round a couplet produces. What stays
rejected is two spans covering the same stretch the same way round, which would
draw one line twice and count the stations under it twice.
