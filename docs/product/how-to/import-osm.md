# Import streets from OpenStreetMap

Rather than tracing a whole city by hand, you can pull real infrastructure from OpenStreetMap into
your system and plan on top of it.

## Import

1. Open the File menu and choose **Import real streets** (or open the Import dialog from wherever
   you are).
2. Frame the map on the area you want first. The import covers the current viewport.
3. Pick categories: Streets, Heavy rail, Light rail / tram, Bike infrastructure.
4. Click **Import into this system**.

The import queries the Overpass API (a free public service; large areas can be slow or get
rate-limited, so start with a neighborhood, not a metro).

## What you get

Imported ways are ordinary ways, identical to hand-drawn ones except for a provenance marker. OSM's
road grades map onto the catalog's road classes: motorways come in as transitways, primary/secondary
roads as arterials, residential streets as locals.

Each road's cross-section is read from OSM's own lane tagging rather than defaulted from its type:

- `oneway` decides whether the street is one-way, so a divided road's two carriageways come in as
  two one-way streets instead of two two-way ones.
- `lanes`, `lanes:forward`, and `lanes:backward` set how many travel lanes run each way.
- `lanes:both_ways` becomes a shared centre turn lane.
- `turn:lanes` marks turn-only lanes as turn pockets, when its lane count matches. A lane that can
  also go straight (`through;right`) stays an ordinary travel lane.
- `sidewalk`, `sidewalk:left`, and `sidewalk:right` decide which sides get a sidewalk. `separate`
  means OSM maps the footway as its own way, so none is drawn here.
- `busway` (and `busway:left` / `busway:right`) adds a bus lane at that kerb. These are additional
  to the `lanes` count, not carved out of it, which is how OSM tags them.
- `parking:lane:<side>` and the newer `parking:<side>` add an on-street parking lane at that kerb,
  outboard of any bus lane.
- `cycleway` (and `cycleway:left` / `cycleway:right`) adds a bike lane for the case where OSM tags
  the lane on the roadway instead of drawing it as its own way. `separate` means it _is_ drawn
  separately and imports on its own, so no lane is added here.

Kerb inwards, a side reads: sidewalk, parking, bike, bus, then travel lanes.

Where OSM says nothing, the way's class supplies a lane count — a local street comes in narrower
than an arterial. Rail and bike ways keep their catalog defaults; `lanes` and `turn:lanes` are road
vocabulary.

The street grid arrives **connected**: where OSM says two ways meet, they come in sharing a real
junction, so you can route services across an imported network immediately rather than joining every
intersection by hand. Junctions come from OSM's own node identity, not from coordinates that happen
to line up, which means overlapping-but-separate infrastructure stays separate — a tram line drawn
down the middle of a street does not get welded to the roadway, and a bridge does not get welded to
the road beneath it.

Junctions arrive **controlled** where OSM records it. `highway=traffic_signals` becomes a signal and
`highway=stop` a stop sign; a way tagged `junction=roundabout` makes the junctions along it
roundabouts. OSM usually puts a signal on the approach at the stop line rather than on the
intersection itself, so a control node found shortly before a junction along its own way is taken to
govern that junction.

A **divided street** arrives as its two carriageways under one identity, with the median between
them measured and captured — so the Combine carriageways button works on it straight away, and
combining restores the real gap rather than a generic default. Pairing is mutual: two carriageways
only pair if each is the other's best match, so a frontage road running alongside can't claim one.
Segments with no partner keep the ordinary whole-street identity.

Streets arrive **named**. OSM splits one street into a way per block and per direction, all carrying
the same `name`, and those become a single shared identity — so the objects list reads "West
Flamingo Road 1…12" instead of "Road 1…12", and renaming the street renames all of it.

**Turn bans** come in too. OSM records these as relations naming a street you turn from, the
junction, and the street you'd turn into; each becomes a restriction on the approaching lanes saying
which arms they may still feed. Only bans pivoting on a single junction are read — one describing a
movement through a whole link has no per-lane expression — and a ban only lands on lanes that could
make the turn, never on a kerbside bike lane.

Ways arrive at their real **grade**: `bridge` comes in elevated, `tunnel` underground, and a way
with only a `layer` follows its sign. Two ways at different grades are never reported as needing a
junction between them.

Imported ways start as bare infrastructure carrying no service. From there the normal tools apply:
route services over them, edit their lanes, adjust junctions, adopt them under existing sketches.

## Practical notes

- Import is additive but not duplicative: a street this system already imported is skipped, and the
  dialog says how many it skipped. Undo reverses an import in one step.
- Importing again with more categories ticked adds the new infrastructure to the junctions you
  already have rather than laying a second set on top.
- Importing a neighbouring area joins it to what you already have. Overpass returns a street whole
  whenever any of it falls in the box, so the shared boundary streets are recognised and the
  junction at the seam is formed against the copy you already had.
- A street you have edited since importing is still recognised, so it won't duplicate — but no new
  junction is placed on it, since its shape is now yours rather than OSM's.
- Junctions are formed **within** an import, not against what's already on the map. If you import
  over streets you drew yourself, the two networks sit side by side without joining; connect them
  with the usual editing tools.
- A way clipped by the edge of the viewport keeps only the junctions inside it. Its continuation
  lives outside the box you imported, so re-importing a wider area is how you pick up the rest.
- Crossings that stay unjoined are usually correct: OSM records a bridge or tunnel as genuinely not
  meeting the road it passes over.
- Under left-hand traffic, forward traffic is placed on the left half of a two-way street. Sides
  read from OSM — which kerb has the sidewalk, the bike lane, the bus lane, the parking — do not
  move with the setting: OSM names those sides relative to the street's own direction, the same in
  every country. Changing the setting afterwards doesn't restack ways already imported.
- Overpass is a free shared service that is often busy. The import tries more than one public server
  before giving up, so a slow import is usually it falling through to a second one rather than
  anything being wrong. If it does fail, it's nearly always transient — try again.
- A turn ban is skipped when it names a street the import didn't bring in (a service road, a link
  road), since the remaining arms wouldn't describe the real junction.
- A stop sign sets the control for the whole junction. OSM records which approach the sign faces;
  the import doesn't carry that through, so set per-approach control by hand where it matters.
