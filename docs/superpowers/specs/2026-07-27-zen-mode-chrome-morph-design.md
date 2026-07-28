# Zen mode: chrome reflows instead of swapping components

## Context

"Zen mode" is the existing Hide-UI toggle (`uiHidden` in
`apps/web/src/ui/UiProvider.tsx`), triggered by the `IconButton` in
`TopBarBrand` (`apps/web/src/ui/TopBar.tsx:51-81`) or the `\` shortcut. Today
it works by unmounting the entire chrome as one lump:

- `App.tsx:229` calls `useDelayedUnmount(!uiHidden, 160)` to keep
  `<Workbench/>` mounted 160ms after `uiHidden` flips true, so
  `.app-chrome[data-ui-state='closed']`'s `fade-out` animation
  (`app.css:194-199`) has time to play before the DOM node disappears.
- `App.tsx:336-350` renders `<Workbench/>` — every floating card (the left
  Objects menu, the view switcher, sim controls, the primary action
  cluster, the mode toolbar) — only while `chromeMounted`.
- `App.tsx:352-363` renders a wholly separate `<button className="ui-restore">`
  once the chrome has finished unmounting, positioned in the same top-left
  corner the Objects card's brand row occupied.

Two problems with this: sim controls (play/pause/speed/clock,
`apps/web/src/ui/SimControls.tsx`) disappear along with everything else,
even though they're persistent canvas state like the map itself; and the
left menu → restore-button transition is two different elements swapped by
mount state, not one shape changing, so there's no visual continuity — it
just fades out and a different thing fades in on top of it.

## Goals

- Simulator controls (`SimControls`/`SimControlsCompact`) stay visible and
  interactive in zen mode, unaffected by the toggle — same category as the
  map itself.
- The left Objects card and the floating restore control become **one**
  persistent element whose CSS shape changes, not two elements swapped by
  mount state. Its position never changes; only its size does.
- Every other chrome cluster that still hides (view switcher, primary
  action cluster, mode toolbar) collapses in two visible stages: text
  shrinks to zero width first (causing icons to reflow through ordinary
  box layout — no transforms, no manual repositioning), then whatever's
  left fades and goes inert.
- Adding zen-awareness to a new chrome element later is a CSS-only change:
  add an existing utility class to it. No new component, no new prop, no
  JS wiring per element.
- Restoring (`\` or the toggle) is the same transition in reverse, driven
  by the same rules — not a separate code path.

## Non-goals

- `prefers-reduced-motion` handling. Not requested; the existing codebase
  has no such handling elsewhere either (`fade-in`/`fade-out` on panels,
  popovers, Inspector all run unconditionally), so this doesn't introduce
  an inconsistency, just doesn't fix a pre-existing gap.
- Changing what zen mode hides versus keeps. Scope is fixed: sim controls
  and the view switcher stay, the left menu, primary actions, and mode
  toolbar collapse. No new "what's exempt" decision is left open.
- Touching `useDelayedUnmount`. It stays, unused by this feature but still
  used by `Inspector` for its own, unrelated exit fade.

## Architecture

### 1. One attribute replaces the mount gate

`App.tsx` sets `data-zen` on a stable ancestor whenever `uiHidden` is true
— the existing `<div className="app">` root. `Workbench` (and everything
in it) renders unconditionally from now on; `chromeMounted`, `chromeClosing`,
the `useDelayedUnmount(!uiHidden, 160)` call, the `.app-chrome` wrapper
div, and the separate `ui-restore` render branch (`App.tsx:352-363`) are all
deleted.

CSS attribute selectors (`[data-zen] .zen-collapse { … }`) then reach any
descendant that opts in, regardless of DOM depth. This is what makes a
future chrome element trivial to add: give it the class, done — no prop
threading `uiHidden` through `Workbench`'s props, no new context read in a
component that doesn't otherwise need one.

### 2. Sim controls and the view switcher are exempt by omission

`SimControls`, `SimControlsCompact`, `ViewSwitch`, and the mobile
`.mobile-topleft` row containing them get no `.zen-collapse` class. Since
the old all-or-nothing `.app-chrome` wrapper is gone, "exempt" now means
literally nothing extra — they're just plain elements that happen not to
match any `[data-zen]` rule. No restructuring of `Workbench.tsx`'s existing
grid/card layout is needed to achieve this; the exemption falls out of the
attribute-selector model rather than requiring these elements to move
outside some container.

### 3. The two-stage collapse rule

One reusable pattern, applied at two granularities:

```css
.zen-collapse {
  overflow: hidden;
  transition:
    max-width 180ms cubic-bezier(0.2, 0.7, 0.3, 1),
    opacity 120ms ease;
  transition-delay: 0ms, 140ms;
}
[data-zen] .zen-collapse {
  max-width: 0;
  opacity: 0;
}
```

(Concrete values — timing, and `max-height` for vertically-stacked labels
like the mode dock's — are worked out during implementation, not fixed
here; the shape of the rule is what's being specified.)

- **Text spans**: `.btn-label` on Share/Fork & edit, `.tool-btn-label` on
  each `ToolButton`, the `system-name` input and `panel-head-title` in the
  left menu. Width collapses to 0 first; because these sit in ordinary
  flex rows, their siblings (icons) reflow into the freed space through
  normal layout — not a translate or absolute-position trick.
- **Whole clusters**: after their own labels finish collapsing, the
  surrounding card (`.actions-full`, `.toolbar-dock`) gets the same
  treatment at cluster granularity — collapsing toward zero, then fading —
  and an `inert` attribute (React: `inert={uiHidden}` on the wrapping
  element) once hidden, so it's unreachable by keyboard or a screen reader.
  This replaces the accessibility guarantee the old unmount gave for free.

### 4. The left menu ↔ restore button: one element, not two

`MenuCard` (`Workbench.tsx:254-276`) becomes the permanent home of both
states; the separate `ui-restore` button is deleted outright, not just
hidden. Under `[data-zen]`, in this order:

1. The Objects list force-collapses. This reuses the existing
   `.collapsible`/`.collapsed` max-height mechanism (`app.css:847-864`)
   unchanged — `[data-zen] .collapsible` just forces the collapsed state
   regardless of the manual chevron toggle, and releases it back to
   whatever the user last chose when zen mode turns off.
2. The brand-row text (`system-name` input, file-menu label) collapses via
   `.zen-collapse`.
3. Last, the card's own `width` — currently the fixed `--panel-w` (280px)
   — transitions to `auto`, landing on the same icon + system-name pill
   shape `.ui-restore` (`app.css:797-827`) rendered as a separate element
   before. Position is untouched throughout (`grid-area`/`justify-self:
start` never change), so the card visibly shrinks in place rather than
   jumping.

The Hide-UI `IconButton` itself never collapses — it's excluded from
`.zen-collapse` in both states, since it's the control that reverses the
transition either way.

## Testing

- Browser verification (this is a pure UI/CSS behavior change — no logic
  in `packages/core` to unit test): toggle zen mode via the `\` shortcut
  and the toolbar button, confirm sim controls and the view switcher stay
  interactive throughout, confirm the left menu visibly shrinks in place
  (not two elements crossfading), confirm keyboard focus can't land inside
  a collapsed cluster (tab through the page with zen mode on), and confirm
  reversing lands every element back at its original size — including the
  Objects list returning to whatever collapsed/expanded state the user had
  chosen manually before zen mode was toggled on.
- Check both breakpoints: desktop's docked cards and mobile's top bar +
  bottom sheet, since the mobile brand row includes the same toggle and
  `SimControlsCompact` in the same `.mobile-topleft` row.

## Open follow-ups (not blocking this spec)

- `prefers-reduced-motion` support, for this transition and the rest of
  the app's existing fades alike — a separate, codebase-wide pass.
