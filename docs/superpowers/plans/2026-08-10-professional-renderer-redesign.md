# Professional Renderer Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Infrastructure, Network, and Diagram rendering around screen-space detail, cached derived geometry, viewport culling, incremental source updates, and continuous visual evidence without reducing settled fidelity.

**Architecture:** Keep MapLibre as the geographic renderer. Project the immutable system through cached topology, metric geometry, presentation, and stable-ID diff stages; use a dedicated worker for Diagram layout. Every live and static surface consumes the same presentation contract and resolved scene.

**Tech Stack:** TypeScript, GeoJSON, MapLibre GL JS, Vitest, Playwright Core, Web Workers, SVG, pnpm/Turborepo.

## Global Constraints

- Settled geometry is authoritative and identical regardless of cache, scheduling, or interaction speed.
- Progressive work may change when detail appears, never what completed detail contains.
- Overview visual feature count must not scale with lane count.
- LOD is selected from displayed screen size, with District enter/leave thresholds of 3/2 px and Street enter/leave thresholds of 12/9 px.
- Adjacent tiers cross-fade through 2–4 px and 9–12 px bands; inactive heavy tiers are absent outside their overlap.
- Preserve interaction-to-next-paint p95 at or below 50 ms, painted-frame p95 at or below 16.7 ms, fewer than 1% of frames over 33.3 ms, no unexpected long task over 50 ms, and no checked/base median regression over 10%.
- Performance work may not hide feedback, simplify the settled result, weaken accessibility, or make exports diverge.
- Use “corridor” and “junction” in user-facing text; retain `Way` and `Node` internally.
- New dependencies use the pnpm catalog. New modules and assets use kebab-case. Parameter and prop types are named interfaces.
- Derived meshes and layouts stay transient. Existing documents load with automatic curves and require no database migration.
- Capture deterministic screenshots before work, after every task, and after later geometry/style/LOD changes; show the baseline/current contact sheet before beginning the next task.
- Each task ends with focused tests, screenshot evidence, performance evidence proportional to risk, documentation where behavior or architecture changed, and `pnpm check`-compatible code.

---

### Task 1: Baseline, Instrumentation, and Screenshot Harness

**Files:**

- Create renderer capture fixtures, Playwright capture script, contact-sheet generator, and focused tests under `apps/web/src/perf`, `apps/web/scripts`, and `apps/web/tests/`.
- Modify workspace scripts, performance documentation, and artifact ignores/configuration.

**Interfaces:**

- Produces `pnpm renderer:capture -- --phase <name>`.
- Produces deterministic artifacts under `apps/web/artifacts/renderer/<phase>/`.
- Produces renderer statistics for projection-stage duration, candidates, visible features, vertices, patch size, cache hits, tier transitions, and full/differential uploads.

- [ ] Write failing tests for capture-matrix expansion, deterministic names, renderer statistics, and contact-sheet ordering.
- [ ] Verify the tests fail for the missing harness and counters.
- [ ] Add Port Mason, dense downtown, RTC, junction, grade, curve, rail, service-branch, and Diagram fixture descriptors using existing system generators where possible.
- [ ] Implement the capture command with fixed cameras, themes, desktop/mobile profiles, a deterministic bundled basemap, settled-source/font/paint waits, fractional-zoom filmstrips, and baseline/previous/current/diff contact sheets.
- [ ] Extend existing performance instrumentation without changing production behavior.
- [ ] Capture `00-baseline` before renderer behavior changes and run desktop/mobile performance baselines.
- [ ] Run focused tests and documentation checks; commit the task.

### Task 2: Shared Scene Contract and Screen-Space LOD

**Files:**

- Create focused presentation, scene, identity, dependency-index, and diff modules under `packages/core/src/render/`.
- Modify core feature projection, MapCanvas/source upload planning, layers, and every buildFeatures caller.
- Test under owning core/web `tests/` trees.

**Interfaces:**

- Produce `RenderPresentation`, `RenderTier`, `RenderScene`, `RenderSceneStats`, and `RenderScenePatch`.
- Produce stable top-level feature IDs and differential live source updates.
- Remove `laneDetail?: boolean` after all callers use `RenderPresentation`.

- [ ] Write failing tests for exact thresholds, hysteresis, cross-fade values, stable IDs, lane-count-independent Overview features, viewport candidate filtering, dependency invalidation, and scene diffs.
- [ ] Verify each test fails for the intended missing behavior.
- [ ] Implement cached topology and presentation stages plus the immutable viewport index.
- [ ] Replace the distant lane fan with one hierarchy-aware corridor silhouette and add District footprints.
- [ ] Apply stable-ID patches through `GeoJSONSource.updateData`, retaining full-set fallback only for initial load or incompatible sources.
- [ ] Keep gesture feedback until the exact committed scene paints; use feature state for hover/selection/filter/theme changes.
- [ ] Capture `01-lod` plus fractional-zoom filmstrips, run focused tests and RTC smoke, update docs, and commit.

### Task 3: Metric Curves and Physical Corridor Geometry

**Files:**

- Create focused metric curve, boundary, cross-section mesh, and rail geometry modules under `packages/core/src/geometry/`.
- Modify the system model/serialization and physical render projection.
- Test model mutation, migration, geometry, and rendering under module-owned tests.

**Interfaces:**

- Add optional per-interior-point metric curve controls; absence means automatic radius.
- Produce cached metric centerlines and watertight cross-section polygons adaptively tessellated to at most 0.35 displayed-pixel error.

- [ ] Write and verify failing tests for latitude invariance, tessellation error, tight-radius clamping, positive polygon areas, shared boundaries, curve-control serialization/reindex/reverse/split behavior, and cache reuse.
- [ ] Resolve all curve geometry in a local metric plane and replace fixed ten-sample quadratic curves with tangent-continuous metric fillets.
- [ ] Generate Overview guideways, District carriageway footprints, and Street polygons for travel lanes, sidewalks, parking, shoulders, medians, curbs, and tracks.
- [ ] Render rail as a clean small-tier guideway and twin rails with gauge/ties at Street.
- [ ] Capture `02-physical-geometry`, run focused tests and RTC smoke, update docs, and commit.

### Task 4: Junctions, Controls, Grade, and Service Connectors

**Files:**

- Refine `packages/core/src/geometry/junctions.ts` into focused geometry modules as needed.
- Modify physical projection, layer specs, render input classification, and junction/control tests.

**Interfaces:**

- Junction geometry consumes resolved approach tangents, cross-section boundaries, connectors, controls, and grade.
- Output includes watertight surfaces, curb returns, tapers, islands, markings, control symbols, and stitched service paths.

- [ ] Write and verify failing tests for resolved tangents, corner continuity, arm counts, connector tangency, grade ordering, control rendering, and dependency-scoped invalidation.
- [ ] Build rounded junction surfaces with medians, crosswalks, stop bars, refuges, and tapers.
- [ ] Stitch service paths through junctions using routing/simulation connectors.
- [ ] Render signals, stops, yields, roundabouts, bridges, tunnels, level crossings, and non-junction crossings distinctly.
- [ ] Capture `03-junctions`, run focused tests and RTC smoke, update docs, and commit.

### Task 5: Network Service Cartography

**Files:**

- Replace global service slotting with focused shared-chain and junction-order modules under `packages/core/src/render/`.
- Modify service/station/label projection and relevant MapLibre layers.

**Interfaces:**

- Produce deterministic per-chain service ordering, smooth offset transitions, screen-space marker density, and lane-contained Street service geometry.

- [ ] Write and verify failing tests for centered solo lines, stable shared ordering, merge/split crossing minimization, smooth transitions, assigned-lane containment, and filter-independent infrastructure classification.
- [ ] Implement maximal shared-chain ordering and deterministic junction-local crossing minimization.
- [ ] Add smooth bundle expansion/contraction and tier-aware service widths.
- [ ] Apply screen-space density to stations, termini, arrows, facilities, and labels.
- [ ] Capture `04-network`, run focused tests and RTC smoke, update docs, and commit.

### Task 6: Worker-Owned Diagram Layout

**Files:**

- Replace `packages/core/src/model/diagramLayout.ts` with focused pure topology/layout modules.
- Add a web Worker adapter and Diagram presentation cache under `apps/web/src/map/`.
- Add core and web tests for solver behavior, worker lifecycle, and transitions.

**Interfaces:**

- Produce deterministic `DiagramLayoutResult` with stable node positions, routed edges, service ordering, station anchors, label anchors, and topology revision.

- [ ] Write and verify failing tests for determinism, topology preservation, crossing reduction, octilinear routing, node/label clearance, unaffected-subgraph stability, caching, and worker failure fallback.
- [ ] Collapse degree-two chains while retaining semantic nodes; seed from geography and the prior layout.
- [ ] Implement deterministic octilinear port assignment, crossing/bend/displacement/crowding costs, node separation, and label candidates.
- [ ] Run the solver in a dedicated Worker, retain the previous valid layout while solving, and morph stable IDs over 180 ms.
- [ ] Capture `05-diagram`, run focused tests and RTC smoke, update docs, and commit.

### Task 7: Cross-Surface Parity, Optimization, and Cutover

**Files:**

- Modify live, onboarding, embed, share, export-preview, PNG, SVG, performance, and documentation modules.
- Remove legacy renderer paths after parity and gates pass.

**Interfaces:**

- Every consumer supplies `RenderPresentation` and renders resolved `RenderScene` geometry.
- SVG consumes resolved polygons and offsets instead of recreating MapLibre paint behavior.

- [ ] Write and verify failing parity tests across live/SVG/static consumers and source-structure comparisons.
- [ ] Complete cross-surface integration and deterministic presentation sizing.
- [ ] Remove hot-loop allocations, cap label candidates per screen cell, exclude inactive tiers, and prove dependency-scoped rebuilds.
- [ ] Run desktop/mobile RTC profiles with simulation running and paused, the ten-minute soak, structural/visual parity, and the complete correctness suite.
- [ ] Capture `06-final` and the baseline-to-final contact sheet; promote approved deterministic images to visual goldens.
- [ ] Remove the legacy lane fan, fixed threshold, old Diagram relaxation engine, and internal comparison flag.
- [ ] Update architecture, geometry/routing, views, sharing/export, performance, screenshot, and project-structure documentation.
- [ ] Run `CI=1 pnpm check`, complete whole-branch review, and commit the cutover.
