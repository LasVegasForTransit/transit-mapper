# Import streets from OpenStreetMap

Rather than tracing a whole city by hand, you can pull real infrastructure
from OpenStreetMap into your system and plan on top of it.

## Import

1. Open the File menu and choose **Import real streets** (or open the Import
   dialog from wherever you are).
2. Frame the map on the area you want first. The import covers the current
   viewport.
3. Pick categories: Streets, Heavy rail, Light rail / tram, Bike
   infrastructure.
4. Click **Import into this system**.

The import queries the Overpass API (a free public service; large areas can
be slow or get rate-limited, so start with a neighborhood, not a metro).

## What you get

Imported ways are ordinary ways, identical to hand-drawn ones except for a
provenance marker. OSM's road grades map onto the catalog's road classes:
motorways come in as transitways, primary/secondary roads as arterials,
residential streets as locals.

Each road's cross-section is read from OSM's own lane tagging rather than
defaulted from its type:

- `oneway` decides whether the street is one-way, so a divided road's two
  carriageways come in as two one-way streets instead of two two-way ones.
- `lanes`, `lanes:forward`, and `lanes:backward` set how many travel lanes
  run each way.
- `lanes:both_ways` becomes a shared centre turn lane.
- `turn:lanes` marks turn-only lanes as turn pockets, when its lane count
  matches. A lane that can also go straight (`through;right`) stays an
  ordinary travel lane.
- `sidewalk`, `sidewalk:left`, and `sidewalk:right` decide which sides get a
  sidewalk. `separate` means OSM maps the footway as its own way, so none is
  drawn here.

Where OSM says nothing, the way's class supplies a lane count — a local
street comes in narrower than an arterial. Rail and bike ways keep their
catalog defaults; `lanes` and `turn:lanes` are road vocabulary.

The street grid arrives **connected**: where OSM says two ways meet, they
come in sharing a real junction, so you can route services across an
imported network immediately rather than joining every intersection by hand.
Junctions come from OSM's own node identity, not from coordinates that
happen to line up, which means overlapping-but-separate infrastructure stays
separate — a tram line drawn down the middle of a street does not get welded
to the roadway, and a bridge does not get welded to the road beneath it.

Imported ways start as bare infrastructure carrying no service. From there
the normal tools apply: route services over them, edit their lanes, adjust
junctions, adopt them under existing sketches.

## Practical notes

- Import is additive; running it twice over the same area duplicates ways.
  Undo reverses an import in one step.
- Junctions are formed **within** an import, not against what's already on
  the map. If you import over streets you drew yourself, the two networks sit
  side by side without joining; connect them with the usual editing tools.
- A way clipped by the edge of the viewport keeps only the junctions inside
  it. Its continuation lives outside the box you imported, so re-importing a
  wider area is how you pick up the rest.
- Crossings that stay unjoined are usually correct: OSM records a bridge or
  tunnel as genuinely not meeting the road it passes over.
- Lane order assumes right-hand traffic. A left-hand-traffic import comes in
  mirrored and needs flipping.
