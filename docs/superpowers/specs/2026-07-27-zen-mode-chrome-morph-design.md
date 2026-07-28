# Zen mode: chrome reflows instead of swapping components

## Status

Shipped 2026-07-27, as designed. A few things surfaced only under live
testing, all fixed before landing.

**Addition — `useInertRef`.** The design assumed `inert={uiHidden}` on a
plain JSX attribute would work; live testing found React DOM 18.3.x drops
the `inert` attribute silently (it isn't in its attribute whitelist yet —
later React versions add it). `apps/web/src/ui/useInertRef.ts` sets the DOM
IDL property directly through a ref instead, sidestepping JSX entirely. All
six `inert` call sites (`Workbench.tsx` ×4, `TopBar.tsx`'s `ViewSwitch`,
`Toolbar.tsx`) use it.

**The collapsed card's width leaked past its own children.**
`[data-zen] .menu-card { width: auto }` alone didn't shrink the card:
`.collapsible`'s `max-height: 0` clips it vertically but not horizontally,
so its long hint text ("Way tool: drag or click…") kept contributing its
un-wrapped natural width to the card's shrink-to-fit calculation even while
invisible — confirmed live, the "collapsed" card still measured 456px wide.
Both `.collapsible` and `.panel-head` needed an explicit `max-width: 0`
under `[data-zen]`, not just `max-height: 0`, and the card's own
`align-self` (it's normally stretched full-height by design, see
`.panel-left`'s comment) needed overriding too, or the collapsed pill was
full-height instead of a compact top-left control.

**The width never actually animated at all.** Checking only before/after
screenshots missed that the transition itself wasn't smooth: a CSS `width`
transition cannot interpolate toward `auto` — there's no numeric endpoint
to animate to — so `[data-zen] .menu-card { width: auto }` was snapping the
whole time, not morphing. Confirmed via `getComputedStyle(html).
interpolateSize` reporting `"numeric-only"` (the CSS Values L4 feature that
would let `auto` itself interpolate isn't opted into anywhere in this app).
The same class of bug hit `.system-name`/`.ro-name`: their base rule had no
`max-width` at all (implicit `none`, also non-interpolable), so the
zen-mode cap didn't animate either.

The fix in both cases is a real numeric value on both ends of the
transition. For `.system-name`/`.ro-name` that's a generous base
`max-width` the zen state can shrink from. For the card's own width,
`MenuCard` (`Workbench.tsx`) now measures the actual collapsed pixel width
via a `useLayoutEffect` (a temporary `width: auto` probe, read with
`getBoundingClientRect()`, restored before paint) and animates to that
fixed number through an inline style — which stays the source of truth for
as long as the card is collapsed (a `ResizeObserver` re-measures on any
content change, e.g. a rename), rather than handing off to the CSS `auto`
rule once the transition settles. That handoff was the original plan, but
the CSS-only `auto` resolved to a real, reproducible ~90px more than the
identical measurement taken through JS, for reasons not fully run to
ground — rather than depend on figuring out why two theoretically-identical
computations disagreed, JS just stayed authoritative throughout. `Panel`
(`Panel.tsx`) gained a `forwardRef` for this measurement to reach the DOM
node at all.

Two more real layout bugs surfaced chasing that discrepancy, both fixed
along the way: `.panel-brand`/`.panel-brand-row` are children of a
`flex-direction: column` container whose default `align-items: stretch`
was stretching them to the card's own width regardless of their content —
circular with the card trying to shrink-to-fit around them — fixed with
`align-self: flex-start` under `[data-zen]` on both. And `.system-name`,
being an `<input>` rather than a `<span>`, contributed its UA-default
intrinsic width (not its CSS-capped width) to the ancestor's shrink-to-fit
calculation until it was given an explicit `width` (not just `max-width`)
under `[data-zen]`.

**A testing-environment caveat, for whoever debugs this feature next:** the
Browser-pane tool used for live verification always reports
`document.hidden: true` to the page, which throttles `requestAnimationFrame`
and `setTimeout` unpredictably (a scheduled 500ms timer measured firing
after ~1080ms) and appears to suppress `transitionrun`/`transitionend`
dispatch even for plain, correct, real-number CSS transitions. Don't trust
"no transition event fired" as proof of a bug in that tool without also
checking `interpolate-size` / reasoning about the CSS spec directly — it
produced a false lead here before the real, spec-level bugs above were
confirmed independently of event timing.

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
