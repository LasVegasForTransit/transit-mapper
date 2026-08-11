# My Systems Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make saved systems straightforward to open and recognizable by adding safe document switching, locally rendered map previews, and remembered list/card views.

**Architecture:** Keep `LibraryEntry` as the lightweight index and load full documents only through a bounded preview helper after the dialog renders. Extend the persistence coordinator's existing result tracking so a switch can refuse to discard an undurable current document, then let `SystemsDialog` own the interaction state while focused helpers own view preference and preview scheduling.

**Tech Stack:** React 19, TypeScript, Radix Dialog, Vitest with jsdom, IndexedDB-backed browser library, pure SVG renderer from `@transitmapper/core`.

## Global Constraints

- Cards are the first-run default; the last List/Cards choice is remembered locally.
- Opening is always a visible text action; no primary action depends on an icon or hover.
- A non-`saved` flush result prevents the editor document from being replaced.
- Preview generation is local, derived, limited to three concurrent loads, and never blocks Open or Delete.
- No library schema, serialized-system format, network request, or new dependency is introduced.
- New modules and tests use kebab-case filenames under the owning module's root `tests/` tree.
- Every parameter and prop object uses a named interface.
- `pnpm check` is the final repository gate.

---

### Task 1: Make the persistence boundary observable

**Files:**

- Modify: `apps/web/src/storage/persistenceCoordinator.ts`
- Modify: `apps/web/tests/storage/persistenceCoordinator.test.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/storage/deleteAfterFlush.ts`

**Interfaces:**

- Produces: `PersistenceCoordinator.flush(): Promise<SaveOutcome>`
- Produces: `flushPendingSave(): Promise<SaveOutcome>` for `SystemsDialog`
- Preserves: delete and app-update callers may await and intentionally ignore the returned outcome.

- [ ] **Step 1: Write the failing persistence result tests**

Add cases beside the existing flush tests:

```ts
import type { SaveOutcome } from '../../src/storage/localStore';

it('reports the effective saved outcome after a successful flush', async () => {
  const harness = setup();
  harness.store.replace({
    system: { ...harness.system, name: 'Durable edit' },
    readOnly: false,
  });

  await expect(harness.coordinator.flush()).resolves.toBe('saved');
});

it('reports the current system as undurable until a later save succeeds', async () => {
  const save = vi
    .fn<(system: TransitSystem) => Promise<SaveOutcome>>()
    .mockResolvedValueOnce('full')
    .mockResolvedValueOnce('saved');
  const harness = setup({ save });
  harness.store.replace({
    system: { ...harness.system, name: 'First edit' },
    readOnly: false,
  });
  await expect(harness.coordinator.flush()).resolves.toBe('full');

  harness.store.replace({
    system: { ...harness.system, name: 'Retry edit' },
    readOnly: false,
  });
  await expect(harness.coordinator.flush()).resolves.toBe('saved');
});

it('does not apply another system failure to the current system flush', async () => {
  const harness = setup();
  harness.coordinator.recordOutcome('other-system', 'full');

  await expect(harness.coordinator.flush()).resolves.toBe('saved');
  expect(harness.report).toHaveBeenLastCalledWith('full');
});
```

- [ ] **Step 2: Run the targeted test and confirm RED**

Run:

```bash
pnpm --filter @transitmapper/web exec vitest run tests/storage/persistenceCoordinator.test.ts
```

Expected: the new assertions fail because `flush()` resolves to `undefined`.

- [ ] **Step 3: Return the effective outcome from the coordinator**

Keep the reporting helper global because the banner summarizes every undurable
document. Add a separate current-document lookup for the switch boundary and
return it after `waitForIdle()`:

```ts
const effectiveOutcome = (): SaveOutcome =>
  [...failedOutcomes.values()].includes('full')
    ? 'full'
    : failedOutcomes.size > 0
      ? 'unavailable'
      : 'saved';

const reportEffectiveOutcome = (): void => {
  const outcome = effectiveOutcome();
  options.report(outcome);
};

const currentDocumentOutcome = (): SaveOutcome =>
  failedOutcomes.get(options.store.getState().system.id) ?? 'saved';

const flush = async (): Promise<SaveOutcome> => {
  cancelTimer();
  const system = pendingSystem;
  pendingSystem = null;
  if (system) enqueueSave(system);
  await waitForIdle();
  return currentDocumentOutcome();
};
```

Update `PersistenceCoordinator.flush` and `SystemsDialogProps.flushPendingSave`
to use `Promise<SaveOutcome>`. Give `DeleteAfterFlushOptions.flush` the type
`() => unknown | Promise<unknown>` because deletion deliberately waits for, but
does not interpret, the flush result. Pass `useAppUpdate` an async wrapper that
awaits `flushPendingSave()` and returns nothing because update reloads wait on
durability but report failures through the existing banner.

- [ ] **Step 4: Run the targeted persistence tests and typecheck**

Run:

```bash
pnpm --filter @transitmapper/web exec vitest run tests/storage/persistenceCoordinator.test.ts
pnpm --filter @transitmapper/web typecheck
```

Expected: both commands exit 0.

- [ ] **Step 5: Commit the observable persistence boundary**

Stage only the four task files and commit with subject:

```text
fix(web): refuse unsafe system switches
```

The body explains that the save lane already knew the effective outcome but
discarded it at the exact boundary where a document switch needed it.

---

### Task 2: Isolate view preference and bounded previews

**Files:**

- Create: `apps/web/src/ui/systems-view-preference.ts`
- Create: `apps/web/src/ui/system-previews.ts`
- Create: `apps/web/tests/ui/systems-view-preference.test.ts`
- Create: `apps/web/tests/ui/system-previews.test.ts`

**Interfaces:**

- Produces: `type SystemsView = 'list' | 'cards'`
- Produces: `readSystemsView(storage?: SystemsViewStorage): SystemsView`
- Produces: `writeSystemsView(view: SystemsView, storage?: SystemsViewStorage): void`
- Produces: `loadSystemPreviews(options: LoadSystemPreviewsOptions): Promise<void>`
- Produces: `SystemPreview = { status: 'ready'; svg: string } | { status: 'unavailable' }`

- [ ] **Step 1: Write failing view-preference tests**

```ts
it('uses cards until someone chooses a view', () => {
  expect(readSystemsView(memoryStorage())).toBe('cards');
});

it('round-trips the selected view', () => {
  const storage = memoryStorage();
  writeSystemsView('list', storage);
  expect(readSystemsView(storage)).toBe('list');
});

it('falls back to cards when storage throws', () => {
  expect(readSystemsView(throwingStorage())).toBe('cards');
  expect(() => writeSystemsView('list', throwingStorage())).not.toThrow();
});
```

- [ ] **Step 2: Run the preference test and confirm RED**

Run:

```bash
pnpm --filter @transitmapper/web exec vitest run tests/ui/systems-view-preference.test.ts
```

Expected: module resolution fails because the helper does not exist.

- [ ] **Step 3: Implement the preference helper**

Use `transitmapper:systemsView` as the key, accept only `list` and `cards`, and
catch both read and write failures. Define a named storage interface containing
only `getItem` and `setItem` so tests do not need a browser global.

- [ ] **Step 4: Run the preference test and confirm GREEN**

Run the command from Step 2. Expected: all preference cases pass.

- [ ] **Step 5: Write failing bounded-preview tests**

Cover real outcomes and concurrency with deferred load promises:

```ts
it('renders ready systems and reports damaged systems without rejecting', async () => {
  const previews = new Map<string, SystemPreview>();
  await loadSystemPreviews({
    ids: ['ready', 'damaged'],
    load: async (id) => (id === 'ready' ? { status: 'ok', system } : { status: 'corrupt' }),
    render: () => '<svg>network</svg>',
    onPreview: (id, preview) => previews.set(id, preview),
  });

  expect(previews.get('ready')).toEqual({ status: 'ready', svg: '<svg>network</svg>' });
  expect(previews.get('damaged')).toEqual({ status: 'unavailable' });
});
```

A second case starts four deferred loads, asserts only three have started, then
resolves one and asserts the fourth starts.

- [ ] **Step 6: Run the preview test and confirm RED**

Run:

```bash
pnpm --filter @transitmapper/web exec vitest run tests/ui/system-previews.test.ts
```

Expected: module resolution fails because the helper does not exist.

- [ ] **Step 7: Implement the three-worker preview loader**

Define named dependency interfaces using the existing `LibraryLoadResult` and
`TransitSystem` types. Each worker claims the next ID, awaits `load`, calls
`render` only for `ok`, catches renderer/load rejection, and calls `onPreview`
unless `isCancelled?.()` is true. Start `Math.min(concurrency, ids.length)`
workers with a default concurrency of 3.

- [ ] **Step 8: Run both helper tests and confirm GREEN**

Run:

```bash
pnpm --filter @transitmapper/web exec vitest run tests/ui/systems-view-preference.test.ts tests/ui/system-previews.test.ts
```

Expected: all helper cases pass.

- [ ] **Step 9: Commit the library helpers**

Stage only the four helper and test files and commit with subject:

```text
feat(web): prepare local system previews
```

---

### Task 3: Make opening a system the primary interaction

**Files:**

- Create: `apps/web/tests/ui/systems-dialog.test.tsx`
- Modify: `apps/web/src/ui/SystemsDialog.tsx`

**Interfaces:**

- Consumes: `flushPendingSave(): Promise<SaveOutcome>` from Task 1
- Consumes: `readSystemsView` and `writeSystemsView` from Task 2
- Produces: visible `Open <system name>` actions in both list and card views.

- [ ] **Step 1: Build the dialog test harness**

Mock `browserLibrary`, `localStore`, `myShares`, `share/api`, `UiProvider`, and
`EditorProvider` before importing `SystemsDialog`. Render through React's
`createRoot`, resolve `listLibrary` with one current and one saved entry, and
provide named helpers `buttonNamed(name)` and `settle()`.

- [ ] **Step 2: Write the failing safe-switch tests**

```ts
it('flushes the current system before loading and opening another system', async () => {
  const order: string[] = [];
  state.flushPendingSave.mockImplementation(async () => {
    order.push('flush');
    return 'saved';
  });
  storage.loadSystemEntry.mockImplementation(async () => {
    order.push('load');
    return { status: 'ok', system: savedSystem };
  });

  await click(buttonNamed('Open Saved system'));

  expect(order).toEqual(['flush', 'load']);
  expect(storage.setActiveId).toHaveBeenCalledWith(savedSystem.id);
  expect(editor.setSystem).toHaveBeenCalledWith(savedSystem, { readOnly: false });
  expect(state.onClose).toHaveBeenCalledOnce();
});

it('keeps the current system open when its pending save is not durable', async () => {
  state.flushPendingSave.mockResolvedValue('full');

  await click(buttonNamed('Open Saved system'));

  expect(storage.loadSystemEntry).not.toHaveBeenCalled();
  expect(editor.setSystem).not.toHaveBeenCalled();
  expect(state.onClose).not.toHaveBeenCalled();
  expect(buttonNamed('Delete Saved system')).not.toBeDisabled();
});
```

Add cases for Current being disabled, a second Open not racing the first,
corrupt calling `onCorrupt`, missing refreshing the list, and unavailable
showing Try again. Retain focused cases that Duplicate saves and refreshes the
library and that confirmed Delete refreshes without resurrecting a pending
document.

- [ ] **Step 3: Run the dialog test and confirm RED**

Run:

```bash
pnpm --filter @transitmapper/web exec vitest run tests/ui/systems-dialog.test.tsx
```

Expected: the visible Open lookup and flush-order assertions fail against the
unlabeled dot implementation.

- [ ] **Step 4: Implement guarded, explicit opening**

In `SystemsDialog`, add `openingId: string | null`. `open(id)` sets it, awaits
the flush, returns early on non-`saved`, then loads. Keep the dialog open for
missing/corrupt/unavailable results and clear `openingId` in `finally`. Replace
the dot control with a text `Open` button and a textual `Current` state. Disable
rename, duplicate, share revocation, and delete only while a switch is active;
Delete stays enabled after a failed flush has settled.

- [ ] **Step 5: Add and test the view toggle**

Initialize state with `readSystemsView`, render a `role="group"` labeled
`System view`, and provide List and Cards buttons with `aria-pressed`. On click,
update state and call `writeSystemsView`. Add tests that both modes retain the
same Open actions and that a remount restores List after it was chosen.

- [ ] **Step 6: Run the dialog and helper tests and confirm GREEN**

Run:

```bash
pnpm --filter @transitmapper/web exec vitest run tests/ui/systems-dialog.test.tsx tests/ui/systems-view-preference.test.ts
```

Expected: all cases pass without React act warnings.

- [ ] **Step 7: Commit the primary interaction**

Stage the dialog and its test and commit with subject:

```text
fix(web): make saved systems openable
```

The body records that the prior switch was hidden behind an unlabeled dot and
that a failed flush now keeps the current document on screen.

---

### Task 4: Add network portraits and responsive library styling

**Files:**

- Modify: `apps/web/src/ui/SystemsDialog.tsx`
- Modify: `apps/web/src/ui/app.css`
- Modify: `apps/web/tests/ui/systems-dialog.test.tsx`

**Interfaces:**

- Consumes: `loadSystemPreviews` from Task 2
- Consumes: `previewSvg(system, { width, height, displayWidth })` from `@transitmapper/core/render/preview`
- Produces: card images using encoded SVG data URLs and fallback surfaces that do not alter actions.

- [ ] **Step 1: Write the failing preview integration tests**

Mock `previewSvg` to return `<svg aria-label="rendered"></svg>`. Assert that
Cards mode eventually renders `img[alt="Map preview of Saved system"]`; assert
that a corrupt preview renders `Preview unavailable` while Open and Delete stay
enabled. Assert List mode renders neither image nor preview fallback surface.

- [ ] **Step 2: Run the dialog test and confirm RED**

Run the Task 3 dialog command. Expected: no preview image or fallback exists.

- [ ] **Step 3: Integrate derived previews**

When Cards is active, start `loadSystemPreviews` for entry IDs not already in
preview state. Cancel state publication in the effect cleanup. Render the SVG
as:

```tsx
<img
  className="systems-preview-image"
  src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(preview.svg)}`}
  alt={`Map preview of ${displayName}`}
/>
```

Pending and unavailable previews occupy the same wrapper. Make the preview a
button for non-current systems with the same guarded `open(entry.id)` handler.

- [ ] **Step 4: Implement the approved responsive visual hierarchy**

Pass `className="systems-dialog"` to `Modal`. Replace the current row-only CSS
with:

- a stable header toolbar containing New system and the segmented view control;
- `.systems-list[data-view='cards']` as a two-column grid;
- one column below the width at which a card becomes narrower than 240px;
- fixed-aspect preview wrappers that reserve space before images arrive;
- selected/current borders plus textual Current state;
- visible text Open actions and secondary labeled icon actions;
- minimum 44px interactive targets;
- content scrolling inside the systems collection rather than the whole dialog.

Use only existing Material Design tokens from `app.css`; add no new font,
literal palette, or animation.

- [ ] **Step 5: Run dialog tests, touch-target tests, and typecheck**

Run:

```bash
pnpm --filter @transitmapper/web exec vitest run tests/ui/systems-dialog.test.tsx tests/ui/touch-targets.test.ts tests/ui/system-previews.test.ts
pnpm --filter @transitmapper/web typecheck
```

Expected: both commands exit 0.

- [ ] **Step 6: Inspect the real dialog at desktop and compact widths**

Start `pnpm dev`, open My systems with at least three distinct saved fixtures,
and verify at approximately 1024px and 390px that:

- Open is visible without hover;
- cards are two columns only when each remains readable;
- previews do not shift card actions when they settle;
- keyboard focus reaches List, Cards, each Open, Duplicate, and Delete in order;
- list mode keeps all management actions reachable;
- the current system cannot be reopened;
- switching changes the map and closes the dialog.

- [ ] **Step 7: Commit the visual library**

Stage the component, stylesheet, and dialog test and commit with subject:

```text
feat(web): add visual system browsing
```

---

### Task 5: Verify, publish, and review

**Files:**

- Modify only files required by concrete verification failures.

**Interfaces:**

- Consumes: all completed tasks.
- Produces: a pushed `codex/my-systems-library` branch, an open pull request, and a review report against the PR diff.

- [ ] **Step 1: Run the focused regression suite**

```bash
pnpm --filter @transitmapper/web exec vitest run tests/storage/persistenceCoordinator.test.ts tests/ui/systems-view-preference.test.ts tests/ui/system-previews.test.ts tests/ui/systems-dialog.test.tsx tests/ui/touch-targets.test.ts
```

- [ ] **Step 2: Run the full repository gate**

```bash
pnpm check
```

Read the full output and fix only evidenced failures. Repeat until exit 0.

- [ ] **Step 3: Audit the final diff and commit state**

```bash
git status --porcelain=v1 -b
git diff origin/main...HEAD --check
git diff --stat origin/main...HEAD
git log --oneline origin/main..HEAD
```

Confirm every spec requirement has code or test evidence and no unrelated file
is staged or committed.

- [ ] **Step 4: Push and open the pull request**

Push `codex/my-systems-library`, then open a ready pull request against `main`.
The title is `fix(web): make saved systems easy to open and browse`. The body
summarizes explicit opening, safe switching, local previews, list/card choice,
and includes the exact `pnpm check` result.

- [ ] **Step 5: Review the pull request as a reviewer**

Read the complete PR diff and check behavior, data safety, accessibility,
preview concurrency/cancellation, error recovery, responsive layout, tests,
documentation, and unrelated changes. Report findings by severity with exact
file and line references. If findings are actionable, fix them test-first,
rerun `pnpm check`, push the follow-up, and repeat the review until no actionable
findings remain.
