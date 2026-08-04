# Work with intersections

Junctions form and maintain themselves; your job is deciding what they mean.

## How junctions form

- Finish drawing a way across another way of the same type and grade and both
  split at the crossing; the shared point becomes a junction with four arms.
- Dragging a way's endpoint across other ways on release does the same.
- Snapping an endpoint onto another way while drawing joins them at that
  point.
- Different grades never auto-join: an elevated road crossing a surface
  street is an overpass. Set grade in the drawing tool's options row or on
  the way afterward.
- Different types never join either, at any grade. A junction says which of
  one arm's lanes feed which of another's, and a road and a rail line have no
  lanes in common. Draw a road across a light-rail line and you get two
  independent ways that cross — which is what a level crossing is, even
  though nothing draws one as such yet.

At close zoom in the Infrastructure view, a junction renders as a real
footprint: each arm's lanes trim back and the shared asphalt fills the
middle, with per-lane guide curves showing which lane continues where.

## Edit turn lanes

Click a junction footprint with the Select tool. The junction inspector has
three tabs:

- **Turn lanes** lists each approach (lanes that travel _into_ the
  junction), left-to-right as a driver sees them. The arrows on each lane
  toggle whether that lane may turn left, go straight, or turn right; each
  toggle edits the real lane-connectivity graph, and the guide curves on the
  map update as you click. "Reset to automatic" discards your custom
  connectors and returns to the derived defaults.
- **Control** sets the junction's traffic control: none, signal, stop, or
  roundabout. (Control is stored and editable today; distinct rendering for
  each is still on the roadmap.)
- **Connections** lists every way meeting here. See below.

The default connectivity, when you haven't customized a junction: through
lanes match up straight across, the leftmost approach lane also turns left,
and the rightmost also turns right.

## Take a way out of a junction

The **Connections** tab lists one row per way at the junction, named and
typed. The button beside a row disconnects that way: its control point moves
about 12 m clear of the others, so the two corridors stop sharing a point and
stop sitting on top of each other. Nothing else moves — the arms that stay
keep their geometry, and any turn lanes that fed the departing way are
dropped, since there is nothing left to feed.

A junction needs at least two arms. Disconnect one arm of a two-arm junction
and the junction itself is gone; a six-arm intersection sheds one arm and
carries on with five.

Junctions that already join ways of different types — from an older document,
or from an OSM import — are reported in the issues list in the top bar.
Clicking the issue selects the junction, and the Connections tab is where you
fix it.

## Grade separation

Set a way's grade to Elevated _before_ drawing it across another, and no
junction forms in the first place. Changing grade afterward does not un-form
a junction that already exists.

Disconnecting in the Connections tab does separate the two, but a crossing
that formed a junction was split into arms at that point, and each arm now
ends 12 m short of where it used to meet. Rebuilding that into a clean
overpass means tidying the geometry by hand. A grade change that re-forms the
crossing on its own is still on the roadmap.
