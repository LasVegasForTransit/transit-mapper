# Live Renderer Maintainability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Phase 2 geographic renderer understandable through one lifecycle facade and a small set of domain-named implementation modules without changing accepted rendering behavior.

**Architecture:** `MapCanvas` translates UI events into calls on one `LiveMapRenderer`. The runtime owns committed document projection, scene drafting, banked publication, recovery, and settlement; editor-only overlays remain a separate path. Existing proven algorithms are moved beneath this boundary, then redundant adapters and public types are removed.

**Tech Stack:** TypeScript, React, MapLibre GL JS, GeoJSON, Vitest.

---

### Task 1: Establish the human-facing renderer lifecycle

**Files:**

- Create: `apps/web/src/map/live-map-renderer.ts`
- Create: `apps/web/tests/map/live-map-renderer.test.ts`
- Modify: `apps/web/src/map/MapCanvas.tsx`

- [x] **Step 1: Characterize the lifecycle before extracting it**

Add browser-free tests that name the public rules rather than adapter calls:

```ts
it('keeps the accepted scene visible until a replacement paints', async () => {
  const fixture = liveRendererFixture();
  fixture.renderer.setDocument(fixture.firstDocument);
  await fixture.paintNextRevision();

  fixture.renderer.setDocument(fixture.secondDocument);
  expect(fixture.visibleRevision()).toBe(fixture.firstDocument.revision);

  await fixture.paintNextRevision();
  expect(fixture.visibleRevision()).toBe(fixture.secondDocument.revision);
});

it('reuses a committed scene while the camera remains inside its envelope', async () => {
  const fixture = liveRendererFixture();
  await fixture.acceptInitialScene();
  fixture.renderer.setCamera(fixture.coveredCamera);
  expect(fixture.committedProjectionCount()).toBe(0);
});
```

- [x] **Step 2: Run the one test file and observe the missing facade**

Run from `apps/web`:

```bash
../../node_modules/.bin/vitest run tests/map/live-map-renderer.test.ts \
  --maxWorkers=1 --no-file-parallelism --reporter=dot
```

Expected: fail because `live-map-renderer.ts` does not exist.

- [x] **Step 3: Add the only renderer API consumed by `MapCanvas`**

The module exports one concrete lifecycle object and the input/output types
needed by its caller:

```ts
export class LiveMapRenderer {
  projectDocument(request: DocumentProjectionRequest): Promise<void>;
  publishScene(input: PublishLiveSceneInput): ScenePublicationSubmission;
  updateEditorScene(input: SceneUpdate): AcceptedSceneUpdate;
  requestRecovery(): void;
  snapshot(): LiveMapRendererSnapshot;
  dispose(): void;
}

export function createLiveMapRenderer(options: LiveMapRendererOptions): LiveMapRenderer;
```

`LiveMapRendererOptions` contains one coherent MapLibre host plus optional
instrumentation and editor-state callbacks. It does not expose preparation
jobs, scene source update plans, bank transactions, or scheduler continuations.

- [x] **Step 4: Move committed-renderer construction and lifecycle state out of `MapCanvas`**

Move ownership of these existing objects into `live-map-renderer.ts`:

```text
cooperative scheduler
document projector and preparation coordinator
accepted scene store
source-bank controller and layer controller
committed projection ownership
source publication and recovery
```

Keep interaction wiring, map creation, and React lifecycle in `MapCanvas`. Replace direct orchestration with calls to the facade.

- [x] **Step 5: Verify the focused lifecycle and current high-risk behavior**

Run each file separately with one worker:

```bash
../../node_modules/.bin/vitest run tests/map/live-map-renderer.test.ts --maxWorkers=1 --no-file-parallelism --reporter=dot
../../node_modules/.bin/vitest run tests/map/accepted-scene-store.test.ts --maxWorkers=1 --no-file-parallelism --reporter=dot
../../node_modules/.bin/vitest run tests/map/scene-publication-bank.test.ts --maxWorkers=1 --no-file-parallelism --reporter=dot
```

Expected: all pass.

### Task 2: Rename the pipeline around domain concepts

**Files:**

- Create: `apps/web/src/map/document-projection.ts`
- Create: `apps/web/src/map/scene-draft.ts`
- Create: `apps/web/src/map/scene-publication.ts`
- Modify: `apps/web/src/map/source-bank*.ts`
- Create: `apps/web/src/map/editor-feature-state.ts`
- Modify: `apps/web/src/map/editor-overlays.ts`
- Modify: renderer tests under `apps/web/tests/map/`
- Delete: superseded one-purpose adapters in `apps/web/src/map/`

- [x] **Step 1: Put preparation and projection behind `document-projection.ts`**

Expose one projection lifecycle:

```ts
export class DocumentProjector {
  project(request: DocumentProjectionRequest): Promise<void>;
  cancelAndRequeue(): boolean;
  afterCurrentSettles(callback: () => void): void;
  dispose(): void;
}
```

Move preparation coordination, generation ownership, cancellation, and
measurement out of `MapCanvas`. Camera coverage remains the host's decision;
low-level projection algorithms stay private unless directly tested.

- [x] **Step 2: Put normalization, scoped ownership, and comparison behind `scene-draft.ts`**

Expose one draft operation:

```ts
const plan = planSceneDraft(input, batchSize);
plan.units.unitAt(index)?.run();
const draft = plan.result();
```

Move the behavior formerly named `staged-live-render-*` and
`incremental-render-*`. Retain focused internal classes only when they maintain
resumable cursor state. Replace construction-history names such as
`NormalizedSourceBuilderOptions` with names tied to scene ownership.

- [x] **Step 3: Put source banks and accepted publication behind two readable modules**

`source-bank.ts` and its focused helpers own logical/physical identity,
resident revisions, and reversible activation. `scene-publication.ts` owns this
sequence:

```text
prepare inactive bank -> prewarm -> upload -> verify renderability
-> switch visible and hit ownership -> confirm accepted scene
```

Delete public wrappers whose only purpose was to forward a prepared plan into the next adapter.

- [x] **Step 4: Keep transient interaction rendering separate**

Move selection and hover paint state behind `editor-feature-state.ts`. Keep
handles, service termini, and junction guides behind `editor-overlays.ts` so a
reader cannot mistake a small editor projection for feature state. Their
combined behavior is:

```ts
editorFeatureState.applySelection();
editorFeatureState.setHoveredFeature(target);
editorFeatureState.restoreAfterStyle();
updateSelectionEditorSources();
```

The module never schedules a committed document projection.

- [x] **Step 5: Reduce shared scheduler vocabulary**

Keep one cooperative scheduler and one job vocabulary in
`cooperative-render-job-scheduler.ts`. Projection, scene drafting, and
publication describe work with that vocabulary instead of exporting separate
continuation, preparation, submission, and ownership types.

- [x] **Step 6: Run one focused test file at a time**

Run the lifecycle test plus the existing projection, scene, source-bank, editor-state, and recovery tests with `--maxWorkers=1 --no-file-parallelism`. Do not run Turbo or a package-wide Vitest invocation.

### Task 3: Make the design discoverable

**Files:**

- Modify: `docs/development/explanation/architecture.md`
- Modify: `docs/development/reference/project-structure.md`
- Modify: `docs/superpowers/specs/2026-08-11-live-renderer-maintainability-design.md`
- Modify: public renderer modules under `apps/web/src/map/`

- [x] **Step 1: Add module headers that state ownership and invariants**

Each public renderer module starts with two short paragraphs: what it owns, and which failure the boundary prevents. Do not add comments that restate control flow.

- [x] **Step 2: Document the accepted-scene lifecycle**

Architecture documentation must show the seven-step transaction and state that the old scene remains authoritative until the visible and hit banks switch together.

- [x] **Step 3: Document the editor-overlay exception accurately**

State that hover, selection halos, filters, and retained theme changes avoid committed geometry projection, while handles, termini, and guides use a separate editor-only projection.

- [x] **Step 4: Remove stale names and re-export-only files**

Search for the old module names and remove every production import. Tests may import internal modules only when testing the algorithm owned there.

### Task 4: Serialized verification and reviewable checkpoint

**Files:**

- Modify only files required by failures discovered below.

- [x] **Step 1: Typecheck in one process**

```bash
./node_modules/.bin/tsc -p apps/web/tsconfig.json --noEmit
```

Expected: exit 0.

- [x] **Step 2: Lint only the renderer and its focused tests in one process**

```bash
./node_modules/.bin/eslint apps/web/src/map/live-map-renderer.ts \
  apps/web/src/map/document-projection.ts \
  apps/web/src/map/editor-feature-state.ts \
  apps/web/tests/map/live-map-renderer.test.ts \
  apps/web/tests/map/document-projection.test.ts \
  apps/web/tests/map/editor-feature-state.test.ts
```

Expected: exit 0 without new suppressions.

- [x] **Step 3: Verify documentation in one process**

Run the repository documentation checker directly, not through Turbo. Expected: all relative links resolve.

- [x] **Step 4: Review the diff as a maintainer**

Confirm that:

- `MapCanvas` imports the facade instead of renderer implementation machinery;
- a reader can follow the accepted-scene lifecycle from `live-map-renderer.ts`;
- no one-use public interfaces or pass-through adapters remain;
- the new module names match the architecture documentation;
- no renderer behavior or performance constraint was weakened.

- [ ] **Step 5: Create one cleanup checkpoint**

Stage only the maintainability refactor and its documentation. Commit with a conventional subject and the repository-required co-author footer after confirming the hook will not launch a broad parallel gate.
