# Roadmap

TransitMapper lets anyone design a regional transit system on a real map. Sketch lines the way you'd
sketch them on a napkin, then build out the physical network underneath. It started as a tool for
[Las Vegans for Better Transit](https://lasvegasfortransit.org), but nothing in it is specific to one city.

This roadmap covers where the project is headed, in three phases. Phases run in order, and later
work doesn't get pulled forward ahead of earlier work without a deliberate reason to reorder.

## Shipped

- **A unified, catalog-driven model for every mode.** Subway, light rail, monorail, bus, tram,
  bike, ferry, and gondola all fit one data model, with no hardcoded transit types. Adding a new mode
  means adding a catalog entry, not rewriting the editor.
- **Two views of the same system.** Network view is the clean schematic map. Infrastructure view
  shows the physical world underneath: lane-by-lane cross-sections, real junction geometry, station
  land and structures.
- **A real road and rail editor.** Draw a street or a track and it behaves like the real thing: lane
  counts, one-way streets, divided boulevards, intersections that build themselves with computed
  turn lanes.
- **Real-world data.** Import streets from OpenStreetMap and draw your system over them, or pull in
  an agency's actual GTFS feed as a comparison baseline.
- **A running simulation.** A simulated clock you can pause and speed up, with vehicles that run at
  the headways and spans your schedules actually specify. Set a line to every ten minutes and its
  stops are served every ten minutes; overlap two of them and the shared stop reports what they
  add up to. Imported GTFS feeds bring their real service levels with them, so an agency's own
  network animates at the frequencies it actually runs.
- **Share and fork.** Publish a read-only link to any system; anyone can view it and fork their own
  editable copy.
- **Links that look like something.** Paste a share link into Slack, Discord, or iMessage and the
  preview shows the actual system. The card is drawn when the link is created and served as a
  plain image, so it works even for crawlers that never run JavaScript.
- **Embeddable maps.** Drop a live, read-only map into a blog post with an iframe, or just paste
  the link on a platform that speaks oEmbed and let it build the embed for you.
- **A production home.** TransitMapper runs in production on its own domain, with automatic deploys
  on every change.

## Phase 1: Advocacy & Sharing

This phase makes a shared TransitMapper link work well anywhere it's pasted, and rounds out the sandbox.

- **Accounts.** Sign in with Google. Moved up from Phase 3: anonymous share links expire after a
  week, and an embedded map that 404s a week after publication is worse than no embed at all. Rich
  previews and embeddable maps have both shipped now, and they're worth little without this.
- **Permanent shares.** A signed-in person's share links never expire, and links they published
  before signing in can be adopted without changing their URLs. Anonymous links currently last a
  week from their last view, which keeps a map alive while people are reading it — but a system
  worth keeping shouldn't depend on someone happening to open it.
- **An installable app.** Add TransitMapper to your home screen like a native app.
- **Junction visuals.** Rounded curb returns and painted approach arrows at intersections.
- **Richer OSM import.** Pull real lane counts and turn restrictions from map data, beyond plain
  street geometry.
- **Schematic auto-layout.** An option to lay out the classic angular transit-diagram look
  automatically from a real geographic network.
- **More catalog coverage.** New modes and infrastructure types as real-world systems surface gaps.

## Phase 2: Planning & Analysis

This is where sketching starts turning into real planning and advocacy work.

- **Ridership sketching.** Estimate how many people a proposed line might actually serve. This is
  the point where the simulation has to start remembering what happened — crowding and bunching
  are consequences of history, and today's simulator deliberately keeps none. See
  [The simulation](docs/product/explanation/simulation.md).
- **Travel-time comparisons.** See how a proposed system changes trip times across the region.
- **Snap-to-streets routing.** Sketch a line freely and have it settle onto the real street and
  track network automatically.

## Phase 3: Collaboration

- **Real-time collaboration.** Multiple people editing one system together.

## Engineering: every default belongs to the user layer

The model is catalog-driven so that adding a mode means adding a catalog entry. That promise only
holds if the code between the user and the data stops making decisions of its own. An intermediate
step — an importer, a store action, a placement handler — should never be the thing that decides
what kind of infrastructure something is, how big it is, or when it runs. Where a value is a fact
about the world it belongs in the catalog; where it's a choice, it belongs to the person making it.

A first pass moved three of these into the catalog: the starting draft selection (`INITIAL_DRAFT`),
the size a click-placed area facility gets (`FacilityType.defaultHalfExtentM`), and the lane count
assumed for a street known only from an imported route trace (`WayType.importedCapacity`). The rest
is still outstanding, roughly in order of how badly it misleads people.

- **Importers must not guess a mode.** `DEFAULT_ROUTE_KIND` in `model/gtfsImport.ts` files any
  unrecognized GTFS `route_type` as a bus on a road, and `model/import.ts` does the same for OSM ways
  that don't match its tag rules. A feed that trips this produces a map that looks authoritative and
  is wrong, with nothing on screen saying so. Surface the unrecognized types and let the import
  dialog resolve them, or take the fallback as a required argument from that dialog — but don't let
  the parser pick.
- **Timetables must not be invented.** `DEFAULT_FREQUENCY_MINUTES`, `DEFAULT_SPAN_START`, and
  `DEFAULT_SPAN_END` in `editor/store.ts` fabricate a 10-minute headway running 06:00–23:00 for every
  new service. Nobody asked for that, and it's the number a reader will quote back. Either a mode
  declares a plausible starting service in the catalog, or a service starts with no schedule and says
  so.
- **Synthesized geometry inherits real decisions.** `materializeShapeRun` still hardcodes
  `geometry: "straight"` and `grade: "atGrade"` for ways it builds from an imported trace — the same
  class of problem `importedCapacity` just fixed, in the same function.
- **Catalog accessors shouldn't substitute.** `facilityType()` returns the entrance type for any id
  it doesn't recognize, and the other accessors have matching fallbacks. That tolerance exists so bad
  data can't crash the app, which is right, but it currently does it by silently becoming a different
  thing. Make the substitution visible to the caller instead of indistinguishable from a real hit.
- **Ban the pattern, don't just fix the instances.** Add an ESLint rule to `packages/eslint-plugin`
  that fails on catalog id string literals (`"lightRail"`, `"road"`, `"bus"`, …) outside the catalog
  itself. Every item above was introduced by someone reasonably typing an id where they needed one;
  a rule is the only thing that stops the next one.
- **Hardcoded id switches.** `geo/serviceLane.ts` switches on mode ids to pick lane kinds, and
  `model/import.ts` hardcodes `IMPORT_CATEGORY_ORDER` and its road/rail/bike category mapping. Both
  should be declared on the catalog entries they describe.
- **Input tuning should be adjustable.** The five scattered literals in `map/interactions.ts` are
  now one declared table in `editor/input-tuning.ts`, with a coarse-pointer profile selected from
  the device's own pointer capability, so a finger no longer gets tolerances sized for a mouse.
  What remains is letting people change them: pointer precision varies enormously between a
  trackpad, a mouse, and a hand that shakes, and even a well-chosen default is a decision made on
  someone else's behalf. The table is injected through `attachInteractions`, so a settings override
  has somewhere to write.
- **Presentation sizes come from whoever asked for the picture.** `exportRenderer.ts` falls back to
  1600×1000 and `DEFAULT_VIEWPORT` decides where a document opens. Both should come from the export
  dialog and the document respectively.
- **Retune the facility extents.** They're per-type in the catalog now but all still carry the single
  15m half-extent they inherited. A platform and a depot should not be the same size; that's a design
  pass, not a refactor.

## Engineering: opt-in performance evidence

- **Anonymous performance telemetry, only after explicit opt-in.** The local and CI harness can show
  which operations are slow on its known machines, but not which devices people actually use.
  A future setting may send an allowlisted set of timings, coarse device/browser capability buckets,
  counters, and the app version. It starts off, explains the payload before consent, and can be
  turned off again. It never sends document contents, system or route names, coordinates or
  geometry, share ids, URLs, search/import terms, account identifiers, or a persistent
  device/fingerprint id. Adding any field outside that allowlist requires a new privacy review and
  updated consent copy; “anonymous” is not permission to quietly widen the payload.

## How to help

TransitMapper is open source, and contributions are welcome. See
[CONTRIBUTING.md](CONTRIBUTING.md) for how to report a bug, suggest a
feature, or submit a change. If a roadmap item above is missing context
you'd need to pick it up, open an issue and ask.
