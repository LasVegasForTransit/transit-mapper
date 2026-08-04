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
repository linting ───────> packages/eslint-plugin
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
`apps/web/src/theme` maps the operating system color preference to application
tokens, while `apps/web/src/i18n` owns user-visible message selection.
`apps/web/src/services` exposes browser-local preferences to UI consumers.
These modules may read the editor store and invoke actions but do not duplicate
domain rules.

#### Device

`apps/web/src/device` reads what the browser reports about the machine it is
running on. `media-query.ts` is the single `matchMedia` primitive; `capabilities.ts`
exposes viewport width, pointer precision, and hover as independent answers, so
layout and input tolerance each adapt on their own evidence. It depends on
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
behavior. Classification and model construction remain in core; these modules
own browser capabilities, cancellation, and interaction continuity.

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

### Performance tooling

The web application's browser scenarios, committed baselines, and production
verification tools live beside that application. Repository commands
coordinate them with builds and checks, while the policy they enforce remains
owned by the web performance module.
