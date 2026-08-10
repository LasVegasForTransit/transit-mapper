# Dialog onboarding redesign implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the generic onboarding previews with a four-scene Port Mason proposal that teaches service drawing, physical infrastructure, operations, and simulation, then leaves a genuine first run ready to draw a bus service.

**Architecture:** Keep slide content declarative, build every map from one valid local `TransitSystem`, and derive motion from pure scene timing plus the production feature builder and simulation kernel. MapLibre owns geographic projection and fixture-positioned labels; React owns dialog navigation and accessible descriptions. The operations scene reuses the production Service inspector's Schedule presentation, while preview failure uses plain text rather than simulated editor UI.

**Tech Stack:** React 19, TypeScript, MapLibre GL, TransitMapper core model/render/simulation modules, Vitest, repository sequential verifier, CSS.

## Global constraints

- Keep onboarding passive and dialog-based before 1.0; add no coach marks, practice tasks, or completion checklist.
- Use one fictional early-stage Port Mason proposal across all four scenes.
- Use the rule “Use reality first; create only what is missing.”
- Infrastructure remains the model and Network drawing remains the shortcut.
- Make no remote tile, geocoding, or basemap request from onboarding.
- Use production `buildFeatures` and `runStateAt`; onboarding presentation must not create serialized records.
- Do not add onboarding-only scene chips, hint pills, legends, clocks, or controls that resemble product UI.
- Reuse production inspector presentation whenever onboarding shows inspector UI.
- A genuine first run enters Network with the Bus line tool ready; replay changes no editor or view state.
- Reduced motion starts at a meaningful settled frame.
- Preview failure preserves readable content and working navigation.
- Parameter and prop types use named interfaces; new source and test filenames use kebab-case.
- `pnpm check` is the completion gate.

---

### Task 1: Declarative slides and deterministic scene timing

**Files:**

- Modify: `apps/web/src/ui/onboarding/slides.tsx`
- Create: `apps/web/src/ui/onboarding/scene-timing.ts`
- Create: `apps/web/tests/ui/onboarding/scene-timing.test.ts`
- Modify: `apps/web/tests/ui/OnboardingDialog.test.tsx`

**Interfaces:**

- Produces: `OnboardingSceneId`, `OnboardingOutcome`, `OnboardingSlideData`, and `onboardingSceneFrame(scene, elapsedMs, reducedMotion)`.
- Consumed by: Tasks 3 and 4.

- [ ] **Step 1: Write tests for the approved four outcomes and scene frames**

```ts
expect(ONBOARDING_SLIDES.map((slide) => slide.outcome)).toEqual([
  'service',
  'infrastructure',
  'operations',
  'simulation',
]);
expect(ONBOARDING_SLIDES.every((slide) => slide.visualDescription.length > 0)).toBe(true);
expect(onboardingSceneFrame('draw', 0, false).routeProgress).toBe(0);
expect(onboardingSceneFrame('draw', 4_000, false).routeProgress).toBe(1);
expect(onboardingSceneFrame('draw', 0, true).routeProgress).toBe(1);
expect(onboardingSceneFrame('simulate', 1_000, true).animateVehicles).toBe(false);
```

- [ ] **Step 2: Run the focused tests and confirm the old slide union fails them**

Run: `pnpm --filter @transitmapper/web exec vitest run tests/ui/OnboardingDialog.test.tsx tests/ui/onboarding/scene-timing.test.ts`

Expected: FAIL because the scene types, outcome fields, descriptions, and timing module do not exist.

- [ ] **Step 3: Replace the preview union with scene data and implement pure timing**

```ts
export type OnboardingSceneId = 'draw' | 'infrastructure' | 'operations' | 'simulate';
export type OnboardingOutcome = 'service' | 'infrastructure' | 'operations' | 'simulation';

export interface OnboardingSlideData {
  title: string;
  body: string;
  note?: string;
  outcome: OnboardingOutcome;
  scene: OnboardingSceneId;
  visualDescription: string;
}

export interface OnboardingSceneFrame {
  routeProgress: number;
  cursorVisible: boolean;
  simMs: number;
  animateVehicles: boolean;
}
```

Use the four approved titles verbatim and make `scene-timing.ts` clamp drawing to a 3,200 ms settled frame. Simulation advances from 06:00 at 300 simulated seconds per real second and settles at 08:30 under reduced motion.

- [ ] **Step 4: Run the focused tests**

Run: `pnpm --filter @transitmapper/web exec vitest run tests/ui/OnboardingDialog.test.tsx tests/ui/onboarding/scene-timing.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the content and timing boundary**

```bash
git add apps/web/src/ui/onboarding/slides.tsx apps/web/src/ui/onboarding/scene-timing.ts apps/web/tests/ui/OnboardingDialog.test.tsx apps/web/tests/ui/onboarding/scene-timing.test.ts
git commit
```

Commit subject: `feat(web): define onboarding scenes`

### Task 2: Realistic Port Mason fixture and simulation inputs

**Files:**

- Modify: `apps/web/src/ui/onboarding/fixtureSystem.ts`
- Modify: `apps/web/tests/ui/onboarding/fixtureProjection.test.ts`
- Modify: `apps/web/tests/verify.test.ts`

**Interfaces:**

- Produces: `ONBOARDING_FIXTURE_SYSTEM`, `ONBOARDING_DRAW_SYSTEM`, `ONBOARDING_CONTEXT_FEATURES`, `ONBOARDING_PLACE_LABELS`, `ONBOARDING_NEW_RAIL_PATH`, `ONBOARDING_DRAW_PATH`, `ONBOARDING_VEHICLE_RUNS`, `ONBOARDING_SERVICE_STATS`, and `onboardingViewOptions(scene)`.
- Consumed by: Task 3.

- [ ] **Step 1: Strengthen fixture tests around the actual proposal**

```ts
expect(ONBOARDING_FIXTURE_SYSTEM.name).toBe('Port Mason proposal');
expect(ONBOARDING_FIXTURE_SYSTEM.services.map((service) => service.name)).toEqual([
  'Crosstown',
  'Harbor Line',
]);
expect(crosstown.patterns.map((pattern) => pattern.name)).toEqual(['Eastgate', 'Airport']);
expect(crosstown.frequencyMinutes).toBe(10);
expect(crosstown.spanStart).toBe('06:00');
expect(crosstown.spanEnd).toBe('23:00');
expect(ONBOARDING_SERVICE_STATS.fleet).toBeGreaterThan(0);
expect(validateSystem(ONBOARDING_FIXTURE_SYSTEM)).toEqual([]);
```

Also assert that imported roads and freight track use `source: 'osm'`, the downtown rail connector does not, Central Exchange is shared by both services, and every simulated run has a non-null plan.

- [ ] **Step 2: Run fixture tests and confirm the generic cross fails**

Run: `pnpm --filter @transitmapper/web exec vitest run tests/ui/onboarding/fixtureProjection.test.ts`

Expected: FAIL on Port Mason names, branches, schedules, provenance, and context data.

- [ ] **Step 3: Build Port Mason from stable model records**

Create a compact street grid on both sides of a river, join it with one bridge, and collect road-only junction refs from segment endpoints. Build Crosstown from two named patterns that share West Market–Central Exchange and split toward Eastgate and the airport. Build Harbor Line from imported north/south freight segments plus one un-sourced downtown connector.

```ts
export interface OnboardingPlaceLabel {
  id: string;
  label: string;
  coord: LngLat;
  priority: 'primary' | 'secondary';
}

export interface OnboardingVehicleRun {
  id: string;
  color: string;
  stats: PatternStats;
  inboundCumLengths: Float64Array;
  profile: VehicleMotionProfile;
}
```

Derive paths, fleet values, and simulation plans with `serviceStats` and `effectiveVehicleKind`, throwing at module initialization if any required path is invalid. Keep river geometry and place labels as non-serialized scene context.

- [ ] **Step 4: Run fixture and sequential verification**

Run: `pnpm --filter @transitmapper/web exec vitest run tests/ui/onboarding/fixtureProjection.test.ts && pnpm --filter @transitmapper/web exec tsx tests/verify.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the fixture**

```bash
git add apps/web/src/ui/onboarding/fixtureSystem.ts apps/web/tests/ui/onboarding/fixtureProjection.test.ts apps/web/tests/verify.test.ts
git commit
```

Commit subject: `feat(web): build Port Mason onboarding fixture`

### Task 3: Production-rendered scenes, drawing gesture, and vehicle simulation

**Files:**

- Modify: `apps/web/src/ui/onboarding/OnboardingPreviewMap.tsx`
- Create: `apps/web/src/ui/onboarding/onboarding-scene-overlay.tsx`
- Create: `apps/web/src/ui/onboarding/scene-geometry.ts`
- Create: `apps/web/tests/ui/onboarding/scene-geometry.test.ts`

**Interfaces:**

- Consumes: scene identifiers and frames from Task 1; fixture, context, paths, and vehicle runs from Task 2.
- Produces: `OnboardingPreviewMap({ scene, description })`, `pathPrefix(path, progress)`, and `vehicleFeaturesAt(simMs)`.
- Consumed by: Task 4.

- [ ] **Step 1: Test partial route geometry and kernel-derived vehicles**

```ts
expect(pathPrefix(ONBOARDING_DRAW_PATH, 0)).toHaveLength(1);
expect(pathPrefix(ONBOARDING_DRAW_PATH, 1)).toEqual(ONBOARDING_DRAW_PATH);
expect(pathPrefix(ONBOARDING_DRAW_PATH, 0.5).at(-1)).not.toEqual(ONBOARDING_DRAW_PATH.at(-1));
expect(vehicleFeaturesAt(0).features.length).toBe(ONBOARDING_VEHICLE_RUNS.length);
expect(vehicleFeaturesAt(60_000).features).not.toEqual(vehicleFeaturesAt(0).features);
```

- [ ] **Step 2: Run the geometry test and confirm it fails**

Run: `pnpm --filter @transitmapper/web exec vitest run tests/ui/onboarding/scene-geometry.test.ts`

Expected: FAIL because the geometry helpers do not exist.

- [ ] **Step 3: Implement pure geometry and vehicle feature helpers**

Use core `cumulativeLengths`, `pointAtDistance`, and `runStateAt`. `pathPrefix` must preserve source vertices before the interpolated endpoint. `vehicleFeaturesAt` must choose outbound/inbound paths from each run state and emit the production vehicle-source `color` property.

- [ ] **Step 4: Rebuild the MapLibre preview**

The map must:

- add the local river/context source before production layers;
- call production `buildFeatures` for every scene;
- use a small onboarding-only line and cursor source for the draw scene, then swap to production service/station features at the settled frame;
- highlight the un-sourced downtown rail connector in Infrastructure;
- create fixture-coordinate MapLibre markers for the minimum useful place labels;
- populate `SRC_VEHICLES` from `vehicleFeaturesAt` only in the simulation scene;
- refit after resize and remove every marker, listener, animation frame, and map during cleanup;
- settle immediately and leave vehicles static for reduced motion;
- catch construction/load/render errors and expose a stable failed state without exception text.

`onboarding-scene-overlay.tsx` is revised by Task 7 to render only shared production inspector presentation and plain failure copy. It has no editor-store dependency.

- [ ] **Step 5: Run geometry, dialog, lint, and type checks**

Run: `pnpm --filter @transitmapper/web exec vitest run tests/ui/onboarding/scene-geometry.test.ts tests/ui/OnboardingDialog.test.tsx && pnpm --filter @transitmapper/web lint && pnpm --filter @transitmapper/web typecheck`

Expected: PASS.

- [ ] **Step 6: Commit rendering and simulation**

```bash
git add apps/web/src/ui/onboarding/OnboardingPreviewMap.tsx apps/web/src/ui/onboarding/onboarding-scene-overlay.tsx apps/web/src/ui/onboarding/scene-geometry.ts apps/web/tests/ui/onboarding/scene-geometry.test.ts
git commit
```

Commit subject: `feat(web): render onboarding proposal scenes`

### Task 4: Dialog layout, accessible descriptions, and responsive presentation

**Files:**

- Modify: `apps/web/src/ui/onboarding/OnboardingDialog.tsx`
- Modify: `apps/web/src/ui/app.css`
- Modify: `apps/web/tests/ui/OnboardingDialog.test.tsx`

**Interfaces:**

- Consumes: `ONBOARDING_SLIDES` and `OnboardingPreviewMap`.
- Produces: the complete four-step passive dialog.

- [ ] **Step 1: Add dialog assertions for visible step context and final action**

```ts
expect(container.textContent).toContain('1 of 4');
expect(container.textContent).toContain('Draw a line. TransitMapper finds the path.');
expect(container.querySelector('[role="img"]')?.getAttribute('aria-label')).toContain('Crosstown');
clickButton('Draw your first service');
expect(onComplete).toHaveBeenCalledTimes(1);
```

Mock `OnboardingPreviewMap` so it preserves the passed description as a `role="img"` label, proving the dialog supplies a useful relationship rather than an unexplained generic map.

- [ ] **Step 2: Run the dialog test and confirm the old UI fails**

Run: `pnpm --filter @transitmapper/web exec vitest run tests/ui/OnboardingDialog.test.tsx`

Expected: FAIL on the new copy, step context, scene description, and final label.

- [ ] **Step 3: Simplify the dialog to one scene per slide**

Remove the three-preview branch and old preview keys. Pass `scene` and `visualDescription` directly to `OnboardingPreviewMap`, keep the tab keyboard behavior, render `n of 4`, and change the final action to `Draw your first service`.

- [ ] **Step 4: Replace onboarding CSS with the approved hierarchy**

Desktop uses one generous map. At the compact breakpoint, the modal remains a bottom sheet, the body scrolls, the preview stays singular, the shared production Schedule presentation moves below the map, and footer actions remain reachable. Use shape plus text for the selected step, not color alone. Under `prefers-reduced-motion`, remove presentation transitions in addition to settling JavaScript motion.

- [ ] **Step 5: Run dialog tests and responsive CSS contract checks**

Run: `pnpm --filter @transitmapper/web exec vitest run tests/ui/OnboardingDialog.test.tsx tests/ui/touch-targets.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit dialog presentation**

```bash
git add apps/web/src/ui/onboarding/OnboardingDialog.tsx apps/web/src/ui/app.css apps/web/tests/ui/OnboardingDialog.test.tsx
git commit
```

Commit subject: `feat(web): present onboarding proposal story`

### Task 5: Genuine first-run Bus handoff without replay mutation

**Files:**

- Create: `apps/web/src/ui/onboarding/first-run.ts`
- Create: `apps/web/tests/ui/onboarding/first-run.test.ts`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**

- Produces: `armFirstService(actions)`.
- Consumed by: the bootstrap location-dialog close chain in `App.tsx` only.

- [ ] **Step 1: Test the exact editor actions**

```ts
const calls: string[] = [];
armFirstService({
  setDraftMode: (mode) => calls.push(`mode:${mode}`),
  setTool: (tool) => calls.push(`tool:${tool}`),
});
expect(calls).toEqual(['mode:bus', 'tool:way']);
```

- [ ] **Step 2: Run the helper test and confirm it fails**

Run: `pnpm --filter @transitmapper/web exec vitest run tests/ui/onboarding/first-run.test.ts`

Expected: FAIL because `armFirstService` does not exist.

- [ ] **Step 3: Implement and integrate the first-run boundary**

```ts
export interface FirstServiceActions {
  setDraftMode: (modeId: string) => void;
  setTool: (tool: Tool) => void;
}

export function armFirstService(actions: FirstServiceActions): void {
  actions.setDraftMode('bus');
  actions.setTool('way');
}
```

Call it only in `NewSystemLocationDialog`'s `importIntoActive` close chain immediately before opening unseen onboarding. Do not call it from the dialog's final action or either Replay intro entry point; completion only marks onboarding seen and closes it.

- [ ] **Step 4: Run helper, location-dialog, and dialog tests**

Run: `pnpm --filter @transitmapper/web exec vitest run tests/ui/onboarding/first-run.test.ts tests/ui/NewSystemLocationDialog.test.tsx tests/ui/OnboardingDialog.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit the first-run handoff**

```bash
git add apps/web/src/ui/onboarding/first-run.ts apps/web/tests/ui/onboarding/first-run.test.ts apps/web/src/App.tsx
git commit
```

Commit subject: `feat(web): arm first bus service after onboarding`

### Task 6: Maintainer docs, browser evidence, and repository gate

**Files:**

- Modify: `docs/development/reference/project-structure.md`
- Modify as required by formatter: files owned by Tasks 1–5 only

**Interfaces:** None.

- [ ] **Step 1: Document the onboarding subsystem boundary**

Add a UI subsection sentence that onboarding slide data selects scenes, `fixtureSystem.ts` supplies one valid local proposal and simulation inputs, pure scene helpers derive frames, and `OnboardingPreviewMap.tsx` adapts those frames to production projections without mutating editor state.

- [ ] **Step 2: Run focused repository verification**

Run: `pnpm --filter @transitmapper/web verify && pnpm --filter @transitmapper/web lint && pnpm --filter @transitmapper/web typecheck && pnpm check:docs`

Expected: PASS.

- [ ] **Step 3: Inspect the live dialog at desktop and phone sizes**

Start `pnpm --filter @transitmapper/web dev --host 127.0.0.1`, open onboarding, and capture all four slides at a normal desktop viewport and 390 by 844 pixels. Confirm route geometry follows visible streets, the river and place labels explain the shape, the shared Schedule presentation obscures no branch or transfer, every footer action remains reachable, and no three-card comparison remains.

- [ ] **Step 4: Inspect reduced motion and preview failure**

Emulate `prefers-reduced-motion: reduce` and confirm the first scene is complete and simulation vehicles are static. Exercise the preview failure state through its test hook or a local construction failure and confirm the scene description, Back/Next, and step selection remain readable.

- [ ] **Step 5: Run the full gate**

Run: `pnpm check`

Expected: PASS with formatting, lint, typecheck, tests, and repository invariants green.

- [ ] **Step 6: Audit the approved spec requirement by requirement**

Compare the live screenshots, source, and test output with `docs/superpowers/specs/2026-08-09-dialog-onboarding-redesign-design.md`. Treat any missing scene, generic geometry, infrastructure-after-service wording, animated reduced-motion state, replay mutation, inaccessible map, or failed gate as incomplete and return to the owning task.

- [ ] **Step 7: Commit documentation and verification adjustments**

```bash
git add docs/development/reference/project-structure.md
git commit
```

Commit subject: `docs(web): explain onboarding scene architecture`

### Task 7: Remove invented onboarding chrome and share the real Schedule UI

This task supersedes the overlay and note-card presentation described in Tasks
3, 4, and 6. The map remains the complete visual for drawing, infrastructure,
and simulation. Only operations adds product UI, and that UI comes from the
production Service inspector.

**Files:**

- Create: `apps/web/src/ui/inspector/service-schedule-fields.tsx`
- Create: `apps/web/src/ui/inspector/service-load-presentation.tsx`
- Create: `apps/web/src/ui/inspector/service-inspector-heading.tsx`
- Create: `apps/web/src/ui/onboarding/onboarding-service-inspector-preview.tsx`
- Modify: `apps/web/src/ui/inspector/ServiceInspector.tsx`
- Modify: `apps/web/src/ui/onboarding/onboarding-scene-overlay.tsx`
- Modify: `apps/web/src/ui/onboarding/OnboardingPreviewMap.tsx`
- Modify: `apps/web/src/ui/onboarding/OnboardingDialog.tsx`
- Modify: `apps/web/src/ui/onboarding/slides.tsx`
- Modify: `apps/web/src/ui/app.css`
- Modify: `apps/web/tests/ui/OnboardingDialog.test.tsx`
- Modify: `apps/web/tests/ui/onboarding/onboarding-scene-overlay.test.tsx`
- Modify: `apps/web/tests/ui/onboarding/onboarding-preview-map.test.tsx`
- Create: `apps/web/tests/ui/inspector/service-schedule-fields.test.tsx`
- Modify: `docs/development/reference/project-structure.md`

- [x] **Step 1: Write failing UI-contract tests**

Assert that onboarding contains none of `Open beta`, `Network · Bus`,
`Infrastructure`, `Service plan`, `System running`, `Following existing
streets`, or the onboarding-only imported/new-infrastructure legend. Assert that
the operations scene contains the production labels `Schedule`, `Peak headway`,
`Span of service`, `Round trip`, and `Vehicles`, plus the fixture's active
schedule values. Assert that preview failure shows only the scene description.

Run:

```bash
pnpm --filter @transitmapper/web exec vitest run tests/ui/OnboardingDialog.test.tsx tests/ui/onboarding/onboarding-scene-overlay.test.tsx tests/ui/onboarding/onboarding-preview-map.test.tsx tests/ui/inspector/service-schedule-fields.test.tsx
```

Expected: FAIL because the fake chrome and note presentation still exist and
the production Schedule fields are not shared.

- [x] **Step 2: Extract the production Schedule presentation**

Move the existing frequency and span controls into
`service-schedule-fields.tsx`, preserving the live inspector's labels, presets,
custom-schedule behavior, and callbacks. Add an explicit read-only mode for the
onboarding fixture. Extract the pure rendered portion of `ServiceLoad` into
`service-load-presentation.tsx`; keep editor hooks and core calculations in
`ServiceInspector.tsx` and pass only derived display values to the shared
component.

- [x] **Step 3: Replace the fake overlay with a read-only inspector adapter**

Build `onboarding-service-inspector-preview.tsx` from the shared Service
inspector heading, tabs, load presentation, schedule fields, and real `Panel`
shell. Render it only for the operations scene. Draw, infrastructure, and
simulation remain map-only. Render preview failure as plain accessible
description text. When the embedded panel takes the compact shell without the
compact workbench, preserve a local scroller anywhere the scene remains
fixed-height. Disable its shared controls instead of making the whole panel
inert, because an inert overflow container cannot receive wheel scrolling.

- [x] **Step 4: Remove special notes and overlay styling**

Remove the beta disclosure, scene chips, hint pill, infrastructure legend,
fake operating card, clock, service key, fallback values, and their CSS. Fold
the future land-use sentence into slide four's normal body. Remove any clock
state and callbacks that no longer affect a visible product surface.

- [x] **Step 5: Run focused verification and inspect both live surfaces**

Run the focused tests from Step 1, then web lint and typecheck. Start the app and
capture the four onboarding slides at desktop and phone sizes. Also inspect a
selected service's live Schedule tab. Confirm that the shared labels, values,
selection styling, and layout match; confirm that no onboarding-only element
could be mistaken for real product UI.

- [x] **Step 6: Document and run the full gate**

Update Project structure for the shared inspector presentation boundary, run
`CI=1 pnpm check`, and treat any invented onboarding chrome, visual drift between
the two Schedule renderings, or failed repository check as incomplete.

- [x] **Step 7: Commit the correction**

```bash
git add apps/web/src/ui/inspector apps/web/src/ui/onboarding apps/web/tests/ui docs/development/reference/project-structure.md
git commit
```

Commit subject: `fix(web): use real UI in onboarding`
