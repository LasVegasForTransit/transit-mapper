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
units. Its pure Way and Service transforms also reconcile imports for the GTFS
Worker without pulling in Zustand. Web commands compose them into undoable
edits. `gtfs-archive.ts` decodes and batches ZIP feeds before that transform.

Focused transformation modules name the invariant they maintain. For example,
`routing-edits.ts` owns routed Service insertion, return-path application, and
infrastructure adoption; `way-endpoint-metadata.ts` remaps controls and turn
restrictions when Ways split or merge; and `stop-reanchoring.ts` is the one
boarding-point anchor-replacement and reprojection implementation shared by
those workflows.

`packages/core/src/model/line-service.ts` is the ownership boundary between
public Lines and technical Services. It resolves Line membership, display
labels, and mode summaries, and validates the one-way Line-to-Service relation
when a document enters the model.

Passenger places use two saved records and one derived relationship.
`system/stop.ts` defines boarding points and their Way anchors;
`system/station.ts` defines optional named places with boundaries and platforms;
`Stop.stationId` owns containment. Service calls are derived from paths reaching
Stops. Schema v16 and the old Station-record migration live in `serialize.ts`;
`gtfsImport.ts` maps the GTFS parent-station hierarchy into the same model.

#### Geometry

`packages/core/src/geometry` derives lane centerlines, junction footprints,
connector curves, and other street geometry from the domain model. These
results are memoized but never persisted. See
[Geometry and routing](../../product/explanation/geometry-and-routing.md).

#### Rendering

`packages/core/src/render` projects a system into styled geographic features
and portable SVG output. Its presentation modules define displayed-size LOD,
immutable dependency and viewport indexes, stable render identities, validated
scenes, and scene diffs. The `RenderScene` compatibility boundary separates
visual features from invisible hit geometry and imposes one deterministic
paint order. The static visual resolver turns the same scene into explicit
vector paint values for SVG rather than asking the serializer to interpret
MapLibre expressions.

`packages/core/src/style` supplies catalog appearance and LVBT brand tokens
without mixing presentation fields into the domain catalogs. The editor map,
embed, exports, and social previews share this projection boundary so their
representations remain consistent. The current screen-space scene contract
does not include watertight metric corridor meshes, and Diagram still uses the
existing core layout path outside the geographic projection scheduler.

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

`apps/web/src/editor/store.ts` is a thin public barrel. `create-editor-store.ts`
creates one vanilla Zustand store and its command groups. `EditorStore` exposes
only reads, subscription, and stable `commands`—not raw `setState`. Its
`EditorState` snapshot is data-only, so command access creates no reactive
dependency.

`apps/web/src/editor/EditorProvider.tsx` supplies that store to React.
`useEditor(selector)` subscribes to data, `useEditorCommands()` reads commands,
and `useEditorStore()` supports orchestration that needs fresh event-boundary
reads or subscriptions. The provider accepts an injected real store for tests
and embedded editors; there is no singleton or mock-only state path.

`apps/web/src/editor/store` owns contracts, composition, runtime, history,
internal operations, and commands. Only the runtime writes Zustand. Each atomic
content commit applies loading/read-only guards, prunes invalid lane and
transient references, stamps once, and records history in the same write.
Viewport persistence bypasses timestamps and history; undo and redo preserve
the current viewport. Read-only documents still allow transient tools and
selection. Commands use the runtime, never sibling groups; dependency-cruiser
enforces that direction and their import allowlist.

Installing a document resets its predecessor's selection, focus, drawing,
routing, group, Service-addition, and Stop-name workflows. Preferences for
future Ways, Services, and Facilities remain with the editor instance.

Application-independent domain calculations live in core. Pure transforms
preserve no-op identity and leave timestamps and history to the runtime.
Workers return core-built candidates for editor commands to accept or reject.
Shared editor workflows live under `store/internal-operations`, avoiding
command-to-command calls.

`apps/web/src/editor/pointerIntent.ts` resolves a press into an operation from
its target and modifier channels alone, without browser or map state, so
presentation and dispatch reach the same decision.
`apps/web/src/editor/input-tuning.ts` declares the hit, snap, and drag
tolerances for each pointer precision. `apps/web/src/camera` holds the live map
camera outside the saved system. Domain mutations pass through grouped editor
commands; map and UI modules do not modify records directly.

`apps/web/src/ui/sidebarOutline.ts` is the pure outline projection boundary.
It derives public Line → technical Service → Service-call rows and separately
projects saved Stops, Stations, grouped named infrastructure, and Facilities.
`SidebarPanel.tsx` owns per-view search, expansion, bounded rendering, roving
keyboard focus, and section-level failure recovery. Stop and Station editing
are separate command and inspector surfaces: Stop commands manage boarding
points and Station membership; Station commands manage passenger-place
boundaries, platforms, and contained Stops.

#### Map rendering

`apps/web/src/map` adapts core rendering output to MapLibre sources, layers,
pointer interaction, and exports. `MapCanvas.tsx` translates browser/editor
events into calls on one `LiveMapRenderer`; committed geometry still comes from
the store and core projectors.

| Modules                                                                                         | Responsibility                                                                                          |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `render-presentation.ts`, `camera-render-preload.ts`                                            | Describe display scale and reusable camera coverage.                                                    |
| `live-map-renderer.ts`                                                                          | Own accepted projection, scene publication, physical banks, and recovery. Start lifecycle changes here. |
| `document-projection.ts`, `committed-feature-projection.ts`, `resumable-feature-projection*.ts` | Build dependency-scoped detached features and cancel superseded generations.                            |
| `scene-draft*.ts`, `scene-source-state.ts`, `persistent-render-source-state.ts`                 | Normalize stable IDs and compute source-local changes without publishing partial work.                  |
| `scene-publication*.ts`, `accepted-scene-store.ts`, `render-scene-source-updater.ts`            | Advance the accepted CPU scene only after source publication succeeds.                                  |
| `source-bank*.ts`, `accepted-scene-recovery.ts`                                                 | Prewarm two physical banks, switch visual/hit ownership, and roll back failures.                        |
| `editor-feature-state.ts`                                                                       | Own paint-only selection, hover, halos, and route focus.                                                |
| `editor-overlays.ts`, `render-visibility.ts`                                                    | Own small editor geometry and mode/type filters outside committed projection.                           |

Scoped scenes use a stable source base with persistent deltas, avoiding a full
copy for one entity edit. Static map, embed, export, and SVG share the same
presentation and scene normalization. Handles, termini, and guides stay in
unbanked editor sources; camera changes inside the accepted envelope reuse the
current scene.

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

`apps/web/src/device` reads what the browser reports about the machine it is
running on. `media-query.ts` is the single `matchMedia` primitive; `capabilities.ts`
exposes viewport size, pointer precision, and hover as independent answers, so
layout and input tolerance each adapt on their own evidence. Size, not width:
the layout condition asks about height too, because a phone held sideways is
wide and short. It depends on
nothing else in the application, and the user interface, map, theme, and
installation modules all read it. A difference that is only visual belongs in a
CSS media query instead, beside the rules it coordinates with.

#### Storage

`apps/web/src/storage` owns browser persistence, recovery, and schema-aware
loading for editable systems. Stored values cross into the domain through
core serialization, keeping migrations and validation independent from the
storage engine.

#### Imports and networking

`apps/web/src/import` coordinates external data and progress.
`import-osm-network.ts` owns the main-thread Promise and cancellation,
`osm-import-protocol.ts` the structured-clone boundary, and
`osm-import-worker.ts` runs core's OpenStreetMap work. Every outcome terminates the
short-lived Worker. GTFS follows the same direction: Workers return core-built
candidates; commands verify the target document and commit atomically.

`apps/web/src/network` owns browser request scheduling and failure behavior,
including `useOnlineStatus`, which subscribes to the browser's own connectivity
signal so a failure can name the network as its cause. Classification and model
construction remain in core; the web import modules own browser capabilities,
cancellation, and interaction continuity.

#### Simulation host

`apps/web/src/sim` supplies the animation clock, lifecycle, and MapLibre
updates for vehicle positions calculated by the core simulation kernel. It
does not own timetable or motion policy.

#### Sharing and embedding

`apps/web/src/share` owns publishing requests, browser-side preview
rasterization, and downloadable formats. `apps/web/src/embed` owns the
read-only entry and its host-page contract. Both use core rendering and share
contracts so the editor, external exports, and embed agree on the same system.

#### Platform integration

`apps/web/src/pwa` owns install prompting, storage protection, display-mode
detection, and editor-only service-worker integration. Application identity
is generated from shared icon geometry into browser metadata, stable favicon
and Apple surfaces, and content-versioned manifest assets. The generation and
platform export procedure is documented in
[Update application icons](../how-to/update-application-icons.md).

#### Build identity

The About dialog reads one immutable build-information object injected by
Vite. Its version and repository come from the root manifest, its copyright
comes from the license, and its revision comes from the release environment or
Git. Contributor roles and platform credits remain in one curated web module
because neither the manifest nor Git history can express them reliably.

The root build launcher resolves the revision and dirty-tree state before
Turborepo starts, then includes those values in the web build's cache key. Vite
records the time only when it creates an artifact: a cache hit reuses that
artifact and its original timestamp rather than relabelling old output as a
new build. Release builds also validate that the release tag agrees with the
manifest version. A source archive without Git remains buildable, but the
dialog reports that its revision is unavailable instead of inventing one.

#### Performance

`apps/web/src/perf` owns measurable performance policy, fixtures, reports, and
precache validation that can run without browser automation. Browser traces
and production-output checks consume that policy but do not redefine its
budgets. Renderer fixture descriptors and measurement-only counters live at
this boundary as well. Renderer counters distinguish candidate and visible
features, generated vertices, cache reuse, tier transitions, full and patch
uploads, cooperative slices and yields, canceled generations, failures, and
the longest projection unit and scene commit.

`apps/web/scripts/renderer-capture` owns the Playwright driver, deterministic
basemap substitution, phase lifecycle, and contact-sheet generation. The
measurement-only camera seam waits for presentation projection and the final
MapLibre source/layout paint; it never becomes part of the public application
graph. Phase-specific acceptance suites live in additive subdirectories with
their own exact ID, provenance, hash, and assertion manifests, leaving the
fixed 116-image cross-phase corpus unchanged.

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
