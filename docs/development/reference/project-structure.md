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
      perf/      Frame instrumentation plus pure fixtures/report/budget policy.
    perf/        Checked desktop and mobile browser-performance baselines.
    scripts/     verify.ts plus the production Chrome/output performance tools.
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
- `units.ts` — conversion and locale-aware formatting between the metric
  values stored by the model and the units selected for display.
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
  drift from the others. Its public coordinator selects named topology,
  station, selection-handle, physical-detail, label, and facility phases; a
  partial live-map refresh does not weave source-specific conditions through
  one monolithic projection pass.
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

## apps/web/src/services/ — browser preferences

- `userPreferences.ts` — browser-local settings, including the selected unit
  system. A cached external-store snapshot lets React consumers update
  together without moving preferences into the domain model.

## apps/web/src/i18n/ — user-facing messages

- `messages.ts` — strings shared by the settings and vehicle-kind surfaces,
  grouped by the feature that owns them.

## apps/web/src/storage/ — the local library

- `indexedDbLibrary.ts` — the primary document database. Complete serialized
  systems and their lightweight library rows live in separate object stores
  and are updated atomically, so listing many RTC-sized systems never reads
  their document bodies.
- `libraryStore.ts` and `browserLibrary.ts` — the storage boundary. They
  serialize through a dedicated Worker, migrate old `localStorage` documents
  only after IndexedDB commits, and distinguish unavailable storage from a
  genuinely empty library.
- `localStore.ts` — the backward-compatible reader and emergency fallback for
  documents created before IndexedDB. It also makes a best-effort synchronous
  close-time copy when a document fits the browser's quota. The marker stored
  atomically with that copy makes an equal-timestamp camera snapshot
  authoritative on recovery; localStorage is not the primary store for new
  saves.
- `bootstrapLibrary.ts` — startup recovery policy. An IndexedDB failure never
  becomes a new blank document or changes the active-document pointer.
- `persistenceCoordinator.ts` — coalesces content and camera changes into one
  ordered save lane and drains it without stranding a snapshot. It retains
  undurable and failed state per document across document switches. Camera
  movement is presentation state and does not change a library entry's
  `updatedAt`; content edits do.

## apps/web/src/perf/ and apps/web/scripts/perf/ — measured performance

`src/perf/` owns deterministic small, dense, and RTC-shaped fixtures; the
named report schemas; pure statistics and budget evaluation; bundle/PWA graph
policy; direct-manipulation instrumentation; and the large-document storage
thresholds. Vite includes the browser harness only in development or when the
runner builds with `VITE_PERF_BUILD=1`; a private per-navigation flag then
selects automated measurement instead of the developer overlay. Ordinary
production bundles do not include that harness. `frameMeter.ts` and
`paintedFrameCapture.ts` sample
actual MapLibre renders rather than idle animation frames; `panBench.ts`
retains a deterministic attribution path alongside the trusted-input gate.

`scripts/perf/run.ts` is a small process entry. `orchestrator.ts` sequences the
fixed suite; `cli.ts` and `process.ts` own arguments and preview-process
lifecycle; `browser.ts` and `browserContract.ts` own Chrome protocol and page
instrumentation; `journeys.ts` and `scenarioRuns.ts` own trusted interactions
and cold/warm repetitions; `offline.ts` and `soak.ts` own their specialized
proofs; and `artifacts.ts` writes reports and checked baselines. The diagnostic
storage probe keeps compatibility parse, stringify, and `localStorage` write
costs separate; editor journeys seed and read back real IndexedDB records.
`report-bundle.ts` and `verify-pwa-output.ts` inspect production output after
Vite builds it.

The checked reports in `apps/web/perf/` are reviewable comparison evidence.
Generated traces and current reports live under
`apps/web/artifacts/performance/` and are ignored. This suite is deliberately
outside `pnpm check`, whose browser-free and network-free contract remains
unchanged. See [Measure browser performance](../how-to/measure-performance.md).

## apps/web/src/import/ — bounded browser imports

Large GTFS archives are downloaded once and transferred to `gtfs.worker.ts`,
which parses them and emits bounded batches so store commits can yield between
them. Reconciliation runs in a second Worker because corridor matching is also
CPU-heavy. The protocol files contain the typed message boundaries; the
`streamRtcGtfs.ts` and `reconcileRtcGtfs.ts` hosts own cancellation, timeouts,
progress, and Worker cleanup.

This boundary keeps archive parsing and reconciliation off the main thread
without moving domain rules out of `packages/core`.

## apps/web/src/network/ — cancellable requests

- `fetchWithTimeout.ts` — combines a caller's abort signal with a hard request
  deadline. Share, embed, and import callers use the same behavior so a stalled
  Worker, proxy, or upstream request cannot leave an interaction busy forever.

## apps/web/src/sim/ — the running simulation

- `simClock.ts` — the `SimClock`: simulated time, and the only value in the
  app that changes 30 times a second. Created by `ui/SimProvider.tsx` and
  injected, never a module-level singleton.
- `vehicles.ts` — the stable animation API facade.
- `vehicleAnimationHost.ts` — advances the clock and writes GeoJSON directly
  to MapLibre, avoiding React reconciliation on the 30 Hz path. During a
  transient edit it keeps painting against the last settled system, then
  adopts the committed system once, so responsiveness does not cost visible
  continuity.
- `patternGeometry.ts` — dependency-aware pattern geometry and timetable
  caches. Unrelated way/station edits preserve warm entries.
- `serviceSchedule.ts` — minute-level schedule resolution and the next wake-up
  calculation for an idle simulation.
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
- `pointerIntent.ts` — the browser-free pointer grammar. It translates a
  view, tool, rendered-target category, modifier state, and gesture lock into
  one operation, cursor, badge, and preview/anchor instruction. The map layer
  calls it for both hover presentation and pointer dispatch so those two
  surfaces cannot promise different actions.

## apps/web/src/map/ — MapLibre

- `layers.ts` — turns the system into GeoJSON sources and layers per view;
  owns paint order (street surfaces below footprints, labels on top).
- `interactions.ts` — the pointer state machine: drawing, dragging,
  snapping, route drafting, station-land drawing; adapts MapLibre feature
  hits into the editor pointer-intent grammar and owns the pointer-down lock.
- `MapCanvas.tsx` — the map component; keeps sources in sync with the store
  and heals overlay layers if the style reloads; renders the pointer-intent
  badge beside the native cursor.
- `PointerBadge.tsx` — the pointer-transparent icon badge, using the shared
  UI icon vocabulary rather than a second map-specific icon set.
- `initialStyleFallback.ts` — bounds initial third-party style loading and
  switches failures to a local blank style so system geometry and pointer
  interactions still initialize offline.
- `layers/` — the layer specifications and icons `layers.ts` assembles.
- `export/` — rendering the map to an image off-screen.
- `basemap.ts`, `icons.ts`, `landmarks.ts`, `mapRef.ts`,
  `selectionFocus.ts` — supporting pieces.

## apps/web/src/camera/ — where the map is looking

- `liveCamera.ts` — the live map camera, held in a module-level holder
  outside the domain `system`. There is one map per session, and the value
  mirrors that map, so a store or a context would buy nothing.

The camera is presentation state, not domain data, and separating the two
is a performance decision as much as a modelling one. While the camera
lived in `system`, every pan minted a new `system` reference, which made a
drag frame look like a content edit to the renderer subscription, every
mounted selector, and autosave alike. Moving it out cost the saved-viewport
behaviour, which `storage/persistenceCoordinator.ts` restores deliberately
rather than by making the camera reactive again.

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
