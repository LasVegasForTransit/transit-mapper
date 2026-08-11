# Real-Geography Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the generic Port Mason onboarding scenes with a deterministic central Las Vegas proposal and make drawing, infrastructure, schedules, simulation, and phone navigation visually self-evident.

**Architecture:** Keep onboarding passive and local. A generated OpenStreetMap snapshot supplies real street context, one valid Las Vegas `TransitSystem` supplies production projection and simulation, pure scene helpers describe preview/selection state, and shared production Schedule and simulation-control presentations prevent onboarding-only UI drift.

**Tech Stack:** React 19, TypeScript, MapLibre GL, GeoJSON, OpenStreetMap/Overpass, Vitest, pnpm, Turborepo

---

### Task 1: Replace the fictional fixture with central Las Vegas

**Files:**

- Create: `apps/web/scripts/generate-onboarding-las-vegas-context.ts`
- Create: `apps/web/src/ui/onboarding/las-vegas-context-data.json`
- Create: `apps/web/src/ui/onboarding/las-vegas-context.ts`
- Modify: `apps/web/src/ui/onboarding/fixtureSystem.ts`
- Delete: `apps/web/src/ui/onboarding/port-mason-context.ts`
- Modify: `apps/web/src/ui/onboarding/slides.tsx`
- Modify: `apps/web/tests/ui/onboarding/fixtureProjection.test.ts`
- Modify: `apps/web/tests/verify.test.ts`
- Modify: `apps/web/package.json`

- [ ] **Step 1: Write failing real-geography fixture tests**

  Require a valid `Central Las Vegas proposal`, `Charleston Crosstown` and
  `Downtown Connector`, Downtown/Huntridge bus patterns, a shared Downtown
  transfer, imported road and rail records within the documented Las Vegas
  bounds, and one authored light-rail connector without OSM provenance.

  Require the context adapter to expose the snapshot attribution and bounding
  box, more than 60 clipped LineStrings, real named Charleston/Las Vegas
  Boulevard/Fremont features, rail geometry, and at least one line with more
  than two coordinates.

- [ ] **Step 2: Run the focused fixture tests and verify RED**

  Run:

  ```bash
  pnpm --filter @transitmapper/web exec vitest run tests/ui/onboarding/fixtureProjection.test.ts
  ```

  Expected: FAIL because Port Mason and its synthetic context remain.

- [ ] **Step 3: Add the reproducible OpenStreetMap context generator**

  Query the fixed central Las Vegas bounding box, select the documented street
  hierarchy and named local grid, clip every LineString to the box, round
  coordinates to seven decimals, retain `osmWayId`, `name`, and `kind`, sort
  deterministically, and write metadata plus the FeatureCollection to
  `las-vegas-context-data.json`.

  Add `generate:onboarding-context` to `apps/web/package.json`; no runtime
  request may call the generator or Overpass.

- [ ] **Step 4: Generate and adapt the local context snapshot**

  Run:

  ```bash
  pnpm --filter @transitmapper/web generate:onboarding-context
  ```

  `las-vegas-context.ts` must validate the committed metadata shape and expose
  typed street features, real-place labels, attribution, and bounds without
  mutating the generated object.

- [ ] **Step 5: Build the Las Vegas proposal from stable model records**

  Replace synthetic grids and polygons with the actual Charleston Boulevard,
  Las Vegas Boulevard, and rail-corridor paths in the approved design. Keep
  imported ways marked `source: 'osm'`, the authored connector unmarked, route
  both services over those ways, derive stations and simulation inputs from
  the same records, and export the authored connector's stable way ID.

  Update the five accessible scene descriptions without changing the approved
  welcome definition, invitation, or actions.

- [ ] **Step 6: Run fixture tests and the sequential verifier GREEN**

  Run:

  ```bash
  pnpm --filter @transitmapper/web exec vitest run tests/ui/onboarding/fixtureProjection.test.ts tests/ui/onboarding/scene-geometry.test.ts
  pnpm --filter @transitmapper/web exec tsx tests/verify.test.ts
  ```

  Expected: PASS with one real-geography proposal and nonzero simulation plans.

- [ ] **Step 7: Commit the fixture and snapshot**

  Commit subject:

  ```text
  feat(web): ground onboarding in central Las Vegas
  ```

### Task 2: Use production preview and selection states

**Files:**

- Modify: `apps/web/src/ui/onboarding/onboarding-map-controller.ts`
- Modify: `apps/web/src/ui/onboarding/scene-geometry.ts`
- Modify: `apps/web/src/ui/app.css`
- Modify: `apps/web/tests/ui/onboarding/scene-geometry.test.ts`
- Modify: `apps/web/tests/ui/onboarding/onboarding-scene-overlay.test.tsx`

- [ ] **Step 1: Write failing scene-presentation tests**

  Add a pure scene-plan assertion that drawing targets the production
  `SRC_PREVIEW` source, Infrastructure selects only the authored connector,
  and every other scene has no highlighted way. Preserve the existing exact
  route-prefix and vehicle-motion assertions.

- [ ] **Step 2: Run the scene tests and verify RED**

  Run:

  ```bash
  pnpm --filter @transitmapper/web exec vitest run tests/ui/onboarding/scene-geometry.test.ts tests/ui/onboarding/onboarding-scene-overlay.test.tsx
  ```

  Expected: FAIL because the controller still uses custom draw/new-link layers.

- [ ] **Step 3: Replace demonstration paint with production state**

  Feed the growing route to `SRC_PREVIEW` so it uses the editor's dashed route
  preview. Replace the circular cursor with a passive CSS crosshair matching
  the line tool's real cursor. Remove `onboarding-new-link` sources/layers and
  set feature state on `SRC_WAYS` for the authored connector in Infrastructure.

  Add source `promoteId` exactly as the production map does so feature state
  addresses stable IDs.

- [ ] **Step 4: Render real context and attribution**

  Replace synthetic polygon layers with the generated Las Vegas street/rail
  context, street-name symbol paint, real-place markers, and MapLibre's compact
  attribution control with the committed OpenStreetMap attribution.

- [ ] **Step 5: Run the focused scene tests GREEN**

  Run:

  ```bash
  pnpm --filter @transitmapper/web exec vitest run tests/ui/onboarding/scene-geometry.test.ts tests/ui/onboarding/onboarding-preview-map.test.tsx tests/ui/onboarding/onboarding-scene-overlay.test.tsx
  ```

- [ ] **Step 6: Commit production scene states**

  Commit subject:

  ```text
  feat(web): show real onboarding map states
  ```

### Task 3: Share public-first Schedule and simulation presentations

**Files:**

- Modify: `apps/web/src/ui/SimControls.tsx`
- Modify: `apps/web/src/ui/inspector/service-load-presentation.tsx`
- Modify: `apps/web/src/ui/inspector/service-schedule-fields.tsx`
- Modify: `apps/web/src/ui/onboarding/onboarding-scene-overlay.tsx`
- Modify: `apps/web/src/ui/onboarding/onboarding-service-inspector-preview.tsx`
- Modify: `apps/web/src/ui/onboarding/OnboardingPreviewMap.tsx`
- Modify: `apps/web/src/ui/app.css`
- Create: `apps/web/tests/ui/sim-controls-presentation.test.tsx`
- Modify: `apps/web/tests/ui/inspector/service-schedule-fields.test.tsx`
- Modify: `apps/web/tests/ui/onboarding/onboarding-scene-overlay.test.tsx`

- [ ] **Step 1: Write failing shared-presentation tests**

  Require the production Schedule fields to say
  `Frequency · peak headway` and `Service hours · span of service`. Require the
  load explanation to say `time at stops` and `running that often`.

  Require a pure simulation-control presentation to render the same play/pause,
  speed ladder, and formatted clock as the live controls from explicit props.
  Require the simulation onboarding overlay to use that presentation in a
  running `4×` state and omit it from every other scene.

- [ ] **Step 2: Run the focused presentation tests and verify RED**

  Run:

  ```bash
  pnpm --filter @transitmapper/web exec vitest run tests/ui/sim-controls-presentation.test.tsx tests/ui/inspector/service-schedule-fields.test.tsx tests/ui/onboarding/onboarding-scene-overlay.test.tsx
  ```

- [ ] **Step 3: Extract the production simulation presentation**

  Add an exported `SimControlsPresentation` receiving `paused`, `speedId`,
  `simMs`, handlers, and `readOnly`. Make `SimControls` supply live provider
  state to it. The onboarding adapter supplies its passive scene clock; it may
  throttle text updates but must derive time from `onboardingSceneFrame`.

- [ ] **Step 4: Translate the production Schedule surface**

  Change only visible terminology and the explanatory chain; retain the same
  fields, presets, accessibility relationships, and editor handlers. Update
  the Las Vegas inspector adapter to select `Charleston Crosstown` by stable ID.

- [ ] **Step 5: Run focused tests GREEN**

  Run the Step 2 command and expect all tests to pass without warnings.

- [ ] **Step 6: Commit the shared presentations**

  Commit subject:

  ```text
  feat(web): clarify onboarding operations
  ```

### Task 4: Keep every action and inspector value reachable

**Files:**

- Modify: `apps/web/src/ui/app.css`
- Modify: `apps/web/tests/ui/onboarding/onboarding-responsive-style.test.ts`

- [ ] **Step 1: Write failing responsive contracts**

  Require the phone onboarding modal to have a fixed `92dvh` height with an
  internally scrollable body and non-shrinking footer. Require the desktop
  embedded Service panel to fill its scene height, cap at 100%, and scroll.

- [ ] **Step 2: Run the responsive test and verify RED**

  Run:

  ```bash
  pnpm --filter @transitmapper/web exec vitest run tests/ui/onboarding/onboarding-responsive-style.test.ts
  ```

- [ ] **Step 3: Correct the desktop and phone layout boundaries**

  Give the desktop inspector enough width to reduce chip wrapping, bound it to
  the scene, and retain its own scroller. At phone widths set the complete sheet
  to `92dvh`; keep the body as the only content scroller and the footer outside
  it so progress and actions never leave the viewport.

- [ ] **Step 4: Run the responsive and dialog suites GREEN**

  Run:

  ```bash
  pnpm --filter @transitmapper/web exec vitest run tests/ui/onboarding/onboarding-responsive-style.test.ts tests/ui/OnboardingDialog.test.tsx
  ```

- [ ] **Step 5: Commit the responsive correction**

  Commit subject:

  ```text
  fix(web): keep onboarding actions visible
  ```

### Task 5: Document, verify, and capture the complete experience

**Files:**

- Modify: `docs/development/reference/project-structure.md`
- Modify: `docs/superpowers/specs/2026-08-09-dialog-onboarding-redesign-design.md`
- Modify: `docs/superpowers/specs/2026-08-10-onboarding-welcome-screen-design.md`
- Modify: `docs/superpowers/plans/2026-08-10-onboarding-real-geography.md`
- Capture: `/Users/williecubed/.codex/visualizations/2026/08/10/transit-mapper-onboarding-real-geography/`

- [ ] **Step 1: Update active onboarding architecture documentation**

  Replace active Port Mason/local-synthetic descriptions with the committed
  central Las Vegas snapshot, production preview/selection states, shared
  Schedule/simulation presentations, attribution, and regeneration command.
  Preserve historical decision records only where clearly marked as superseded.

- [ ] **Step 2: Run focused and package checks**

  Run:

  ```bash
  pnpm check:docs
  pnpm --filter @transitmapper/web lint
  pnpm --filter @transitmapper/web typecheck
  pnpm --filter @transitmapper/web verify
  ```

- [ ] **Step 3: Run the repository gate**

  Run:

  ```bash
  CI=1 pnpm check
  ```

- [ ] **Step 4: Inspect and capture the live flow**

  Capture all five screens at desktop and 390 by 844. Also capture drawing at
  start, midpoint, and settled state, and simulation at two visibly different
  times. Confirm real Las Vegas street geometry and labels, compact OSM
  attribution, production Schedule/simulation controls, selected new
  infrastructure, visible phone actions, no clipping, and no browser warnings
  or errors.

- [ ] **Step 5: Commit documentation and verification record**

  Commit subject:

  ```text
  docs(web): explain real-geography onboarding
  ```

- [ ] **Step 6: Check the final tree and commit state**

  Run:

  ```bash
  git status --short
  git log --oneline -8
  git show --check --stat HEAD
  ```

  Expected: clean detached worktree with all implementation, documentation,
  test, and generated snapshot commits present.
