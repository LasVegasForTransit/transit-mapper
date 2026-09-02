# Automatic MD3 Light and Dark Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every live TransitMapper surface follow the operating-system color scheme while
keeping user colors unchanged and portable output light.

**Architecture:** CSS owns the MD3 application roles and reacts directly to `prefers-color-scheme`.
A small external-store service gives MapLibre the same resolved scheme; typed map palettes and a
gesture-safe style controller switch paired OpenFreeMap styles without moving the camera or entering
the editor model.

**Tech Stack:** TypeScript, React, CSS custom properties, MapLibre GL, OpenFreeMap, Vitest,
Playwright performance journeys.

---

### Task 1: System scheme and MD3 tokens

**Files:**

- Create: `apps/web/src/theme/systemColorScheme.ts`
- Create: `apps/web/src/theme/systemColorScheme.test.ts`
- Create: `apps/web/src/theme/tokens.css`
- Modify: `apps/web/src/ui/app.css`

- [x] Write failing tests for light fallback, dark initial state, live changes, listener cleanup,
      and absence of storage access.
- [x] Implement the external-store scheme service and run its focused tests.
- [x] Define the approved MD3 color, type, shape, and elevation roles.
- [x] Migrate app CSS off the legacy shorthand variables and add a token contract test with audited
      literal-color exceptions.

### Task 2: Cartographic themes

**Files:**

- Create: `apps/web/src/map/mapTheme.ts`
- Create: `apps/web/src/map/mapTheme.test.ts`
- Replace: `apps/web/src/map/basemap.ts`
- Modify: `apps/web/src/map/layers/layerSpecs.ts`
- Modify: `apps/web/src/map/layers/icons.ts`
- Modify: `apps/web/src/map/initialStyleFallback.ts`

- [x] Write failing tests for basemap selection, layer parity, unchanged user-color expressions,
      route casings, icon aliases, and blank styles.
- [x] Implement typed light and dark map palettes and layer factories.
- [x] Make neutral icon rasterization and local fallback styles scheme-aware.
- [x] Keep the exported light layer catalog as the fixed static-output contract.

### Task 3: Live map style switching

**Files:**

- Create: `apps/web/src/map/styleSwitchController.ts`
- Create: `apps/web/src/map/styleSwitchController.test.ts`
- Modify: `apps/web/src/map/MapCanvas.tsx`

- [x] Write failing tests for gesture deferral, stale-request cancellation, transform preservation,
      full-rebuild recovery, and request failure.
- [x] Implement the style-switch controller with injected fetch and map boundaries.
- [x] Refactor MapCanvas setup into one idempotent overlay recovery path.
- [x] Connect the system scheme without adding it to editor state.

### Task 4: Live and static surfaces

**Files:**

- Modify: `apps/web/src/ui/onboarding/OnboardingPreviewMap.tsx`
- Modify: `apps/web/src/embed/main.ts`
- Modify: `apps/web/embed.html`
- Modify: `apps/web/index.html`
- Modify: export map modules and their tests

- [x] Make onboarding and embed maps follow the system scheme.
- [x] Add media-qualified browser theme metadata and native color-scheme declarations.
- [x] Keep export preview, renderers, SVG, and worker preview paths explicitly on the light basemap
      and light layer catalog.
- [x] Run focused surface tests and the web build.

### Task 5: Documentation and verification

**Files:**

- Modify: `docs/development/explanation/architecture.md`
- Modify: `docs/development/reference/project-structure.md`
- Modify: `docs/product/how-to/share-and-export.md`

- [x] Document the theme boundary, runtime map swap, and static-output rule.
- [x] Exercise the approved desktop/mobile and custom-color browser matrix.
- [x] Run `pnpm perf`.
- [x] Run `pnpm check`.
