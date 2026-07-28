# Project structure

TransitMapper is a pnpm workspace: a Vite + React + TypeScript single-page
app, an optional Cloudflare Worker backend for sharing, and a shared
domain-model package both depend on. The layering rule that organizes
everything: **model → store → rendering/UI**, with purity increasing toward
the model.

## Tree

```
packages/
  core/          The shared domain model — no DOM, no store, no React.
    src/
      model/     Pure domain: types, catalogs, geometry math, routing.
      geometry/  Pure derived geometry: lane offsets, junction footprints.
      sim/       Pure vehicle-motion kernel. No DOM; the host lives in web.
      testing/   Typed fixture builders for the test suites.
      share/     contract.ts — the wire shapes both the app and worker use.
                 claim.ts/ownership.ts are accounts groundwork (see below).
      auth/      Accounts groundwork: NOT WIRED UP (see below).
  pwa-updater/   The React hook behind the "new version available" prompt.
  tsconfig/      Shared compiler options. JSON only, no source.
  eslint-plugin/ Lint rules for invariants the compiler cannot express.
apps/
  web/           The Vite React SPA.
    src/
      editor/    The zustand store (all mutation) and the keyboard system.
      map/       MapLibre integration: layers, pointer interactions, canvas.
      camera/    Live map camera, held outside the domain system object.
      ui/        React components. Thin: read the store, call actions.
      style/     How catalog kinds LOOK (colors, widths, dashes, icons).
      share/     Export (PNG/SVG/JSON), the share card, the share-API client.
      storage/   Local persistence.
      perf/      DEV-only frame instrumentation. Never ships enabled.
    scripts/     verify.ts — the test suite.
  worker/        Cloudflare Worker + D1 migrations for shared snapshots.
    scripts/     verify.ts — the Worker's own suite (URL scoping, uploads).
docs/            This documentation.
```

### `packages/core/src/auth/` is built but not connected

`auth/` (Google OAuth URL building, PKCE, token hashing, cookie
serialization, return-path validation) and `share/claim.ts` +
`share/ownership.ts` are the first slice of the accounts feature on the
[roadmap](../../../ROADMAP.md). They are complete, pure, and covered by
`apps/web/scripts/verify.ts` — and **nothing imports them but that test
file.** There are no auth routes in the Worker, no users or sessions table,
and no owner column on `systems`.

This matters when reading nearby code, because several places already talk
about accounts as though they exist: `touchExpiry` in the Worker skips rows
with `expires_at IS NULL` "because they're account-owned", and migration
`0002` reserves that null for the same reason. Those are deliberate
preparation, not a feature you've failed to find. Today every share expires.

`@transitmapper/core` is consumed straight from source (no build step) via
subpath imports, e.g. `@transitmapper/core/model/catalog`. Both `apps/web`
and `apps/worker` depend on it as a workspace package.

## packages/core/src/model/ — the domain

- `system.ts` — every record in a saved document ([Data model](../../product/reference/data-model.md)).
- `catalog.ts` — every kind ([Catalogs](../../product/reference/catalogs.md)).
- `profile.ts` — pure cross-section operations: build/flip/one-way/derive
  capacity, separate/combine carriageway profiles.
- `geo.ts` — geographic math: projections, distances, polyline offsetting,
  point-in-polygon. `geo/servicePaths.ts` holds `patternSegments`, the one
  place that resolves a line's ways into ride order, direction, and the
  stretch of each it covers; `geo/corridorConflation.ts` decides which
  stretches of a path run along infrastructure that already exists.
- `routeGraph.ts` — the routing graph over ways and junctions;
  `routeBetween` finds paths for service drawing and adoption.
- `patternEdits.ts` — how a line's legs change, both when the infrastructure
  under them moves (a way split or merged) and when the line itself is edited
  (trimmed, cut in two, or a stretch of road taken out from under it). Pure:
  the store supplies the one measurement each edit needs and this decides what
  the legs become, so the arithmetic is testable without a system to test it
  against.
- `validate.ts` — system-level checks (crossings, dangling refs, a route with
  a gap in it) surfaced in the Issues popover.
- `serialize.ts` — versioned save/load with migrations (v3 → current).
- `import.ts` — OpenStreetMap import: pure tag classification plus the one
  Overpass fetch.
- `gtfsImport.ts` — GTFS import: shapes to ways, routes to services, stops to
  stations, batched so a large feed streams in rather than freezing the tab.
- `gtfsSchedule.ts` — how often an imported route runs, from `frequencies.txt`
  when the feed states it and from `stop_times.txt` departure times otherwise.
  Pure, so the derivation is testable without a feed.
- `diagramLayout.ts` — the Diagram view's schematic layout.
- `cost.ts` — rough cost estimation.
- `units.ts` — unit conversion and formatting (metric/imperial). Precise
  constants and locale-aware display via `Intl.NumberFormat`.
- `ids.ts` — id generation.

## packages/core/src/geometry/ — derived street geometry

- `streets.ts` — per-lane polylines, divider lines, and direction arrows
  derived from a way's profile; trimming at junctions.
- `junctions.ts` — junction footprints (arm trim-back, corner geometry),
  default lane connectors, connector curves.

Both are pure and memoized; nothing here is stored. See
[Geometry and routing](../../product/explanation/geometry-and-routing.md).

## packages/core/src/sim/ — the vehicle-motion kernel

- `timetable.ts` — builds a service's timetable from path length and dwell
  stops, and answers where a vehicle sits after a given elapsed time. Each leg
  between stops is its own accelerate/cruise/decelerate move rather than an
  instant jump to top speed — a closed-form calculation, so a leg too short
  to reach top speed costs no more than one long enough to cruise. Plain
  numbers in, plain numbers out: no DOM, no MapLibre, no store, and no
  allocation beyond the return value.

The animation is split across two packages on purpose. This half is the
arithmetic and lives here so it can be tested directly and ported to
WebAssembly later without dragging a browser dependency along; the
requestAnimationFrame and MapLibre host that drives it is
`apps/web/src/sim/vehicles.ts`.

## packages/core/src/testing/ — fixtures for the test suites

- `fixtures.ts` — typed builders (`aRoad`, `aPattern`, `aStation`) so a test
  never reaches for `as unknown as Way`. A double cast disables the compiler
  exactly where a test asserts behaviour: a cast fixture keeps compiling after
  a record gains a required field, describing something that cannot exist.

## packages/core/src/render/ — drawing a system without a map

- `buildFeatures.ts` — the system-to-styled-GeoJSON projector. Shared by the
  editor map, the embed, image exports and the share card, so none of them can
  drift from the others.
- `project.ts` — Web Mercator projection and `fitBounds`, matching MapLibre's
  conventions but needing no map. What a card is projected through.
- `svg.ts` — the vector composition (geometry plus title, legend, north arrow,
  scale bar). Takes a `project` callback, so an export can pass MapLibre's own
  while a card passes the map-free one.
- `preview.ts` — the share-card preset over `svg.ts`, and the card size.
- `pngBytes.ts` — validation for uploaded preview cards: size bound, PNG
  signature, exact dimensions, and a clean IHDR-to-IEND chunk chain.
- `legend.ts`, `scaleBar.ts`, `constants.ts`, `iconName.ts` — supporting
  pieces, all DOM-free.

## packages/core/src/style/ — how things are drawn

- `catalogStyle.ts` — the only place catalog entries' visual properties
  (color, width, dashed) live; `model/catalog.ts` stays pure domain data.
- `lvbtBrand.ts` — the org's brand tokens and typeface, transcribed from
  lasvegasfortransit.org/brand for anything rendered for the outside world.

See [Sharing surfaces](../../product/explanation/sharing-surfaces.md).

## packages/core/src/share/ — what a share is

- `contract.ts` — the request and response shapes of the share API,
  imported by both the React client and the Worker so the wire format lives
  in one place rather than twice.
- `ownership.ts` — the single place that decides a new share's owner and
  expiry. The two are always written together: a share with an owner has
  `expires_at` NULL, one without has a timestamp. Splitting that decision
  across call sites is how the two drift apart.
- `claim.ts` — decides what the browser keeps after trying to claim the
  anonymous shares it created. Pure, so the test suite can cover it: getting
  it wrong either loses a claimable share forever or retries a hopeless one
  on every page load.

## packages/pwa-updater/ — the update prompt

- `src/useAppUpdate.ts` — the React hook behind the "a new version is
  available" banner.

The service worker is registered as `prompt` rather than `autoUpdate`, and
registration happens by hand from `App.tsx`. Both are deliberate: the point
is a banner someone acts on, not a version swapped out from under them
mid-edit, and automatic registration would inject itself into the embed
entry too.

It is its own package rather than a file in `apps/web` because the hook and
the Vite plugin configuration are one concern, and because nothing about it
depends on the editor.

## packages/tsconfig/ — shared compiler options

- `base.json` — the compiler options every package extends.

JSON only. It ships no source, so `check:contract` does not ask it for
`lint`, `typecheck` or `verify`: there would be nothing for those scripts
to do, and writing three that do nothing is how a task list stops meaning
anything.

## packages/eslint-plugin/ — rules the compiler cannot express

- `src/core-runtime-purity.ts` — rejects browser-only globals in
  `packages/core`, which is typechecked against the browser and workerd
  both. The compiler cannot catch it, because core needs typings the two
  runtimes share and those arrive alongside browser-only ones.

Rules live here when the invariant is real, mechanical, and has no false
positives. An invariant that needs judgement stays in `AGENTS.md` with
**nothing** in its enforcement column, because a rule that fires on correct
code gets disabled and then enforces nothing.

See [the enforcement model](../explanation/enforcement-model.md).

## apps/web/src/share/ — exporting and publishing

Everything that turns a system into something that leaves the app.

- `api.ts` — talking to the Worker's share endpoints.
- `previewImage.ts` — draws the social card in the browser at share time.
  It lives here rather than in the Worker because a free-plan Worker has
  10ms of CPU per request and rasterizing a card measured ~65ms.
- `svgExport.ts`, `pngExport.ts`, `jsonExport.ts` — the download formats.
- `exportLegend.ts`, `exportScale.ts` — the legend and scale bar drawn onto
  an export, kept separate from the renderer so they can be tested without
  one.

See [Sharing surfaces](../../product/explanation/sharing-surfaces.md).

## apps/web/src/services/ — browser services and preferences

- `userPreferences.ts` — the central user preference system. Stores and
  retrieves user settings (unit system: metric/imperial) from localStorage,
  with browser locale-based defaults (imperial for en-US, my, en-LR; metric
  everywhere else). Exports hooks (`useUserPreferences`, `useUnitPreference`)
  for reactive preference access throughout the app.

## apps/web/src/i18n/ — internationalization and localization

- `messages.ts` — centralized message constants for all user-facing strings,
  organized hierarchically (settings, units, vehicle). Enables future
  integration with proper i18n libraries without refactoring UI components.

## apps/web/src/storage/ — the local library

- `localStore.ts` — a library of saved systems in `localStorage`, replacing
  a single-slot autosave where "New system" silently overwrote the only one
  there was. Each system has its own key so switching never touches the
  others, and a small index holds just id, name and timestamp so the list
  renders without loading every system in full.

## apps/web/src/sim/ — the running simulation

- `simClock.ts` — the `SimClock`: simulated time, and the only value in the
  app that changes 30 times a second. Created by `ui/SimProvider.tsx` and
  injected, never a module-level singleton.
- `vehicles.ts` — the animation host. Advances the clock, asks
  `packages/core/src/sim/` where every vehicle is, and writes a GeoJSON source
  directly rather than going through React, because it updates every frame and
  reconciliation at that rate is the thing that would make it stutter.
- `devHandle.ts` — `window.__sim`, a development-only clock driver.

The pure half lives in `packages/core/src/sim/` (`clock.ts`, `timetable.ts`),
so the whole simulator is reachable from `pnpm verify` with no browser. See
[The simulation](../../product/explanation/simulation.md).

## apps/web/src/embed/ — the embeddable map

- `main.ts` — a second Vite entry (`embed.html`, served at `/e/:id`) that
  mounts MapLibre and the feature builder and nothing else: no React, no
  editor store. Kept deliberately small because it loads inside someone
  else's page.

## apps/worker/src/ — the Worker

- `index.ts` — share create/fetch, the GTFS proxy, per-share preview images,
  oEmbed, the embed and share-page routes with their framing headers, and the
  nightly expiry sweep.

Preview cards are drawn by the browser (`apps/web/src/share/previewImage.ts`)
and stored in D1, because a free-plan Worker hasn't the CPU to rasterize one.
See [Sharing surfaces](../../product/explanation/sharing-surfaces.md).

## apps/web/src/editor/ — mutation and input

- `store.ts` — the single zustand store. Every change to the system goes
  through an action here; undo checkpoints, junction bookkeeping, station
  re-anchoring, and NamedWay upkeep all live in the actions.
- `keymap.ts` — the declarative keyboard table
  ([Keyboard shortcuts](../../product/reference/keyboard-shortcuts.md)).

## apps/web/src/map/ — MapLibre

- `layers.ts` — turns the system into GeoJSON sources and layers per view;
  owns paint order (street surfaces below footprints, labels on top).
- `interactions.ts` — the pointer state machine: drawing, dragging,
  snapping, route drafting, station-land drawing.
- `MapCanvas.tsx` — the map component; keeps sources in sync with the store
  and heals overlay layers if the style reloads.
- `layers/` — the layer specifications and icons `layers.ts` assembles.
- `export/` — rendering the map to an image off-screen.
- `basemap.ts`, `icons.ts`, `landmarks.ts`, `mapRef.ts`,
  `selectionFocus.ts` — supporting pieces.

## apps/web/src/camera/ — where the map is looking

- `liveCamera.ts` — the live map camera, held in a module-level holder
  outside the domain `system`. There is one map per session, and the value
  mirrors that map, so a store or a context would buy nothing.
- `cameraPersistence.ts` — folds the live camera into the saved library
  entry on a debounce, and does not touch `updatedAt`.

The camera is presentation state, not domain data, and separating the two
is a performance decision as much as a modelling one. While the camera
lived in `system`, every pan minted a new `system` reference, which made a
drag frame look like a content edit to the renderer subscription, every
mounted selector, and autosave alike. Moving it out cost the saved-viewport
behaviour, which `cameraPersistence.ts` restores deliberately rather than
by making the camera reactive again.

## apps/web/src/perf/ — measuring frames

- `frameStats.ts` — summarises frame durations. Reports the median rather
  than the mean, plus p95, worst, and the fraction of frames over the 60Hz
  and 30Hz budgets.
- `frameMeter.ts` — samples painted-frame intervals from MapLibre's render
  event, because the map paints on demand and a plain animation-frame
  counter keeps ticking when nothing is drawn.
- `panBench.ts` — a scripted pan and zoom in the same shape as a real drag.
  Deterministic input is what makes two runs comparable, so "feels
  smoother" becomes a number.
- `index.ts` — wires the above to `window.__panBench`, `window.__perf` and
  friends for use from devtools.

None of this ships enabled. The only caller guards on the DEV flag and
`index.ts` no-ops again on its own.

## apps/web/src/ui/ — components

`Workbench.tsx` is the shell that arranges everything; `Toolbar.tsx` is the
bottom dock; `Inspector.tsx` (with `NodeInspector.tsx`,
`CrossSectionEditor.tsx`, `InspectorTabs.tsx`) is the right-hand panel;
plus dialogs (export, import, share, schedule, systems) and primitives
(popover, modal, dropdown). Components hold no domain logic.

## Testing

`pnpm verify` runs `apps/web/scripts/verify.ts`: hundreds of deterministic
checks over the model, profile operations, migrations, junction geometry,
routing, store actions, and layer emission. No browser required.
`pnpm typecheck` covers `packages/core`, `apps/web`, and `apps/worker`. Both
must pass before a PR. Each command fans out per-package via Turborepo.
