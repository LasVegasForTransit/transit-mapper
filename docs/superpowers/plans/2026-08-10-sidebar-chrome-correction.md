# Sidebar Chrome Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put sidebar navigation in one header row and keep compact document identity readable.

**Architecture:** `Workbench` remains the only responsive layout owner. Desktop `MenuCard` composes its collapse control with `TopBarBrand`; compact `Workbench` places the existing compact view selector in its persistent rail instead of the identity bar.

**Tech Stack:** React, TypeScript, CSS, Vitest

---

### Task 1: Lock the hierarchy in rendering tests

**Files:**

- Modify: `apps/web/tests/ui/Workbench.test.tsx`
- Modify: `apps/web/tests/ui/SidebarPanel.test.tsx`

- [ ] Add a desktop assertion that the hide-outline button is inside `.panel-brand-row` and that no `.panel-head` exists.
- [ ] Add a compact assertion that the view selector appears after `.workbench-panel` inside `.workbench-rail`, not inside `.compact-top-bar-row`.
- [ ] Update the sidebar projection assertion so visible content does not require a redundant outline title.
- [ ] Run `pnpm --filter @transitmapper/web exec vitest run tests/ui/Workbench.test.tsx tests/ui/SidebarPanel.test.tsx` and confirm the new assertions fail for the current placement.

### Task 2: Correct the two responsive surfaces

**Files:**

- Modify: `apps/web/src/ui/Workbench.tsx`
- Modify: `apps/web/src/ui/app.css`

- [ ] Render the desktop sidebar IconButton as the last child of `.panel-brand-row` and remove `.panel-head`.
- [ ] Render `viewSwitch` inside the compact `.workbench-rail` and remove it from `.compact-top-bar-row`.
- [ ] Delete obsolete panel-heading CSS and give the brand-row toggle a fixed end position.
- [ ] Run the focused tests and confirm they pass.

### Task 3: Verify the correction

**Files:**

- Test: `apps/web/tests/ui/Workbench.test.tsx`
- Test: `apps/web/tests/ui/SidebarPanel.test.tsx`

- [ ] Run the focused Workbench and sidebar test suites.
- [ ] Inspect desktop and compact layouts in the browser.
- [ ] Run `CI=1 pnpm check` and confirm every repository gate passes.
