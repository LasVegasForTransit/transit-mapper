# Sidebar Information Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the generic Workspace sidebar with a Figma-like view-specific outline and realign the document model so public Lines group mode-specific operational Services.

**Architecture:** `packages/core` will normalize public Line identity separately from operational Service paths, migrate existing documents, and expose pure lookup/outline projections. `apps/web` will consume those projections through explicit Line and Service selections, keep all property editing in the right inspector, and render one responsive Outline surface whose contents follow Network, Infrastructure, or Diagram.

**Tech Stack:** TypeScript, React, Zustand, MapLibre GL, Vitest, workerd, pnpm, Turborepo, Prettier, ESLint.

---

## File map

### Core model and migration

- Modify `packages/core/src/model/system/service.ts` — define public `Line`, operational `Service`, and singular `ServicePath` types.
- Modify `packages/core/src/model/system/document.ts` — store ordered `lines` and `services` in schema v15.
- Modify `packages/core/src/model/system.ts` — export the new types and helpers.
- Create `packages/core/src/model/line-service.ts` — authoritative Line/Service lookup, ordering, naming, and membership helpers.
- Create `packages/core/tests/model/line-service.test.ts` — membership and display-label rules.
- Modify `packages/core/src/model/serialize.ts` — parse v15 and migrate v14 Service/Pattern records deterministically.
- Modify `packages/core/src/model/validate.ts` — reject missing, duplicated, and orphaned Service membership.
- Modify `packages/core/tests/model/documentRepair.test.ts` and `packages/core/tests/model/validate.test.ts` — migration and invariant coverage.

### Core behavior consumers

- Modify `packages/core/src/model/geo/servicePaths.ts`, `serviceEdits.ts`, `serviceGestures.ts`, `selectionActions.ts`, `selectionRelations.ts`, `throughRoute.ts`, and related model helpers — use one path per Service and resolve public Line identity explicitly.
- Modify `packages/core/src/model/gtfsImport.ts` and `gtfsSchedule.ts` — import GTFS routes as Lines and distinct route/stopping patterns as Services.
- Modify `packages/core/src/render/buildFeatures.ts`, `featureMemo.ts`, `legend.ts`, `mergeServiceLines.ts`, and `svg.ts` — render public Line identity while retaining Service identity for deep selection and simulation.
- Modify `packages/core/src/sim/clock.ts`, `frequency.ts`, and `serviceStats.ts` — calculate schedules and fleets per operational Service and aggregate Line summaries explicitly.
- Update the focused tests under `packages/core/tests/model`, `packages/core/tests/render`, and `packages/core/tests/sim` alongside each consumer.

### Web editor and UI

- Modify `apps/web/src/editor/store.ts` and `apps/web/src/editor/actions/serviceActions.ts` — add Line selection, create Line+Service atomically, and edit one Service path without Pattern-level public state.
- Modify `apps/web/src/map/interactions.ts`, `sourceFeatureProjection.ts`, `selectionFocus.ts`, `MapCanvas.tsx`, and layer specs — first-select Line, deep-select Service, and preserve view transitions.
- Create `apps/web/src/ui/outline-state.ts` — per-view search, expansion, and scroll-state primitives.
- Modify `apps/web/src/ui/sidebarOutline.ts` — adapt pure core projections into accessible rows and bounded search results.
- Modify `apps/web/src/ui/SidebarPanel.tsx` — render Outline chrome and view-specific hierarchy; remove Workspace, Corridors grouping, and Vehicles placeholder.
- Create `apps/web/src/ui/line-inspector.tsx` and modify `Inspector.tsx`, `inspector/ServiceInspector.tsx`, `StationInspector.tsx`, and `ScheduleDialog.tsx` — split public and operational editing.
- Modify `apps/web/src/ui/Workbench.tsx`, `TopBar.tsx`, `FileMenu.tsx`, `Icon.tsx`, `map/lucideIconNodes.ts`, and `app.css` — correct menu/panel controls and compact-sheet titles.
- Update onboarding, GTFS reconciliation, import protocols, performance fixtures, storage fixtures, and focused web tests that construct or inspect the old model.

### Documentation

- Modify `docs/product/reference/data-model.md`, `docs/product/explanation/views.md`, `simulation.md`, `geometry-and-routing.md`, `docs/product/how-to/route-services.md`, `docs/product/tutorials/getting-started.md`, and `docs/development/reference/project-structure.md`.
- Retire or supersede `docs/superpowers/specs/2026-07-28-view-specific-sidebar-design.md` by linking it to the approved 2026-08-10 design rather than leaving contradictory guidance.

## Task 1: Introduce Line, Service, and membership helpers

**Files:**

- Modify: `packages/core/src/model/system/service.ts`
- Modify: `packages/core/src/model/system/document.ts`
- Modify: `packages/core/src/model/system.ts`
- Create: `packages/core/src/model/line-service.ts`
- Create: `packages/core/tests/model/line-service.test.ts`

- [ ] **Step 1: Write failing membership and label tests**

Add tests that construct two Lines and three Services and assert:

```ts
expect(servicesForLine(system, 'red').map((service) => service.id)).toEqual([
  'red-local',
  'red-express',
]);
expect(lineForService(system, 'red-express')?.id).toBe('red');
expect(serviceDisplayLabel(system, 'red-local')).toBe('Downtown local');
expect(serviceDisplayLabel(singleServiceSystem, 'blue-only')).toBe('Blue Line');
expect(validateLineServiceMembership(orphanedSystem)).toEqual([
  { kind: 'orphaned-service', serviceId: 'orphan' },
]);
```

- [ ] **Step 2: Run the focused test and confirm the missing API failure**

Run:

```bash
pnpm --filter @transitmapper/core exec vitest run tests/model/line-service.test.ts
```

Expected: FAIL because `Line`, singular-path `Service`, and membership helpers do not exist.

- [ ] **Step 3: Define the normalized schema types**

Refactor the existing route types to this public boundary while retaining `PatternSection`, `PatternLeg`, and `RunDirection` as path internals:

```ts
export interface ServicePath {
  sections: PatternSection[];
  skippedStops?: Partial<Record<RunDirection, string[]>>;
}

export interface Service {
  id: string;
  name?: string;
  modeId: string;
  vehicleKindId?: string;
  path: ServicePath;
  frequencyMinutes?: number;
  spanStart?: string;
  spanEnd?: string;
  schedule?: SchedulePeriod[];
}

export interface Line {
  id: string;
  name: string;
  color: string;
  serviceIds: string[];
}
```

Change `TransitSystem` to schema version 15 with ordered `lines: Line[]` and `services: Service[]`.

- [ ] **Step 4: Implement one-source membership helpers**

In `line-service.ts`, implement `servicesForLine`, `lineForService`, `serviceDisplayLabel`, `lineModes`, and `validateLineServiceMembership`. Do not add `lineId` to Service; `Line.serviceIds` is the sole stored membership direction. A single unnamed Service inherits its Line name for display. Multiple unnamed Services use stable `Service N` fallbacks only at read/migration boundaries.

- [ ] **Step 5: Run focused tests and core typecheck**

Run:

```bash
pnpm --filter @transitmapper/core exec vitest run tests/model/line-service.test.ts
pnpm --filter @transitmapper/core typecheck
```

Expected: membership tests PASS; typecheck reports the old model consumers that Tasks 2–5 must migrate.

- [ ] **Step 6: Commit the model boundary**

Stage only the new types, helpers, and focused tests. Commit subject: `feat(core): Separate lines from services`.

## Task 2: Migrate and validate persisted documents

**Files:**

- Modify: `packages/core/src/model/serialize.ts`
- Modify: `packages/core/src/model/validate.ts`
- Modify: `packages/core/tests/model/documentRepair.test.ts`
- Modify: `packages/core/tests/model/validate.test.ts`
- Modify: `packages/core/tests/support/fixtures.test.ts`

- [ ] **Step 1: Add failing v14-to-v15 migration tests**

Cover one old Service with one Pattern and one old Service with two named/unnamed Patterns. Assert the old Service name/color become one Line, each Pattern becomes one ordered Service, mode/schedule/path data survive, and generated labels follow Pattern name, distinct termini, then stable ordinal.

```ts
expect(migrated.lines).toEqual([
  { id: oldService.id, name: 'Red Line', color: '#e5252a', serviceIds: generatedIds },
]);
expect(migrated.services.map(({ modeId }) => modeId)).toEqual(['brt', 'brt']);
expect(migrated.services.map(({ frequencyMinutes }) => frequencyMinutes)).toEqual([10, 10]);
```

- [ ] **Step 2: Add failing membership-validation tests**

Assert missing Service ids, duplicate membership, orphaned Services, and empty Lines are invalid. Assert parser repair never silently assigns an orphan to the first Line.

- [ ] **Step 3: Run migration and validation tests to verify failure**

Run:

```bash
pnpm --filter @transitmapper/core exec vitest run tests/model/documentRepair.test.ts tests/model/validate.test.ts
```

Expected: FAIL on schema version and absent migration behavior.

- [ ] **Step 4: Implement deterministic v15 parsing and migration**

Keep v14 draft interfaces local to `serialize.ts`. Preserve old Service ids as new Line ids because their prior name/color references were public identity. Mint Service ids deterministically from existing Pattern ids when globally unique; otherwise mint collision-free ids through the repository id helper. Map every reference by meaning and add explicit repair/drop behavior for malformed membership.

- [ ] **Step 5: Implement validator integration**

Make `validateSystem` include membership issues without duplicating lookup logic. Empty Lines are removed during parsing or prevented by commands; they do not render as broken public identities.

- [ ] **Step 6: Run serialization, validation, and fixture tests**

Run:

```bash
pnpm --filter @transitmapper/core exec vitest run tests/model/documentRepair.test.ts tests/model/validate.test.ts tests/support/fixtures.test.ts
```

Expected: PASS with old documents round-tripping to v15 and no dropped operational data.

- [ ] **Step 7: Commit the schema migration**

Commit subject: `feat(core): Migrate documents to line services`.

## Task 3: Convert core editing and routing to singular Service paths

**Files:**

- Modify: `packages/core/src/model/geo/servicePaths.ts`
- Modify: `packages/core/src/model/geo.ts`
- Modify: `packages/core/src/model/serviceEdits.ts`
- Modify: `packages/core/src/model/serviceGestures.ts`
- Modify: `packages/core/src/model/selectionActions.ts`
- Modify: `packages/core/src/model/selectionRelations.ts`
- Modify: `packages/core/src/model/throughRoute.ts`
- Modify: focused tests under `packages/core/tests/model/`

- [ ] **Step 1: Rewrite focused test fixtures to Lines plus singular-path Services**

Replace fixtures of the form `service.patterns[0]` with explicit Line membership and `service.path`. Preserve assertions about legs, directions, extents, lanes, skipped Stops, joins, trims, splits, and through-routing.

- [ ] **Step 2: Run the focused model suite and record semantic failures**

Run:

```bash
pnpm --filter @transitmapper/core exec vitest run tests/model/serviceEdits.test.ts tests/model/serviceGestures.test.ts tests/model/throughRoute.test.ts tests/model/selectionActions.test.ts tests/model/selectionRelations.test.ts
```

Expected: FAIL on old `.patterns` access and Pattern ids used as public selection ids.

- [ ] **Step 3: Convert path operations without compatibility aliases**

Change functions to accept a Service id and operate on `service.path`. Remove Pattern-id parameters where the Service id now uniquely identifies the path. Rename public APIs only when the old name is actively misleading; keep pure geometry names such as `PatternSection` internal until a separate mechanical rename improves clarity.

- [ ] **Step 4: Preserve split and join semantics under Line ownership**

Splitting an operational path creates a new Service and adds its id adjacent to the source in the owning Line. Joining Services updates both path data and `serviceIds` atomically. A Line deletion cascades its Services; deleting a sole Service is represented as deleting its Line.

- [ ] **Step 5: Run focused tests and core typecheck**

Run the Task 3 Vitest command, then:

```bash
pnpm --filter @transitmapper/core typecheck
```

Expected: focused tests PASS; remaining errors are limited to import/render/simulation consumers scheduled next.

- [ ] **Step 6: Commit core path operations**

Commit subject: `refactor(core): Make each service own one path`.

## Task 4: Import GTFS routes as Lines with Services

**Files:**

- Modify: `packages/core/src/model/gtfsImport.ts`
- Modify: `packages/core/src/model/gtfsSchedule.ts`
- Modify: `packages/core/tests/model/gtfsArchive.test.ts`
- Modify: `packages/core/tests/model/gtfsPairing.test.ts`
- Modify: `apps/web/src/import/gtfsReconcileProtocol.ts`
- Modify: `apps/web/src/import/gtfsReconcileWorker.ts`
- Modify: `apps/web/src/import/reconcileRtcGtfs.ts`
- Modify: `apps/web/tests/import/reconcileRtcGtfs.test.ts`
- Modify: `apps/web/tests/import/streamRtcGtfs.test.ts`

- [ ] **Step 1: Add failing multi-pattern import expectations**

Use a GTFS route with local and express shapes. Assert one public Line, two ordered Services, one mode per Service, distinct meaningful labels, and per-Service schedule/headway data.

- [ ] **Step 2: Run focused import tests to verify failure**

Run:

```bash
pnpm --filter @transitmapper/core exec vitest run tests/model/gtfsArchive.test.ts tests/model/gtfsPairing.test.ts
pnpm --filter @transitmapper/web exec vitest run tests/import/reconcileRtcGtfs.test.ts tests/import/streamRtcGtfs.test.ts
```

- [ ] **Step 3: Convert import output and reconciliation protocols**

Map GTFS `route_id`/agency public designation to Line identity. Group trips by meaningful geometry/stopping pattern into Services. Prefer route headsign or branch name, then distinct termini, then stable ordinal. Reconciliation returns affected Service ids and owning Line ids explicitly rather than overloading one id list.

- [ ] **Step 4: Run focused import tests and typechecks**

Run Task 4 tests plus core/web typechecks. Expected: imported route counts and existing timeout/streaming guarantees remain unchanged except for explicit Line/Service counts.

- [ ] **Step 5: Commit import conversion**

Commit subject: `feat(import): Preserve route services beneath lines`.

## Task 5: Render and simulate public Lines with operational Services

**Files:**

- Modify: `packages/core/src/render/buildFeatures.ts`
- Modify: `packages/core/src/render/featureMemo.ts`
- Modify: `packages/core/src/render/legend.ts`
- Modify: `packages/core/src/render/mergeServiceLines.ts`
- Modify: `packages/core/src/render/svg.ts`
- Modify: `packages/core/src/sim/clock.ts`
- Modify: `packages/core/src/sim/frequency.ts`
- Modify: `packages/core/src/sim/serviceStats.ts`
- Modify: `apps/web/src/sim/patternGeometry.ts`
- Modify: `apps/web/src/sim/serviceSchedule.ts`
- Modify: `apps/web/src/sim/vehicleAnimationHost.ts`
- Modify: focused render/simulation tests

- [ ] **Step 1: Add failing render identity and service-frequency tests**

Assert rendered path features carry both `lineId` and `serviceId`, use Line color/name for public display, and keep Service mode/path for lane choice. Assert two Services under one Line simulate independently and aggregate frequency at shared Stops by summing frequencies.

- [ ] **Step 2: Run focused tests to verify failure**

Run:

```bash
pnpm --filter @transitmapper/core exec vitest run tests/render/buildFeatures.test.ts tests/render/mergeServiceLines.test.ts tests/sim/serviceStats.test.ts tests/sim/runTimetables.test.ts
```

- [ ] **Step 3: Convert rendering and legend projection**

Resolve Line once per Service through core helpers. Render public color and legend identity from Line; retain Service id for hit testing, offsets, schedules, and vehicle animation. Deduplicate the legend by Line while allowing multiple Service paths to contribute geometry.

- [ ] **Step 4: Convert simulation to singular Service paths**

Plan fleet, runs, headways, skipped Stops, and schedules per Service. Aggregate Line summaries only in explicit summary functions. Do not move frequency to Line or infer a Line mode.

- [ ] **Step 5: Run render/simulation suites and core typecheck**

Expected: all focused tests PASS with no `.patterns` references remaining in core production code.

- [ ] **Step 6: Commit render and simulation conversion**

Commit subject: `refactor(core): Render lines from operational services`.

## Task 6: Convert editor selection and mutations

**Files:**

- Modify: `apps/web/src/editor/store.ts`
- Modify: `apps/web/src/editor/actions/serviceActions.ts`
- Modify: `apps/web/src/editor/actions/blockedNotes.ts`
- Modify: `apps/web/src/editor/actions/pointActions.ts`
- Modify: `apps/web/src/editor/useSelectionActions.ts`
- Modify: `apps/web/src/map/interactions.ts`
- Modify: `apps/web/src/map/sourceFeatureProjection.ts`
- Modify: `apps/web/src/map/selectionFocus.ts`
- Modify: `apps/web/src/map/MapCanvas.tsx`
- Modify: focused editor/map tests

- [ ] **Step 1: Add failing Line-first selection tests**

Assert first canvas selection returns `{ kind: 'line', id }`, explicit deep selection returns `{ kind: 'service', id }`, switching Network to Diagram preserves Line selection, and switching to Infrastructure retains the Line while highlighting supporting ways.

- [ ] **Step 2: Add failing atomic creation/deletion tests**

Assert the Lines tool creates one Line plus one Service in one undo step; adding a branch creates one Service and appends membership; deleting a sole Service deletes the Line; deleting a multi-Service child leaves the Line and its other Services.

- [ ] **Step 3: Run focused tests to verify failure**

Run:

```bash
pnpm --filter @transitmapper/web exec vitest run tests/editor/actions/serviceActions.test.ts tests/editor/networkGestureStore.test.ts tests/map/interactions.test.ts tests/map/sourceFeatureProjection.test.ts tests/map/viewEditorState.test.ts
```

- [ ] **Step 4: Add explicit Line and Service selection state**

Extend `Selection` and multi-selection with `line`. Remove public Pattern focus state; Service id uniquely identifies the editable path. Keep transient terminus/run/leg positions nested under Service editing state. Resolve map feature hits to Line by default and expose deep Service selection as an explicit command.

- [ ] **Step 5: Convert store commands atomically**

Create and update Lines and Services through focused helpers instead of duplicating nested immutable-array edits throughout the store. Preserve undo boundaries, reconciliation behavior, infrastructure adoption, through-routing, split/trim, skipped Stops, and current pointer intent.

- [ ] **Step 6: Run focused tests and web typecheck**

Expected: selection and mutation tests PASS; remaining web errors are UI/fixture consumers covered by Tasks 7–9.

- [ ] **Step 7: Commit editor conversion**

Commit subject: `feat(web): Select lines before their services`.

## Task 7: Build pure outline projections and state

**Files:**

- Create: `packages/core/src/model/system-outline.ts`
- Create: `packages/core/tests/model/system-outline.test.ts`
- Create: `apps/web/src/ui/outline-state.ts`
- Modify: `apps/web/src/ui/sidebarOutline.ts`
- Modify: `apps/web/tests/ui/sidebarOutline.test.ts`

- [ ] **Step 1: Write failing view-specific outline tests**

Cover Network/Diagram Lines, compressed single Service, expanded multi-Service, Stop rows, separate Stations, data-driven Infrastructure families, full-collection search with retained ancestors, stable ordering, mixed-mode metadata, and the 150-row cap.

- [ ] **Step 2: Run focused tests to verify failure**

Run:

```bash
pnpm --filter @transitmapper/core exec vitest run tests/model/system-outline.test.ts
pnpm --filter @transitmapper/web exec vitest run tests/ui/sidebarOutline.test.ts
```

- [ ] **Step 3: Implement pure core projections**

Return discriminated plain rows such as `line`, `service`, `stop`, `station`, `infrastructure-family`, and `facility`. Core projections contain ids, labels, counts, mode summaries, nesting, and supporting-selection relations, but no React nodes or browser state.

- [ ] **Step 4: Implement per-view presentation state**

Store search, expansion, scroll restoration keys, and Show more state per `ViewMode`. Search operates before slicing and temporarily reveals a normally compressed Service when it is the direct match.

- [ ] **Step 5: Run focused tests**

Expected: all outline derivation and state tests PASS without mounting React.

- [ ] **Step 6: Commit outline projections**

Commit subject: `feat(core): Project view-specific system outlines`.

## Task 8: Rebuild the responsive Outline panel and chrome

**Files:**

- Modify: `apps/web/src/ui/SidebarPanel.tsx`
- Modify: `apps/web/src/ui/Workbench.tsx`
- Modify: `apps/web/src/ui/TopBar.tsx`
- Modify: `apps/web/src/ui/FileMenu.tsx`
- Modify: `apps/web/src/ui/Icon.tsx`
- Modify: `apps/web/src/map/lucideIconNodes.ts`
- Modify: `apps/web/src/ui/app.css`
- Modify: `apps/web/tests/ui/SidebarPanel.test.tsx`
- Modify: `apps/web/tests/ui/SidebarPanelInteraction.test.tsx`
- Modify: `apps/web/tests/ui/Workbench.test.tsx`
- Modify: `apps/web/tests/ui/WorkbenchMotion.test.tsx`
- Modify: `apps/web/tests/ui/touch-targets.test.ts`

- [ ] **Step 1: Add failing structure and chrome tests**

Assert there is one Outline toolbar, no Workspace label, no Lines/Corridors control, no Vehicles placeholder, a TransitMapper menu trigger with disclosure semantics, a local left-panel collapse action, and global Hide UI in the menu. Assert compact titles are `Network outline`, `Infrastructure outline`, and `Diagram outline`.

- [ ] **Step 2: Add failing hierarchy and accessibility tests**

Mount single- and multi-Service Lines. Verify disclosure does not select, rows select/focus, hovering highlights without selecting, single Services skip a visible row without false ARIA ownership, multi-Service rows are announced, search reveals context, roving focus excludes utilities, and Show more/search cover full data. Mount a throwing outline section and assert its concise retry action leaves the canvas, other outline sections, and inspector mounted.

- [ ] **Step 3: Run UI tests to verify failure**

Run:

```bash
pnpm --filter @transitmapper/web exec vitest run tests/ui/SidebarPanel.test.tsx tests/ui/SidebarPanelInteraction.test.tsx tests/ui/Workbench.test.tsx tests/ui/WorkbenchMotion.test.tsx tests/ui/touch-targets.test.ts
```

- [ ] **Step 4: Replace sidebar structure**

Render document header, Outline toolbar, and scrollable view projection. Use separate disclosure and selection buttons. Keep the right inspector as the only property editor. Route row hover through transient map highlighting without touching editor history. Isolate section rendering so one failed projection reports a retryable section-level failure while the rest of the editor remains usable. Remove old grouping and placeholder code instead of leaving compatibility branches.

- [ ] **Step 5: Correct menu and panel controls**

Use the TransitMapper mark plus disclosure for FileMenu. Add real panel-open/panel-close icon nodes. Make the header action collapse only the left panel; keep global Hide UI in FileMenu and retain its shortcut. Preserve the existing no-snap collapse motion and reduced-motion path.

- [ ] **Step 6: Implement compact titles and state preservation**

Pass active-view outline titles into the sheet handle. Preserve each view's expansion/search/scroll state when switching views and when collapsing/reopening the panel.

- [ ] **Step 7: Run focused UI tests and visual smoke check**

Run Task 8 tests. Start the app locally and inspect desktop, narrow, short-landscape, light, and dark states for hierarchy, truncation, focus, and the two corrected top controls. Capture screenshots for the PR description.

- [ ] **Step 8: Commit panel UI**

Commit subject: `feat(web): Replace Workspace with the system outline`.

## Task 9: Split Line and Service inspectors and finish fixtures

**Files:**

- Create: `apps/web/src/ui/line-inspector.tsx`
- Create: `apps/web/tests/ui/line-inspector.test.tsx`
- Modify: `apps/web/src/ui/Inspector.tsx`
- Modify: `apps/web/src/ui/inspector/ServiceInspector.tsx`
- Modify: `apps/web/src/ui/inspector/StationInspector.tsx`
- Modify: `apps/web/src/ui/inspector/GroupInspector.tsx`
- Modify: `apps/web/src/ui/ScheduleDialog.tsx`
- Modify: `apps/web/src/ui/onboarding/fixtureSystem.ts`
- Modify: `apps/web/src/perf/fixtures.ts`
- Modify: `apps/web/src/embed/main.ts`
- Modify: `apps/web/src/storage/serializeSystem.ts`
- Modify: remaining web tests and fixtures that construct old Services/Patterns

- [ ] **Step 1: Add failing inspector tests**

Assert Line inspector edits name/color and summarizes Services; a compressed sole Service exposes mode/schedule through Edit service; Add service asks for a distinct label and mode; Service inspector edits path/vehicle/schedule without changing Line public identity; Station inspector lists calling Services under their Lines.

- [ ] **Step 2: Run inspector tests to verify failure**

Run:

```bash
pnpm --filter @transitmapper/web exec vitest run tests/ui/line-inspector.test.tsx tests/ui/Inspector.test.tsx tests/ui/inspector/ServiceInspector.test.ts tests/storage/serializeSystem.test.ts tests/ui/onboarding/fixtureProjection.test.ts tests/perf/fixtures.test.ts
```

Expected: FAIL because Line selection has no inspector and the remaining fixtures still use the old document shape.

- [ ] **Step 3: Implement Line inspector and simplify Service inspector**

Keep public fields in `line-inspector.tsx`. Keep operational fields and schedule dialog in Service inspector. Use shared small field components rather than conditionalizing one large inspector over both entities.

- [ ] **Step 4: Convert every shipped fixture and worker protocol**

Update onboarding, performance, embed, storage, GTFS worker, and test fixtures to v15 Lines+Services. Do not keep a production compatibility adapter; old documents enter only through the serializer migration.

- [ ] **Step 5: Run web verify and typecheck**

Run:

```bash
pnpm --filter @transitmapper/web typecheck
pnpm --filter @transitmapper/web verify
```

Expected: PASS with no production `.patterns` access and no public Pattern language.

- [ ] **Step 6: Commit inspectors and fixtures**

Commit subject: `feat(web): Edit public lines and operating services`.

## Task 10: Update product documentation and retire contradictory guidance

**Files:**

- Modify: `docs/product/reference/data-model.md`
- Modify: `docs/product/explanation/views.md`
- Modify: `docs/product/explanation/simulation.md`
- Modify: `docs/product/explanation/geometry-and-routing.md`
- Modify: `docs/product/how-to/route-services.md`
- Modify: `docs/product/tutorials/getting-started.md`
- Modify: `docs/development/reference/project-structure.md`
- Modify: `docs/superpowers/specs/2026-07-28-view-specific-sidebar-design.md`

- [ ] **Step 1: Audit user-facing terminology**

Run:

```bash
rg -n "Workspace|Group by|Corridors|Corridor|\bline\b|\bservice\b|Pattern" docs apps/web/src packages/core/src
```

Classify each result as public Line, technical Service, physical infrastructure, internal path, ordinary English geography, or reserved future Corridor study.

- [ ] **Step 2: Rewrite current documentation**

Document schema v15, public Line identity, one-mode Service operation, derived Stops, physical Stations, the three projections, Outline behavior, per-Service simulation, and GTFS route/service import. Update project structure with the core projection and web presentation boundaries.

- [ ] **Step 3: Supersede the old sidebar spec**

Add a clear note at the top of the 2026-07-28 spec pointing to the implemented 2026-08-10 design. Do not edit history to pretend the earlier decision was never made.

- [ ] **Step 4: Run documentation and format checks**

Run:

```bash
pnpm check:docs
pnpm check:documents
pnpm format:check
```

Expected: PASS.

- [ ] **Step 5: Commit documentation**

Commit subject: `docs: Explain lines, services, and the system outline`.

## Task 11: Review, simplify, and verify the complete implementation

**Files:**

- Review every file changed from `origin/main...HEAD`.
- Modify only files whose review findings are directly related to this feature.

- [ ] **Step 1: Run the complete gate before review**

Run:

```bash
pnpm check
```

Expected: all workspace tasks successful.

- [ ] **Step 2: Perform a requirement-by-requirement code review**

Compare the implementation to every section of `docs/superpowers/specs/2026-08-10-sidebar-information-architecture-design.md`. Review for model dual sources, dropped migration references, Line/Service semantic confusion, duplicated store mutations, inaccessible compressed rows, view-state loss, misleading control effects, unbounded lists, and stale Corridor/Workspace language.

- [ ] **Step 3: Simplify code found during review**

Extract repeated Line/Service lookups into core helpers, remove compatibility branches after all callers migrate, split oversized UI logic by responsibility, and delete dead Pattern/Corridor projection code. Add or strengthen tests for every behavioral review finding before changing implementation.

- [ ] **Step 4: Run focused tests for review fixes**

Run the exact test files covering each fix and confirm they fail before the fix and pass after it.

- [ ] **Step 5: Run the complete gate again**

Run `pnpm check` fresh. Expected: all tasks successful with a clean worktree after committing review fixes.

- [ ] **Step 6: Commit review simplifications**

Commit subject: `refactor: Simplify line and outline boundaries`.

## Task 12: Publish, review CI, and merge

**Files:**

- No source files unless CI or review exposes a real defect.

- [ ] **Step 1: Rebase onto current remote main**

Run `git fetch --prune origin`, inspect divergence, and rebase the branch onto current `origin/main`. Resolve only feature-owned conflicts, then rerun `pnpm check`.

- [ ] **Step 2: Push the feature branch**

Push `codex/sidebar-information-architecture` and verify the remote head matches local HEAD.

- [ ] **Step 3: Open a ready pull request**

Create a non-draft PR summarizing the vocabulary/model migration, view-specific Outline, corrected panel/menu behavior, responsive/accessibility behavior, documentation, screenshots, and full local verification. Include repository-required contribution metadata.

- [ ] **Step 4: Review the PR diff and automated feedback**

Inspect the hosted diff, unresolved review threads, and newest CI run. Address actionable findings with tests and focused commits; do not dismiss semantic or migration concerns as cosmetic.

- [ ] **Step 5: Wait for required checks**

Confirm every required check is green on the latest pushed commit and the PR is mergeable with no unresolved conversations.

- [ ] **Step 6: Merge and verify main**

Use the repository's linear merge method, confirm the PR is merged, fetch remote state, and prove the resulting `origin/main` contains the feature commit/history and has no merge commit introduced by this work.
