# Onboarding Welcome Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a purpose-first welcome screen before TransitMapper's four capability lessons without changing completion or first-run behavior.

**Architecture:** Keep `slides.tsx` as the content authority by adding a `welcome` scene backed by the existing complete Port Mason fixture. The existing map controller already renders every non-drawing, non-simulation scene as a static production projection, so the welcome screen needs no parallel rendering system. `OnboardingDialog.tsx` owns the one screen-specific transition label, while the existing footer and tab semantics expand from four steps to five.

**Tech Stack:** React 19, TypeScript, MapLibre GL, Vitest, Testing Library-compatible DOM assertions, CSS, pnpm, Turborepo

---

### Task 1: Define the five-screen content and navigation contract

**Files:**

- Modify: `apps/web/tests/ui/OnboardingDialog.test.tsx`
- Modify: `apps/web/tests/ui/onboarding/scene-timing.test.ts`
- Modify: `apps/web/src/ui/onboarding/slides.tsx`
- Modify: `apps/web/src/ui/onboarding/OnboardingDialog.tsx`
- Modify: `apps/web/src/ui/app.css`

- [x] **Step 1: Write the failing dialog tests**

Replace the four-outcome expectation with the five-screen contract:

```ts
expect(slides.map((slide) => slide.outcome)).toEqual([
  'purpose',
  'service',
  'infrastructure',
  'operations',
  'simulation',
]);
expect(slides.map((slide) => slide.scene)).toEqual([
  'welcome',
  'draw',
  'infrastructure',
  'operations',
  'simulate',
]);
```

Rename the case to `introduces the product before teaching its four capabilities`.
In the forward/back case, require the approved opening and transition:

```ts
expect(container.textContent).toContain('1 of 5');
expect(container.textContent).toContain('Welcome to TransitMapper');
expect(container.textContent).toContain(
  'TransitMapper is a tool for imagining, designing, and testing public transit systems on a real map.',
);
expect(container.textContent).toContain(
  'Start with a place and design the transit system you want to see there.',
);
expect(container.querySelector('[data-scene="welcome"]')).not.toBeNull();
clickButton('See how it works');
expect(container.textContent).toContain('Draw a line. TransitMapper finds the path.');
expectSelectedStep(2);
clickButton('Back');
expectSelectedStep(1);
```

Update keyboard navigation to expect End to select step 5. Update the land-use and completion cases to select step 5.

- [x] **Step 2: Add the failing static-welcome timing assertion**

Add this case to `scene-timing.test.ts`:

```ts
it('keeps the welcome overview complete and still', () => {
  expect(onboardingSceneFrame('welcome', 2_000, false)).toMatchObject({
    routeProgress: 1,
    cursorVisible: false,
    animateVehicles: false,
  });
});
```

- [x] **Step 3: Run the focused tests and verify RED**

Run:

```bash
pnpm --filter @transitmapper/web exec vitest run tests/ui/OnboardingDialog.test.tsx tests/ui/onboarding/scene-timing.test.ts
```

Expected: FAIL because the first slide is still `draw`, the sequence has four screens, `welcome` is not an `OnboardingSceneId`, and **See how it works** is absent.

- [x] **Step 4: Add the purpose-first slide**

Extend the unions in `slides.tsx`:

```ts
export type OnboardingSceneId = 'welcome' | 'draw' | 'infrastructure' | 'operations' | 'simulate';
type OnboardingOutcome = 'purpose' | 'service' | 'infrastructure' | 'operations' | 'simulation';
```

Insert this object before the drawing slide:

```ts
{
  title: 'Welcome to TransitMapper',
  body: 'TransitMapper is a tool for imagining, designing, and testing public transit systems on a real map.',
  invitation: 'Start with a place and design the transit system you want to see there.',
  outcome: 'purpose',
  scene: 'welcome',
  visualDescription:
    'A completed Port Mason transit system connects West Market, downtown, Eastgate, South Works, the university, and the airport with bus and light-rail services.',
},
```

Add `invitation?: string` to `OnboardingSlideData`. Update the module comment to say that the welcome screen establishes purpose before one Port Mason proposal develops across the four capability screens.

- [x] **Step 5: Render the invitation and the welcome transition**

After the body paragraph in `OnboardingDialog.tsx`, render the optional invitation as its own emphasized paragraph:

```tsx
{
  slide.invitation ? <p className="onboarding-invitation">{slide.invitation}</p> : null;
}
```

Change the footer label expression to preserve the final action while naming the first transition:

```tsx
{
  index === ONBOARDING_SLIDES.length - 1
    ? 'Draw your first service'
    : index === 0
      ? 'See how it works'
      : 'Next';
}
```

Do not change completion or close handlers.

- [x] **Step 6: Give the invitation restrained emphasis**

Add beside `.onboarding-copy` in `apps/web/src/ui/app.css`:

```css
.onboarding-invitation {
  max-width: 46rem;
  margin: 12px 0 0;
  color: var(--md-sys-color-on-surface);
  font-size: var(--md-sys-typescale-label-large-size);
  font-weight: var(--md-sys-typescale-label-large-weight);
  line-height: var(--md-sys-typescale-label-large-line-height);
  letter-spacing: var(--md-sys-typescale-label-large-tracking);
}
```

Use existing tokens only. Do not add a pill, card, badge, icon, or decorative treatment.

- [x] **Step 7: Run the focused tests and verify GREEN**

Run:

```bash
pnpm --filter @transitmapper/web exec vitest run tests/ui/OnboardingDialog.test.tsx tests/ui/onboarding/scene-timing.test.ts tests/ui/onboarding/onboarding-preview-map.test.tsx
```

Expected: PASS with the welcome screen first, five tab stops, a static overview, and unchanged final completion.

- [ ] **Step 8: Commit the behavior**

Stage only the four source/test files and `apps/web/src/ui/app.css`, then run `git commit` with:

```text
feat(web): add onboarding welcome screen

Introduce TransitMapper before the capability tour so first-time visitors know
what they are looking at before the dialog starts teaching interactions.
```

### Task 2: Document the purpose scene boundary

**Files:**

- Modify: `apps/web/src/ui/onboarding/fixtureSystem.ts`
- Modify: `docs/development/reference/project-structure.md`

- [ ] **Step 1: Update the fixture ownership comment**

Change the fixture comment from “all four onboarding scenes” to “all five onboarding screens.” The complete fixture supplies the welcome overview and the three later complete-system scenes; the drawing scene continues to use its dedicated projection.

- [ ] **Step 2: Update the project structure reference**

Replace “one of four passive scenes” with text stating that slide data selects a purpose overview followed by four passive capability scenes. Record that the purpose overview projects the completed local Port Mason system without animation or editor mutation.

- [ ] **Step 3: Run documentation and focused web checks**

Run:

```bash
pnpm check:docs
pnpm --filter @transitmapper/web lint
pnpm --filter @transitmapper/web typecheck
```

Expected: all three commands exit 0.

- [ ] **Step 4: Commit the documentation**

Stage the fixture comment and project-structure reference, then run `git commit` with:

```text
docs(web): explain onboarding purpose scene
```

### Task 3: Verify the complete flow and capture every screen

**Files:**

- Modify only if verification finds a defect in the files named above.
- Capture: `/Users/williecubed/.codex/visualizations/2026/08/10/transit-mapper-onboarding-welcome/`

- [ ] **Step 1: Run the repository gate**

Run:

```bash
CI=1 pnpm check
```

Expected: all repository tasks pass, including formatting, lint, typecheck, tests, docs, filenames, and invariants.

- [ ] **Step 2: Inspect all five screens in the running app**

Start the web app with:

```bash
pnpm --filter @transitmapper/web dev --host 127.0.0.1
```

Open **Replay intro**. Verify:

- step 1 uses the exact approved title, definition, invitation, and **See how it works** action;
- the welcome map is the complete Port Mason network, has no moving vehicles, and contains no onboarding-only control;
- steps 2–5 retain the approved drawing, infrastructure, schedule, and simulation presentations;
- Back, progress tabs, close, and the final action remain reachable;
- the phone layout scrolls without clipping the map, inspector, or footer.

- [ ] **Step 3: Capture every screen at desktop and phone sizes**

Save five desktop screenshots and five 390-by-844 screenshots with numbered filenames. Include both sizes in the handoff so the full purpose-to-capability sequence can be reviewed without reopening the app.

- [ ] **Step 4: Check the final tree and commit state**

Run:

```bash
git status --short
git log --oneline -4
git show --check --stat HEAD
```

Expected: the worktree is clean, the welcome behavior and documentation commits are present, and `git show --check` reports no whitespace errors.
