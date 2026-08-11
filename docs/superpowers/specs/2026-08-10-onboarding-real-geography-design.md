# Real-geography onboarding scenes

## Problem

The purpose-first onboarding sequence now says what TransitMapper is, but its
Port Mason fixture still looks like a generic diagram. A ruler-straight river,
rectangular districts, anonymous street polygons, and repeated finished-state
screens do not support the promise that TransitMapper works on a real map.
The passive drawing and simulation scenes are also easy to miss after their
motion settles, the infrastructure scene does not identify the part the plan
adds, and the Schedule preview clips its service-hours controls.

## Decision

Replace Port Mason with a fixed central Las Vegas proposal built on a committed
OpenStreetMap-derived snapshot. Runtime onboarding remains local,
deterministic, and non-interactive; generating or refreshing the snapshot is a
maintainer action, not a request made by the dialog.

The local snapshot is preferable to two alternatives:

- A remote basemap would look authentic when it loaded but would make the
  introduction depend on another network request and make review captures
  nondeterministic.
- Reusing the current document would match the selected place but would make
  every first-run lesson depend on import success, local data density, and the
  person's unfinished work.

The preview continues to use production feature projection and simulation.
OpenStreetMap attribution uses the same compact MapLibre control treatment as
the editor rather than an onboarding-only badge.

## The central Las Vegas proposal

The example is a fictional proposal on real geography. It contains:

- the actual Charleston Boulevard and Las Vegas Boulevard alignments between
  the Medical District, Downtown, and Huntridge;
- the actual rail corridor through the Arts District and Symphony Park;
- enough surrounding named streets from the same snapshot to read as central
  Las Vegas rather than an isolated route diagram;
- an orange **Charleston Crosstown** bus service with Downtown and Huntridge
  patterns;
- a blue **Downtown Connector** light-rail service that reuses the existing
  rail corridor and adds one connection into Downtown;
- a shared Downtown transfer, varied stops, a ten-minute bus frequency, and
  schedules that produce a real vehicle requirement.

The system remains a valid `TransitSystem`. Imported streets and the reused
rail corridor carry OpenStreetMap provenance. The new Downtown rail connector
does not, because it is the proposal's authored infrastructure.

## Scene behavior

### Welcome

Show the completed central Las Vegas proposal over the real street snapshot.
The existing approved title, definition, invitation, and action remain.

### Draw

Use the production route-preview source and paint while a crosshair follows the
actual Charleston Boulevard path. The final service replaces the preview when
the gesture completes. Motion still settles once; review evidence captures the
start, midpoint, and result so the literal drawing action is visible without
adding a replay control.

### Infrastructure

Render the same system in the production Infrastructure projection. Highlight
the authored Downtown connector with the production way-selection state;
remove the onboarding-only blue dashed link layers. Existing streets and rail
remain ordinary imported infrastructure. The copy names the selected
connection as the part the proposal adds.

### Operations

Keep the production Service inspector Schedule presentation. Use visible
labels that work for both audiences: **Frequency · peak headway** and
**Service hours · span of service**. The explanatory sentence says “time at
stops” and “running that often” before relying on planner vocabulary. Give the
embedded inspector enough width and a bounded scroller so all values remain
reachable without clipping the scene.

### Simulation

Keep vehicles from the real simulation kernel and add a read-only instance of
the production simulation transport presentation. Its running state, speed,
and advancing clock make the moving dots unambiguously vehicles. Reduced
motion shows the same real controls at one representative time with vehicles
held still.

## Responsive behavior

At phone widths, the onboarding sheet occupies a fixed 92-dynamic-viewport
height. The explanation and scene scroll inside it while the progress and
Back/Next actions stay visible. The operations inspector may extend inside the
body scroller, but it may not push the footer below the viewport.

Place labels prioritize Medical District, Downtown, and Huntridge on narrow
maps. Secondary labels may hide only when the street context still makes the
proposal legible.

## Data and file boundaries

- `fixtureSystem.ts` owns the stable Las Vegas proposal and simulation inputs.
- `las-vegas-context-data.json` is the generated, clipped local street
  snapshot.
- `las-vegas-context.ts` validates/adapts that data into GeoJSON used by the
  preview.
- `scripts/generate-onboarding-las-vegas-context.ts` documents the bounding
  box, selected street classes, OpenStreetMap query, clipping, and output.
- `onboarding-map-controller.ts` adapts scene frames to production sources,
  selection state, attribution, and MapLibre lifecycle.
- `SimControls.tsx` exports a pure production transport presentation used by
  both the live editor and the passive onboarding adapter.

No generated map record enters the saved document, undo history, or editor
selection. Onboarding still changes editor state only when a genuine first run
arms the Bus tool.

## Verification

Automated coverage must prove:

- the proposal is valid, geographically bounded in central Las Vegas, and
  contains the two named services and real imported infrastructure;
- the context includes enough named, non-grid street geometry to be
  recognizable and retains OpenStreetMap provenance metadata;
- drawing uses the production preview source and settles on the exact service
  path;
- Infrastructure highlights only the authored connector through production
  selection state;
- the shared simulation presentation renders a running state, speed, and real
  formatted time;
- the shared Schedule labels use public-first language without dropping the
  planning terms;
- phone layout keeps navigation visible while the body and inspector scroll.

Visual review must capture all five screens at desktop and 390 by 844 pixels,
plus drawing start/midpoint/result frames and at least two simulation times.
The screenshots must show no development overlay or onboarding-only imitation
of product controls.
