# Project structure

TransitMapper is a pnpm workspace with a shared domain package, a browser
editor, and an optional Cloudflare Worker. The project map follows those
ownership boundaries. Paths are locators within a module, not the organizing
principle of this reference.

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
validation, serialization, imports, routing, schematic layout, costs, units,
and identifiers. Its operations accept and return domain values without
depending on application state. Store actions in the web application compose
these operations into undoable edits.

#### Geometry

`packages/core/src/geometry` derives lane centerlines, junction footprints,
connector curves, and other street geometry from the domain model. These
results are memoized but never persisted. See
[Geometry and routing](../../product/explanation/geometry-and-routing.md).

#### Rendering

`packages/core/src/render` projects a system into styled geographic features
and portable SVG output. `packages/core/src/style` supplies catalog appearance
and LVBT brand tokens without mixing presentation fields into the domain
catalogs. The editor map, embed, exports, and social previews share this
projection boundary so their representations remain consistent.

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

#### Account groundwork

`packages/core/src/auth` contains pure OAuth, PKCE, token, cookie, and
return-path primitives. Account claiming and ownership policy also live in the
sharing module. This groundwork is tested but is not connected to Worker
routes, account tables, or the current editor; every live share remains
anonymous and expiring.

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

The pinned `lvbt-contributions` plugin under `plugins/` supplies one portable
Agent Skill, a small creation helper, and harness-specific action guards.
`.lvbt/repository-tooling.json` records the release and checksum;
`check:repository-tooling` refuses local drift. This is repository tooling,
not an application package, and no production code imports it.

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

`apps/web/src/editor` owns the Zustand store, undo history, editing actions,
selection, keyboard routing, and gesture transactions.
`apps/web/src/editor/pointerIntent.ts` resolves a press into an operation from
its target and modifier channels alone, without browser or map state, so
presentation and dispatch reach the same decision.
`apps/web/src/editor/input-tuning.ts` declares the hit, snap, and drag
tolerances for each pointer precision. `apps/web/src/camera` holds the live map
camera outside the saved system. Domain mutations pass
through editor actions; map and UI modules do not modify records directly.

#### Map rendering

`apps/web/src/map` adapts core rendering output to MapLibre sources, layers,
pointer interaction, and canvas-backed exports. It may hold transient previews
for continuous gestures, but committed geometry continues to come from the
store and core projectors.

#### UI

`apps/web/src/ui` owns React presentation, workbench layout, inspector
controls, dialogs, onboarding, and accessibility semantics.
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
These modules may read the editor store and invoke actions but do not duplicate
domain rules.

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

`apps/web/src/import` coordinates user-selected external data and progress
reporting. `apps/web/src/network` owns browser request scheduling and failure
behavior, including `useOnlineStatus`, which subscribes to the browser's own
connectivity signal so a failure can name the network as its cause.
Classification and model construction remain in core; these modules own browser
capabilities, cancellation, and interaction continuity.

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
budgets.

### Worker

`apps/worker` owns the Cloudflare deployment that serves the web build,
publishes share resources, and persists snapshots. It imports core contracts
and validation but never imports browser or editor modules.

#### HTTP delivery

The Worker routes resource-oriented API requests, share pages, embeds,
oEmbed responses, static assets, and scheduled expiry work. Stored text enters
HTML through `HTMLRewriter`; routing code does not concatenate untrusted values
into markup.

#### Persistence

D1 stores shared systems and preview metadata. Migrations in
`apps/worker/src/migrations` are append-only external contracts applied by
Wrangler in filename order. Anonymous shares expire; null expiry is reserved
for future account ownership and is not an unset value. See
[Operations](../../operations/how-to/operations.md).

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
owned by the web performance module.
