# Project structure

TransitMapper has a domain package, browser editor, and Cloudflare Worker.

## Workspace

### Dependency direction

Dependencies flow from the applications toward shared packages:

```text
apps/web ─────┐
              ├──> packages/core
apps/worker ──┘

apps/web ────────> packages/pwa-updater

all TypeScript packages ──> packages/tsconfig
repository linting ───────> packages/config-eslint ──> packages/eslint-plugin
repository contribution tooling ──> pinned LVBT plugin release
```

The domain model does not import browser state, React, MapLibre, or Worker
bindings. The web application owns interactive state and browser integration;
the Worker owns network delivery and persistence. This direction keeps domain
rules portable across the browser and workerd runtimes.

### Tree

```text
packages/
  core/           Shared domain, geometry, rendering, simulation, and contracts
  pwa-updater/    Editor update lifecycle
  config-eslint/  The org's ESLint baseline, as a function
  eslint-plugin/  Repository-specific lint rules
  tsconfig/       Shared TypeScript compiler policy
apps/
  web/            Vite and React editor, embed, and PWA
  worker/         Cloudflare Worker and D1 persistence
docs/             Product, development, operations, and security documentation
scripts/          Repository-wide generators and invariant checks
turbo/            Turborepo generators and templates
```

## Packages

### Core

`packages/core` owns deterministic logic shared by the editor and Worker. It
is consumed directly from TypeScript source and must run without browser-only
globals in both the browser and workerd.

#### Domain model

`packages/core/src/model` defines saved systems, catalogs, service paths,
validation, serialization, imports, routing, schematic layout, costs, and
units. Pure transforms reconcile imports and preserve no-op identity; web
commands compose them into undoable edits without importing Zustand.

Focused modules name the invariant they maintain: routing edits, endpoint
metadata, and stop reanchoring each have one owner. Lines are public identities
over technical Services. Stops are anchored boarding points; Stations are
optional physical places containing Stops. Diagram layout is a pure facade
returning one `DiagramLayoutResult`, with no MapLibre or editor dependency.

#### Geometry

`packages/core/src/geometry` derives lane centerlines, junction footprints,
connector curves, and other street geometry from the domain model.
`metric-plane.ts` and `metric-curves.ts` resolve a curved Way's local-meter
centerline from optional per-point radius controls; the render presentation
turns its final CSS-pixel error budget into the tessellation bound. The
document stores the authored radius, never a sampled mesh. These results are
memoized but never persisted. See
[Geometry and routing](../../product/explanation/geometry-and-routing.md).

#### Rendering

`packages/core/src/render` projects a system into styled geographic features
and SVG. It owns displayed-size LOD, dependency and viewport indexes, stable
identities, scene validation, and diffs. `RenderScene` separates visual and hit
geometry and fixes paint order; the static resolver emits SVG paint directly.

`SystemFeatures.stops` are boarding markers; physical Stations produce
footprints, platforms, and handles. The historical `tm-stations` source name
is translated only by `apps/web/src/map/system-feature-sources.ts`.
`service-lane-assignments.ts` resolves a directional service run once, so its
line, connector, and vehicle path agree. `packages/core/src/style` supplies
appearance without mixing it into the domain catalog.

#### Simulation

`packages/core/src/sim` owns timetable and vehicle-motion arithmetic. It has no
animation loop or map dependency; the web application supplies time and
renders the returned positions. See
[The simulation](../../product/explanation/simulation.md).

#### Sharing

`packages/core/src/share` owns the wire contract used by the web client and
Worker, along with pure ownership and claim decisions. It does not perform
HTTP requests or database writes. See
[Sharing surfaces](../../product/explanation/sharing-surfaces.md).

#### Performance sample contract

`packages/core/src/performance/contract.ts` validates the sampled browser-to-Worker payload.

#### Account groundwork

`packages/core/src/auth` contains pure OAuth, PKCE, token, cookie, and
return-path primitives. Claiming and ownership policy live in the sharing
module. This tested groundwork is not connected to routes, tables, or the
editor; live shares remain anonymous and expiring.

### PWA updater

`packages/pwa-updater` owns the React-facing update contract used by the
editor. It has no dependency on the domain model or editor store.

#### Update lifecycle

The updater translates service-worker registration events into a promptable
state. The web application decides where to show the update notice and when a
person may activate the waiting version. This prevents an update from
replacing an editing session without consent.

### Contribution tooling

The organization-wide issue forms and pull request template live in
`LasVegasForTransit/.github`. TransitMapper intentionally carries no local
copy, because any local issue-template directory would shadow the complete
organization default.

The pinned `lvbt-contributions` plugin supplies the portable contribution
skill, creation helper, and action guards. `.lvbt/repository-tooling.json`
records its release and checksum; `check:repository-tooling` rejects drift.
Production code does not import this tooling.

### ESLint baseline

`packages/config-eslint` owns the rule set itself, as two functions a
repository calls from its `eslint.config.ts`. `defineTypeAwareConfig` takes the
directory holding that config and returns the baseline with every rule that
needs a type checker; `defineConfig` returns the syntax-only subset for a
repository with no project covering each file.

#### Baseline rules

The baseline is the org's, not this repository's, and carries nothing that
names a path here. Repository-specific scoping is passed in as extra config
objects and lands after the baseline and before the Prettier reset. Departures
from the upstream presets are recorded in the module beside the count of
findings that justified each one.

### ESLint plugin

`packages/eslint-plugin` owns static rules for repository invariants that
TypeScript cannot express reliably.

#### Repository rules

Rules protect runtime and module boundaries, including the ban on browser-only
globals in core. A rule belongs here only when it can identify violations
mechanically without rejecting valid code. The root lint configuration owns
where each rule applies. See
[The enforcement model](../explanation/enforcement-model.md).

### TypeScript configuration

`packages/tsconfig` owns shared compiler policy for the workspace. It exposes
configuration rather than runtime source, so it is exempt from package scripts
that would otherwise perform no work. Each source package extends that policy
with the runtime libraries and output behavior it needs.

## Applications

### Web

`apps/web` owns the Vite and React editor, read-only embed, browser storage,
and installable PWA. It depends on core for domain decisions and on the PWA
updater for activation state.

#### Editing

`apps/web/src/editor` owns the Zustand store, undo history, grouped editor
commands, selection, keyboard routing, and gesture transactions.

`apps/web/src/editor/store.ts` is a public barrel over one vanilla Zustand
store and stable command groups. Its reactive snapshot is data only; consumers
read state, subscribe, or invoke commands, never raw `setState`. The runtime
is the only writer. An atomic commit applies guards, prunes invalid transient
references, stamps once, and records history in the same write. Viewport
persistence bypasses history, while read-only documents still permit tools and
selection. Commands use core transforms and internal operations, never sibling
command groups. Installing a document clears its transient editor state but
retains preferences for future drafts.

`apps/web/src/editor/pointerIntent.ts` resolves a press into an operation from
its target and modifier channels alone, without browser or map state, so
presentation and dispatch reach the same decision.
`apps/web/src/editor/input-tuning.ts` declares the hit, snap, and drag
tolerances for each pointer precision. `apps/web/src/camera` holds the live map
camera outside the saved system. Domain mutations pass through grouped editor
commands; map and UI modules do not modify records directly.

`apps/web/src/ui/sidebarOutline.ts` is the pure outline projection boundary;
`SidebarPanel.tsx` owns search, expansion, bounded rendering, keyboard focus,
and recovery. Stop editing manages boarding points and membership; Station
editing manages physical passenger-place geometry.

#### Map rendering

`apps/web/src/map` adapts core rendering output to MapLibre sources, layers,
pointer interaction, and exports. `MapCanvas.tsx` translates browser/editor
events into calls on one `LiveMapRenderer`; committed geometry still comes from
the store and core projectors.

| Modules                                                                                                                          | Responsibility                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `render-presentation.ts`, `camera-render-preload.ts`                                                                             | Describe display scale and reusable camera coverage.                                                                                                                                                                                                                  |
| `live-map-renderer.ts`                                                                                                           | Own accepted projection, scene publication, physical banks, and recovery. Start lifecycle changes here.                                                                                                                                                               |
| `document-projection.ts`, `committed-feature-projection.ts`, `feature-projection-worker*.ts`, `resumable-feature-projection*.ts` | Prepare dependency-scoped requests, build detached features in the persistent Worker, and cancel superseded generations.                                                                                                                                              |
| `scene-draft*.ts`, `accepted-scene-state.ts`, `scene-source-state.ts`, `persistent-render-source-state.ts`                       | Normalize stable IDs and compute source-local changes without publishing partial work.                                                                                                                                                                                |
| `scene-publication*.ts`, `renderer-source-publication.ts`, `accepted-scene-store.ts`, `render-scene-source-updater.ts`           | Build a private scene, then own MapLibre source mutation, load observation, bank activation, and accepted CPU publication as one lifecycle.                                                                                                                           |
| `source-bank*.ts`, `accepted-scene-recovery.ts`                                                                                  | Prewarm two physical banks, switch visual/hit ownership, and roll back failures.                                                                                                                                                                                      |
| `diagram-layout-worker*.ts`                                                                                                      | Run and retain revision-keyed `DiagramLayoutResult` values outside the UI thread. The result carries the renderable schematic system together with node, stop, station, and named-corridor label anchors, so later Diagram consumers do not need to reconstruct them. |
| `editor-feature-state.ts`                                                                                                        | Own paint-only selection, hover, halos, and route focus.                                                                                                                                                                                                              |
| `editor-overlays.ts`, `render-visibility.ts`                                                                                     | Own small editor geometry and mode/type filters outside committed projection.                                                                                                                                                                                         |

`feature-projection-worker.ts` is the browser client and
`feature-projection-worker-entry.ts` the worker-only CPU endpoint. Their
protocol contains serializable document and presentation facts, never MapLibre
objects or a store. `worker-feature-projection-submission.ts` cancels stale
replies before source-bank publication. Fitted read-only maps use the same
worker and presentation facts as SVG.

Scoped scenes retain a stable source base and small deltas. Static map, embed,
export, and SVG share scene normalization. Handles, termini, and movement
guides remain unbanked editor sources; camera changes inside the accepted
envelope reuse the committed scene. Junction surfaces, traffic controls,
markings, and lane-continuous services derive from the same resolved geometry.

#### UI

`apps/web/src/ui` owns React presentation, workbench layout, inspector
controls, dialogs, onboarding, and accessibility semantics.
`apps/web/src/ui/sidebarOutline.ts` derives view-specific outline rows from the
domain model without React state. `SidebarPanel.tsx` owns the per-view query,
expansion, list limits, scroll position, selection wiring, and local recovery
boundaries that present that projection.
`apps/web/src/ui/useKeyboardInset.ts` reports how much of the viewport an
on-screen keyboard covers, which no layout-viewport measurement exposes.
`apps/web/src/ui/app-banner.ts` decides which single application-level message
is showing and what it says, as a pure function of save state, startup outcome,
update state, and connectivity; it holds the copy for every one of them.
`apps/web/src/theme` maps the operating system color preference to application
tokens. `apps/web/src/assets` holds source-distributed browser binaries beside
their required licenses, while `apps/web/src/i18n` owns user-visible message
selection.
`apps/web/src/services` exposes browser-local preferences to UI consumers.
These modules may read the editor store and invoke grouped commands but do not
duplicate domain rules.

`ui/Workbench.tsx` is the single owner of where every surface sits, at every
viewport. Below the layout condition it mounts a different tree: two
edge-anchored bars with the map between them, rather than floating cards. See
[The compact layout](../explanation/compact-layout.md) for that tree, its
detents, and the four properties that tell the map what the chrome covers.

#### Device

`apps/web/src/device` exposes viewport size, pointer precision, and hover as
independent browser facts. Layout and input tolerance use the relevant fact;
purely visual differences stay in nearby CSS media queries.

#### Storage

`apps/web/src/storage` owns browser persistence, recovery, and schema-aware
loading for editable systems. Stored values cross into the domain through
core serialization, keeping migrations and validation independent from the
storage engine.

#### Imports and networking

`apps/web/src/import` owns browser requests, progress, cancellation, and the
structured-clone boundary; short-lived Workers return core-built candidates for
commands to accept atomically. `apps/web/src/network` owns browser request
scheduling and connectivity state. Classification and model construction stay
in core.

#### Simulation host

`apps/web/src/sim` hosts the animation clock and MapLibre updates for positions
calculated by core; it owns neither timetable nor motion policy.

#### Sharing and embedding

`apps/web/src/share` owns publishing requests, browser-side preview
rasterization, and downloadable formats. `apps/web/src/embed` owns the
read-only entry and its host-page contract. Both use core rendering and share
contracts so the editor, external exports, and embed agree on the same system.

#### Platform integration

`apps/web/src/pwa` owns installation and editor-only service-worker behavior.
Application identity is generated into browser metadata and manifest assets;
see [Update application icons](../how-to/update-application-icons.md).

#### Build identity

The About dialog reads one immutable Vite-injected build record. The launcher
includes revision and dirty state in the build cache key; a source archive
without Git reports that its revision is unavailable rather than inventing one.

#### Performance

`apps/web/src/perf` owns performance policy, fixtures, reports, precache
validation, and measurement-only renderer counters. Browser traces consume
that policy without redefining its budgets. `apps/web/scripts/renderer-capture`
owns the Playwright driver, deterministic basemap, and contact sheets. Its
camera seam waits for projection and final MapLibre paint, but never enters the
public application graph. Additive acceptance suites carry their own IDs,
provenance, hashes, and assertions without changing the fixed baseline corpus.

`apps/web/src/pwa/adaptive-cache-contract.ts` owns optional assets and offline
readiness. The client obeys network, quota, and 64 KiB limits.

`field-sampling.ts` checks privacy, release, origin, and sampling before
loading the URL-free client.

Vite builds the editor, embed, and no-script privacy page.

### Worker

`apps/worker` owns the Cloudflare deployment that serves the web build,
publishes share resources, and persists snapshots. It imports core contracts
and validation but never imports browser or editor modules.

#### HTTP delivery

The Worker routes API requests, shares, embeds, static assets, sampled reports,
and maintenance. Stored text enters HTML through `HTMLRewriter`.

`POST /api/performance-samples` accepts 8 KiB of same-origin JSON, honors
GPC/DNT, validates it, and stores allowlisted columns.

#### Persistence

D1 stores shared systems, preview metadata, and short-lived sampled data.
Migrations are append-only and Wrangler applies them in filename order. See
[Operations](../../operations/how-to/operations.md).

`performance-samples.ts` owns ingestion; `performance-maintenance.ts` owns
daily summaries and retention. Raw rows expire after seven days and aggregates
after 90.

## Repository support

### Tests

Each package or application owns a `tests/` tree at its root. Test paths mirror
production modules where practical, while shared fixture builders remain
explicit test-only exports. Vitest cases are isolated; the older web and Worker
verification suites are sequential because they intentionally mutate one
module-scoped fixture.

### Generators and checks

Repository-wide checks and generated references live under `scripts/`.
Package, migration, and lint-rule scaffolding lives under `turbo/`. Generators
must leave their output compliant with the same package, filename,
documentation, and structure contracts enforced in CI.

Bootstrap holds the desired GitHub governance state as data and keeps API
reads and confirmed mutations in its repository-governance phase. Doctor mode
uses the same comparisons without taking a mutation path.

### Releases and deployment provenance

Release Please derives the next root version and changelog from conventional
commits and maintains a release pull request. Merging that generated pull
request creates the matching tag and GitHub release; no version, changelog, or
release input is copied into workflow settings by hand.

GitHub suppresses ordinary workflow events caused by its own workflow token,
so the release job validates the generated pull request metadata itself,
publishes the canonical metadata status, and explicitly dispatches the shared
CI workflow against the generated branch. Both checks attach to the release
commit and satisfy the same default-branch rules as a contributor-authored
pull request without a personal token or manually maintained secret.

The production workflow bundles the static application, Worker module,
deployment configuration, and migrations once. It archives and attests that
payload with GitHub's workload identity, attaches both the archive and
attestation bundle to the release, then extracts the same archive for the D1
migration and Cloudflare deployment steps. The Worker deploy disables
rebundling so the deployed module cannot diverge from the attested subject.
The production environment and smoke test record which workflow deployed the
release and confirm that the public site serves its fingerprinted entry chunk.

### Performance tooling

The web application's browser scenarios, committed baselines, and production
verification tools live beside that application. Repository commands
coordinate them with builds and checks, while the policy they enforce remains
owned by the web performance module. Renderer evidence is generated under the
ignored `apps/web/artifacts/renderer/` tree so exploratory phases do not add
binary weight to the repository. The capture manifest and contact sheet are
the review boundary. Successful post-baseline phases require current source
and deterministic-basemap provenance; `01-lod` also requires its complete
current-only acceptance appendix. Approved final images may later be promoted
explicitly to tracked visual-regression fixtures.
