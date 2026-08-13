# Stations, Stops, and Service Calls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the overloaded passenger-place record with physical Stops, optional Stations, and derived Service calls throughout saved documents and the editor.

**Architecture:** Schema v16 stores `stops` and `stations` separately, with optional `Stop.stationId` as the sole containment reference. Core owns migration, repair, call projection, simulation inputs, and rendering features; web owns distinct selection, commands, outline presentation, and inspectors.

**Tech Stack:** TypeScript, React, Zustand editor store, MapLibre feature projection, Vitest, repository `check()` verifiers.

---

### Task 1: Add the v16 passenger-place boundary

**Files:**

- Create: `packages/core/src/model/system/stop.ts`
- Modify: `packages/core/src/model/system/station.ts`
- Modify: `packages/core/src/model/system/document.ts`
- Modify: `packages/core/src/model/system.ts`
- Modify: `packages/core/src/model/serialize.ts`
- Test: `packages/core/tests/model/documentRepair.test.ts`
- Test: `packages/core/tests/model/serialize.test.ts`
- Modify: `packages/core/tests/support/fixtures.test.ts`

- [ ] **Step 1: Write failing migration and repair tests**

Add cases proving that a v15 plain passenger point becomes only a Stop, a
footprint-bearing point becomes a Stop plus a containing Station, IDs used by
skip rules remain Stop IDs, missing `stationId` references are repaired, and
duplicate Stop or Station IDs are rejected.

```ts
expect(parseSystem(v15Plain).stops).toEqual([
  expect.objectContaining({ id: 'platform', anchors: [{ wayId: 'way', t: 0.5 }] }),
]);
expect(parseSystem(v15Plain).stations).toEqual([]);
expect(parseSystem(v15Footprint).stations[0]).toEqual(
  expect.objectContaining({ id: 'platform-station', name: 'Central' }),
);
expect(parseSystem(v15Footprint).stops[0].stationId).toBe('platform-station');
```

- [ ] **Step 2: Run the focused core tests and confirm RED**

Run: `pnpm --filter @transitmapper/core exec vitest run tests/model/documentRepair.test.ts tests/model/serialize.test.ts`

Expected: FAIL because schema v16, `Stop`, and `TransitSystem.stops` do not yet exist.

- [ ] **Step 3: Implement the model and migration**

Define Stop as the Way-anchored boarding point and narrow Station to the complex:

```ts
export interface Stop {
  id: string;
  name?: string;
  autoNamed?: boolean;
  coord: LngLat;
  anchors: StopAnchor[];
  stationId?: string;
  dwellSeconds?: number;
  major?: boolean;
}

export interface Station {
  id: string;
  name?: string;
  coord: LngLat;
  footprint?: LngLat[];
  platforms?: Platform[];
}
```

Make the v16 parser accept `stops` and `stations`; make the legacy parser map
every old Station to a Stop and create a collision-safe `-station` record only
when footprint or platform data exists. Repair missing Station references and
Way anchors at the document boundary.

- [ ] **Step 4: Run the focused tests and confirm GREEN**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Commit the model boundary**

Commit subject: `feat(core): separate stations from stops`

### Task 2: Move path, editing, and simulation semantics to Stops

**Files:**

- Rename: `packages/core/src/model/station-reanchoring.ts` to `packages/core/src/model/stop-reanchoring.ts`
- Modify: `packages/core/src/model/geo/crossStreetNaming.ts`
- Modify: `packages/core/src/model/geo/servicePaths.ts`
- Modify: `packages/core/src/model/selection-deletion.ts`
- Modify: `packages/core/src/model/selection-nudge.ts`
- Modify: `packages/core/src/model/*-edits.ts`
- Modify: `packages/core/src/sim/frequency.ts`
- Modify: `packages/core/src/sim/serviceStats.ts`
- Test: `packages/core/tests/model/stop-reanchoring.test.ts`
- Test: `packages/core/tests/model/selection-deletion.test.ts`
- Test: `packages/core/tests/sim/serviceStats.test.ts`

- [ ] **Step 1: Rename fixture APIs and write failing Stop behavior tests**

Add `aStop`, preserve `aStation` for real Stations, and assert that Way edits
move Stops but not Stations, deleting a Stop prunes skip rules and Station
membership, deleting a Station preserves and unparents its Stops, and service
statistics derive calls from Stops.

```ts
expect(deleteSelection(system, [{ kind: 'station', id: station.id }]).stops).toEqual([
  { ...stop, stationId: undefined },
]);
expect(deleteSelection(system, [{ kind: 'stop', id: stop.id }]).stations).toEqual([station]);
```

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `pnpm --filter @transitmapper/core exec vitest run tests/model/stop-reanchoring.test.ts tests/model/selection-deletion.test.ts tests/sim/serviceStats.test.ts`

Expected: FAIL on the missing Stop selection and old `stations` simulation input.

- [ ] **Step 3: Change pure model operations to Stops**

Reanchor and name Stops, derive service calls from `system.stops`, and index
Station containment once per collection identity. Keep Station geometry out of
Way mutation paths. Add `ServiceCall` as the named projection returned by stop
ordering helpers without serializing it.

- [ ] **Step 4: Run all core tests and confirm GREEN**

Run: `pnpm --filter @transitmapper/core verify`

Expected: PASS.

- [ ] **Step 5: Commit the pure behavior migration**

Commit subject: `refactor(core): derive service calls from stops`

### Task 3: Preserve GTFS passenger-place hierarchy

**Files:**

- Modify: `packages/core/src/model/gtfsImport.ts`
- Modify: `apps/web/src/editor/store/contracts/import-routing-commands.ts`
- Modify: `apps/web/src/editor/store/commands/import-commands.ts`
- Test: `packages/core/tests/model/gtfsImport.test.ts`
- Test: `apps/web/tests/editor/store/import-command-factories.test.ts`
- Test: `apps/web/tests/import/streamRtcGtfs.test.ts`

- [ ] **Step 1: Add failing hierarchy tests**

Use a feed fixture containing a `location_type=1` parent and two platform Stops.
Assert one Station, two Stops pointing to it, shared identity across batches,
and no invented Station for a feed without `parent_station`.

```ts
expect(result.stations).toHaveLength(1);
expect(result.stops.map((stop) => stop.stationId)).toEqual([
  result.stations[0].id,
  result.stations[0].id,
]);
```

- [ ] **Step 2: Run GTFS tests and confirm RED**

Run: `pnpm --filter @transitmapper/core exec vitest run tests/model/gtfsImport.test.ts`

Expected: FAIL because import output still exposes every GTFS stop as Station.

- [ ] **Step 3: Implement declared GTFS hierarchy**

Return `stops` and `stations`; map `location_type=1` to Station, map boarded
records to Stop, resolve `parent_station`, and share both dedup maps across
streamed route batches. Do not synthesize parents from names or proximity.

- [ ] **Step 4: Run core and web import tests and confirm GREEN**

Run the three test files listed above from their owning packages. Expected:
PASS.

- [ ] **Step 5: Commit import behavior**

Commit subject: `feat(import): preserve gtfs stations and stops`

### Task 4: Split physical Stop and Station editor commands

**Files:**

- Create: `apps/web/src/editor/store/commands/stop-commands.ts`
- Modify: `apps/web/src/editor/store/commands/station-commands.ts`
- Modify: `apps/web/src/editor/store/contracts/place-commands.ts`
- Modify: `apps/web/src/editor/store/create-editor-store.ts`
- Modify: `apps/web/src/editor/store/state.ts`
- Modify: `apps/web/src/editor/store/transient-references.ts`
- Modify: `apps/web/src/editor/keymap.ts`
- Test: `apps/web/tests/editor/store/place-command-factories.test.ts`
- Test: `apps/web/tests/editor/keymap.test.ts`

- [ ] **Step 1: Add failing command and deletion tests**

Assert `addStop` selects `{ kind: 'stop' }`, `addDrawnStation` creates only a
Station, attaching and detaching a Stop updates `stationId`, deleting a Station
preserves its Stops, and Delete on a Service call remains a no-op.

- [ ] **Step 2: Run the focused editor tests and confirm RED**

Run: `pnpm --filter @transitmapper/web exec vitest run tests/editor/store/place-command-factories.test.ts tests/editor/keymap.test.ts`

Expected: FAIL on missing Stop commands and selection kind.

- [ ] **Step 3: Implement distinct command groups**

Expose `commands.stops` for boarding-point lifecycle and metadata. Limit
`commands.stations` to complex lifecycle, physical geometry, and Stop
membership. Update transient reference validation and keyboard deletion for the
new selection kinds.

- [ ] **Step 4: Run editor-store tests and confirm GREEN**

Run: `pnpm --filter @transitmapper/web exec vitest run tests/editor/store tests/editor/keymap.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit editor commands**

Commit subject: `feat(editor): edit stops and stations distinctly`

### Task 5: Render and interact with Stops and Stations distinctly

**Files:**

- Modify: `packages/core/src/render/buildFeatures.ts`
- Modify: `packages/core/src/render/featureInputs.ts`
- Modify: `packages/core/src/render/featureMemo.ts`
- Modify: `apps/web/src/map/MapCanvas.tsx`
- Modify: `apps/web/src/map/interactions.ts`
- Modify: `apps/web/src/map/selectionFocus.ts`
- Modify: `apps/web/src/map/gestureProjection.ts`
- Modify: `apps/web/src/map/layers/layerSpecs.ts`
- Test: `packages/core/tests/render/buildFeatures.test.ts`
- Test: `apps/web/tests/map/interactions.test.ts`
- Test: `apps/web/tests/map/sourceFeatureProjection.test.ts`

- [ ] **Step 1: Add failing feature and interaction tests**

Assert Network emits one Stop marker per physical Stop and no duplicate Station
marker, Infrastructure emits Station footprints/platforms plus Stop points,
Stop clicks select `kind: 'stop'`, and Station footprint clicks select
`kind: 'station'`.

- [ ] **Step 2: Run focused render and interaction tests and confirm RED**

Run the listed files with each package's Vitest command. Expected: FAIL because
all point features still use Station identity.

- [ ] **Step 3: Implement separate feature identities**

Project Stop point features from `system.stops`; project Station complex
features only where meaningful. Carry `stopId` and `stationId` separately
through selection, focus, gesture masks, and feature state.

- [ ] **Step 4: Run render and map tests and confirm GREEN**

Run: `pnpm --filter @transitmapper/core exec vitest run tests/render`

Run: `pnpm --filter @transitmapper/web exec vitest run tests/map`

Expected: PASS.

- [ ] **Step 5: Commit rendering and interactions**

Commit subject: `feat(map): distinguish stops from stations`

### Task 6: Present the distinction in the outline, toolbar, and inspectors

**Files:**

- Create: `apps/web/src/ui/inspector/StopInspector.tsx`
- Modify: `apps/web/src/ui/inspector/StationInspector.tsx`
- Modify: `apps/web/src/ui/Inspector.tsx`
- Modify: `apps/web/src/ui/sidebarOutline.ts`
- Modify: `apps/web/src/ui/SidebarPanel.tsx`
- Modify: `apps/web/src/ui/Toolbar.tsx`
- Modify: `apps/web/src/ui/Workbench.tsx`
- Test: `apps/web/tests/ui/sidebarOutline.test.ts`
- Test: `apps/web/tests/ui/SidebarPanel.test.tsx`
- Test: `apps/web/tests/ui/SidebarPanelInteraction.test.tsx`
- Test: `apps/web/tests/ui/Workbench.test.tsx`

- [ ] **Step 1: Add failing semantic UI tests**

Assert Line descendants are Service calls labeled Stop, standalone boarding
points appear under Stops, Stations appear only when present, accessible names
include Service context, Stop and Station rows select their own physical kinds,
and the tool says Stop in Network and Station when drawing infrastructure.

- [ ] **Step 2: Run focused UI tests and confirm RED**

Run: `pnpm --filter @transitmapper/web exec vitest run tests/ui/sidebarOutline.test.ts tests/ui/SidebarPanel.test.tsx tests/ui/SidebarPanelInteraction.test.tsx tests/ui/Workbench.test.tsx`

Expected: FAIL on the missing Stops section and inspector split.

- [ ] **Step 3: Implement the view projections and inspectors**

Keep Service call rows compressed under one-Service Lines. Add bounded physical
Stops and Stations sections. Move stop-specific fields to StopInspector and
make StationInspector manage footprint, contained Stops, and aggregated Lines.

- [ ] **Step 4: Run focused UI tests and confirm GREEN**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Commit the public experience**

Commit subject: `feat(editor): clarify passenger places`

### Task 7: Update architecture and product documentation

**Files:**

- Modify: `docs/product/reference/data-model.md`
- Modify: `docs/product/reference/editor-interactions.md`
- Modify: `docs/product/how-to/design-stations.md`
- Modify: `docs/product/how-to/route-services.md`
- Modify: `docs/product/explanation/simulation.md`
- Modify: `docs/product/tutorials/getting-started.md`
- Modify: `docs/development/reference/project-structure.md`

- [ ] **Step 1: Replace the overloaded definitions**

Document v16, Stop ownership, Station containment, derived Service calls, GTFS
hierarchy, deletion semantics, and the core/web boundary. Remove guidance that
calls every boarding point a Station.

- [ ] **Step 2: Run documentation checks**

Run: `pnpm check:docs`

Expected: PASS with all relative links resolving.

- [ ] **Step 3: Commit documentation**

Commit subject: `docs: explain passenger place hierarchy`

### Task 8: Verify the complete change and prepare the PR

**Files:**

- Modify as needed: tests and docs named above only when verification reveals a
  regression attributable to this change.

- [ ] **Step 1: Run focused regression suites**

Run all Stop, Station, GTFS, sidebar, inspector, map, render, migration, and
simulation test files changed in Tasks 1–7. Expected: PASS with zero failures.

- [ ] **Step 2: Run the authoritative repository gate**

Run: `CI=1 pnpm check`

Expected: all formatting, lint, typecheck, tests, docs, configuration, debt, and
repository invariants pass.

- [ ] **Step 3: Perform live visual verification**

Open the app at desktop and compact widths. Verify a standalone Stop, a Station
containing multiple Stops, Service call selection, Network outline hierarchy,
Infrastructure sections, inspector headings, and the previously fixed top-nav
sidebar close control. Save screenshots to the task visualization directory.

- [ ] **Step 4: Inspect the owned diff and commit final corrections**

Run: `git diff --check`, `git status --short`, and compare the complete branch to
`origin/main`. Expected: clean worktree and only passenger-place/sidebar work.

- [ ] **Step 5: Push and create the pull request through the mandatory helper**

Push `codex/stations-stops-calls`, build the repository PR body from the pinned
contribution template, preview it with `github-create.mjs --dry-run --json`,
inspect the full visible Markdown, then create it with the same helper.
