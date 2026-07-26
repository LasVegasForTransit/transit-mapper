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
- **Direction-aware routing.** Services respect one-way lanes instead of routing against traffic.
- **Junction visuals.** Rounded curb returns and painted approach arrows at intersections.
- **Richer OSM import.** Pull real lane counts and turn restrictions from map data, beyond plain
  street geometry.
- **Schematic auto-layout.** An option to lay out the classic angular transit-diagram look
  automatically from a real geographic network.
- **More catalog coverage.** New modes and infrastructure types as real-world systems surface gaps.

## Phase 2: Planning & Analysis

This is where sketching starts turning into real planning and advocacy work.

- **Ridership sketching.** Estimate how many people a proposed line might actually serve.
- **Travel-time comparisons.** See how a proposed system changes trip times across the region.
- **Snap-to-streets routing.** Sketch a line freely and have it settle onto the real street and
  track network automatically.

## Phase 3: Collaboration

- **Real-time collaboration.** Multiple people editing one system together.

## How to help

TransitMapper is open source, and contributions are welcome. See
[CONTRIBUTING.md](CONTRIBUTING.md) for how to report a bug, suggest a
feature, or submit a change. If a roadmap item above is missing context
you'd need to pick it up, open an issue and ask.
