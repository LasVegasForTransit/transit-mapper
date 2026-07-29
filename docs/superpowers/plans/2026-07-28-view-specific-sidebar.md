# View-Specific Editor Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the all-object left menu with view-specific Network, Infrastructure, and Diagram workspaces.

**Architecture:** Keep the document model unchanged. Build small pure projection
helpers for line stops and service-bearing corridors, then render those results
through a view-aware sidebar component whose grouping and expansion state are
local UI state.

**Tech Stack:** React 18, TypeScript, Zustand editor store, Vitest, existing CSS
and catalog/view-state APIs.

## Global Constraints

- Do not add a persisted Corridor or Vehicle entity.
- Never render an all-roads list.
- Keep selection-dependent editing in the right inspector.
- Sections collapse independently and list rendering retains the 150-row cap.

---

### Task 1: Sidebar outline projections

**Files:**

- Create: `apps/web/src/ui/sidebarOutline.ts`
- Test: `apps/web/src/ui/sidebarOutline.test.ts`

**Interfaces:**

- Produces: `lineStopsForService(system: TransitSystem, serviceId: string): SidebarPattern[]`
- Produces: `networkCorridors(system: TransitSystem): NetworkCorridor[]`

- [ ] Write failing tests for ordered derived stops and corridor aggregation.
- [ ] Run the focused Vitest file and confirm the missing-module failure.
- [ ] Implement the minimal pure projection helpers using existing core
      `patternPath`, `patternStops`, `pathLengthMeters`, and `NamedWay` data.
- [ ] Run the focused test file and confirm it passes.

### Task 2: View-specific sidebar component

**Files:**

- Create: `apps/web/src/ui/SidebarPanel.tsx`
- Test: `apps/web/src/ui/SidebarPanel.test.tsx`
- Modify: `apps/web/src/App.tsx`
- Delete: `apps/web/src/ui/LinesPanel.tsx`

**Interfaces:**

- Consumes: `lineStopsForService` and `networkCorridors`
- Produces: `SidebarPanel`, the single left-menu content component

- [ ] Write failing static-render tests for Network, Infrastructure, and Diagram
      headings and the Vehicles placeholder.
- [ ] Run the focused component test and confirm it fails because the component
      does not exist.
- [ ] Implement the three view workspaces, independent section controls,
      keyboard listbox behavior, selection/focus, multi-select behavior for
      services, and the existing 150-row cap.
- [ ] Replace `LinesPanel` with `SidebarPanel` in `App.tsx`.
- [ ] Run both focused test files and confirm they pass.

### Task 3: Styling and documentation

**Files:**

- Modify: `apps/web/src/ui/app.css`
- Modify: `apps/web/src/ui/Workbench.tsx`
- Modify: `docs/development/reference/project-structure.md`

- [ ] Add focused sidebar hierarchy, grouping-control, disclosure, nested-row,
      and placeholder styles using existing theme tokens.
- [ ] Rename user-facing Workbench labels and comments from “Objects” to
      “Workspace” where they describe the whole left surface.
- [ ] Record the view-specific sidebar and its projection helper in Project
      structure.
- [ ] Run Prettier on owned files, the focused tests, and `pnpm check`.
