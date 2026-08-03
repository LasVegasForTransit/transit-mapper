# Touch input grammar: the same verbs through a different grammar

## Status

Implemented 2026-08-01, as designed. All four decisions below were settled
first and none changed during implementation: the device-support position, the
touch gesture table, the rename of `ModifierState`, and app-owned two-finger
pan.

Three things surfaced only while building it, all fixed before landing.

**The synthesized mouse event needed client coordinates.** `openMenuAt` and the
pointer badge both position against `originalEvent.clientX`/`clientY`, which a
canvas-relative `point` is not whenever the canvas is inset. The adapter reads
them from the real `TouchEvent` and falls back to the point.

**Five dispatch branches read key state directly.** `onMouseDown` tested
`oe.altKey`, `oe.shiftKey`, and `oe.ctrlKey` in its own branches rather than
going through the resolver, and six mid-drag reads tested `shiftKey` for the
geometry constraint. A latched channel would have changed the badge and the
cursor while those branches did something else — the badge promising erase
while the press moved the station. All eleven read the resolved channels now.

**`hoverCapable` had to be asked as `(hover: none)` and negated.** Under
`(hover: hover)` a browser too old for `matchMedia` matches nothing, which
reads as "cannot hover" and hands a desktop the touch affordances. Asking the
negative makes every capability default to its desktop answer.

One design point moved. `touch-action: none` was specified on `.app`; it
belongs on the map container alone, because the bottom sheet and the panels
inside it scroll and a blanket rule at that level freezes them.

Four more surfaced only under a real browser on a phone profile, none of
which a unit test could have reached. They are recorded here because each is
a fact about how touch actually behaves, not about this codebase.

**A tap arrives twice, or not at all, depending on the engine.** Browsers
emit compatibility `mousedown`/`mouseup`/`click` after a motionless touch,
so an adapter that synthesizes them too runs every tap twice: three taps
produced four control points. Leaning on the browser's instead is equally
wrong, because whether they arrive depends on `touch-action`, on whether
anything called `preventDefault`, and on the engine — three taps then
produced two points. The adapter drives every gesture itself and discards
the browser's tail through a 700ms window.

**That window swallowed the adapter's own dispatch.** The second tap of a
double tap falls inside the first tap's suppression window. Timing cannot
separate the two, so the dispatch says which it is through a
`dispatchingSynthetic` flag.

**The double-tap gap must come from the event, not the clock.** Committing a
tap runs a store mutation and a MapLibre repaint, and that work blocks the
main thread. Measured with `Date.now()`, two taps 80ms apart came out 549ms
apart, so no double tap ever registered and a line could not be finished by
finger. `TouchEvent.timeStamp` records when the touch happened. The window
is also 500ms rather than 300ms, since dispatch latency still lands inside
the measured gap on a slow device; the distance check is what actually
prevents a false positive.

**Select's modifier panel must not open the mobile sheet.** Stage 4 made the
channels available whenever Select is armed on a touch device, which fed
`hasSupplementalContent` and parked the sheet over 62% of the map from the
moment the app loaded — found because taps in the browser were landing on
the inspector instead of the canvas. `supplementalIsFresh` separates content
a person just caused from a tool's standing defaults; only the former
expands the sheet.

## Context

The editor's chrome is already responsive. `apps/web/src/ui/Workbench.tsx`
mounts two layouts from one media query and `apps/web/src/ui/app.css` carries
real rules for the bottom sheet, the icon-only tool dock, and the collapsed
action cluster. The layout work is done and it is not the problem.

The map is not chrome. `apps/web/src/map/MapCanvas.tsx:323` builds MapLibre
with `dragPan: false`, documented in place as "SimCity-style: the map pans on
right-drag / space-drag only". `apps/web/src/map/interactions.ts` carries the
entire editing vocabulary in 2854 lines and binds only MapLibre mouse events:
`mousedown`, `mousemove`, `mouseup`, `mouseout`, `click`, `dblclick`, plus a
DOM `contextmenu` listener registered at `interactions.ts:2636-2652`. No
`PointerEvent` or `TouchEvent` code exists under `src/map/`. The identifiers
that read as pointer-neutral — `onPointerUp`, `publishPointerIntent`,
`PointerBadge` — are conceptual names on mouse-event bindings.

Browsers emit no `mousemove` during a touch drag. The consequences on a phone
today:

| Interaction                                                    | State                                                        |
| -------------------------------------------------------------- | ------------------------------------------------------------ |
| Tap to select                                                  | Works, through synthesized compatibility events              |
| Pinch to zoom                                                  | Works; `touchZoomRotate` was left at its default             |
| One-finger pan                                                 | Dead. `dragPan: false` and no touch handler of the app's own |
| Freehand draw, drag a control point, drag a station, marquee   | Dead. Each needs `mousemove`                                 |
| Context menu, finish a way, one-way branch                     | Unreachable. Bound to the right button                       |
| Erase, split, angle-snap, extend-vs-reshape, separate corridor | Unreachable. Bound to Alt, Ctrl, and Shift                   |

A person on a phone can pan by pinching, tap things, and read the inspector.
They cannot draw.

Two conflations make this harder to fix than it needs to be.

**Width stands in for capability.** `Workbench.tsx:20` declares
`MOBILE_QUERY = '(max-width: 767px)'` and every downstream decision reads that
one boolean. Width is the right question for layout and the wrong one for
input: a touchscreen laptop and an iPad in landscape are wide and coarse, and
they get hit tolerances tuned for a mouse. The app queries `prefers-color-scheme`
and `prefers-reduced-motion` but never `pointer`, `hover`, or `any-pointer`.

**That width disagrees with itself.** 767px in `Workbench.tsx:20` and
`apps/web/src/pwa/install.ts:115`; 760px in `app.css`'s `@theme
--breakpoint-md`; media queries at 860px, 620px, and 339px. The comment at
`app.css:9-15` claims "one breakpoint, not two independently-tuned ones that
could drift apart" and names a hook, `useIsMobileLayout`, that does not exist.
The hook is `useMobileLayout` and its query is 767px, not 760px.

## The device position

The repository has never stated one. `docs/development/reference/performance-acceptance-matrix.md:61`
release-gates a row reading "Phone and tablet load, tap response, tool
switching, inspector, dialogs, keyboard avoidance, and orientation change"
without any document saying what passing means, and
`docs/product/explanation/design-principles.md` says nothing about devices,
screens, or input modality.

The position this spec adopts:

> Desktop is the primary authoring surface. Touch reaches every verb desktop
> reaches, through a grammar suited to fingers. Layout adapts to viewport
> width; the input grammar adapts to pointer capability. The two adapt
> independently, because a device can be wide and coarse, or narrow and fine.

Desktop-first is a statement about which surface sets the vocabulary, not about
which surface is allowed to work. The verb list in
`apps/web/src/editor/pointerIntent.ts` is the vocabulary, it was designed for a
mouse and a keyboard, and touch does not get to add to it or subtract from it.

## The seam

`pointerIntent.ts` already separates deciding from dispatching.
`resolvePointerIntent()` is pure — no DOM, no MapLibre — taking `{view, tool,
target, modifiers, readOnly, armed, gestureActive, lockedPrimaryOperation,
routeDraftActive}` and returning `{primaryOperation, cursor, badge, allowed,
anchor, constraint}`. Its own header states the intent: presentation and
dispatch make the same decision without needing a browser.

Touch therefore adds no branch to the resolver. Two things feed it instead:

1. `ModifierState` changes meaning. It currently records which keys are held.
   It will record which modal channels are active, from a held key or from a
   latched toggle. Alt-held and an armed Erase toggle produce identical input.
2. `interactions.ts` gains a second event source producing the same
   `(target, modifiers, screen point)` triple the mouse path produces.

A change that instead puts `if (isTouch)` inside `resolvePointerIntent` has
taken the wrong seam and should be rejected in review. The test for this is
mechanical: `pointerIntent.ts` must keep importing nothing.

MapLibre supplies the event source. Verified against the installed
`maplibre-gl@4.7.1` typings, the map fires `touchstart`, `touchmove`,
`touchend`, and `touchcancel` as `MapTouchEvent`, carrying `point` (the
centroid), `points: Point[]` (every active touch), `lngLat`, `lngLats`, and a
`preventDefault()` that suppresses `DragPanHandler` and
`TwoFingersTouchZoomRotateHandler` for that gesture. These are pre-projected
exactly like `MapMouseEvent`, so the touch source is symmetric with the mouse
source and needs no new projection code.

## Goals

- Every operation in `PointerOperation` reachable by touch.
- Desktop's gesture vocabulary unchanged. Held modifier keys keep working
  exactly as they do now.
- Layout capability and pointer capability resolved separately, from media
  queries, with no `navigator.userAgent` inspection anywhere.
- The five input-tuning literals in `interactions.ts:73-81` collected into one
  declared table, satisfying the outstanding `ROADMAP.md:111-115` item.
- Touch gestures covered by the existing fake-map test harness in
  `apps/web/tests/map/interactions.test.ts`, not only by manual journeys.

## Non-goals

- A settings-dialog override for the tuning values. `ROADMAP.md:111-115` asks
  for that too. Declaring the table is what unblocks it; shipping both at once
  merges two changes with different risk.
- Touch work in the read-only embed. `apps/web/src/embed/main.ts:80-85` already
  enables `dragPan` and `touchZoomRotate` and has no editing verbs to reach.
- Rotation and pitch. `dragRotate: false` stays, and two-finger rotation is
  disabled the way the embed disables it.
- Rewriting the two-layout mount fork in `Workbench.tsx`. Its reasoning holds:
  CSS-hiding one layout leaves every hidden panel subscribed to the editor
  store. It needs a better-named input, nothing more.
- A tooltip system for touch. The roughly 50 `title` attributes are on icon
  buttons that already carry `aria-label`.

## Architecture

### 1. Two capabilities, not one boolean

A new module, `apps/web/src/ui/device-capabilities.ts`:

```ts
export interface DeviceCapabilities {
  /** Width-driven. Decides docked cards against the bottom sheet. */
  compactLayout: boolean;
  /** `(pointer: coarse)`. Decides hit tolerance and gesture grammar. */
  coarsePointer: boolean;
  /** `(hover: none)`. Decides whether an idle-state affordance can carry meaning. */
  hoverCapable: boolean;
}
```

The `useSyncExternalStore` subscribe/snapshot pair at `Workbench.tsx:22-45` —
including its Safari-before-14 `addListener` fallback — moves here as a shared
`mediaQueryStore(query)` helper. Writing a third copy of that pair is how the
breakpoints drifted in the first place.

Consumers:

| Module                                | Reads           | Change                                                            |
| ------------------------------------- | --------------- | ----------------------------------------------------------------- |
| `ui/Workbench.tsx`                    | `compactLayout` | `useMobileLayout` becomes `useCompactLayout`. Behaviour identical |
| `map/interactions.ts`                 | `coarsePointer` | Selects the tuning profile (§3)                                   |
| `map/PointerBadge.tsx`, `cursorFor()` | `hoverCapable`  | Intent feedback (§6)                                              |
| `pwa/install.ts:114-118`              | both            | The `navigator.userAgent` regex goes                              |

That regex is the app's only user-agent sniff, and it is wrong on iPadOS, which
reports as a Mac. `!compactLayout && hoverCapable` describes what the install
banner actually wants: a device where a desktop install means something.

### 2. One breakpoint, named

`--breakpoint-md` moves to 768px, matching Tailwind's default and the existing
767px JavaScript query, and the JavaScript query derives from the same declared
intent. The two MapLibre control offsets at `app.css:2919` (760px) and
`app.css:3218` (767px) collapse into one rule.

860px, 620px, and 339px stay. They are real widths at which specific content
stops fitting — the tool dock against the full-height right panel, the button
labels in the top bar, and the view switcher — not accidents. Each gets a token
name and a comment saying what stops fitting there, so the next person changing
one knows what to re-check.

Two dead things go in the same change, because both are misleading to anyone
reading the file for a layout answer:

- `.app-chrome`'s `grid-area` declarations at `app.css:841` and `:854` name a
  container removed in an earlier refactor. `.panel-left`'s actual parent is a
  flex container, so the declarations are inert.
- `.sheet`, `.sheet.peek`, `.sheet-shell`, `.toolbar-fade`, and
  `.toolbar-fade-hidden` at `app.css:2930-3023` are a superseded bottom-sheet
  implementation. The live sheet is built from Tailwind utilities in
  `Workbench.tsx:316-352` and reuses only `.sheet-handle`, `.sheet-grip`,
  `.sheet-title`, and `.sheet-back`, which stay.

### 3. The input-tuning table

`ROADMAP.md:111-115` states the reason already: "pointer precision varies
enormously between a trackpad, a mouse, and a hand that shakes, and a fixed
4-pixel drag threshold is an accessibility decision made on someone else's
behalf."

A new module, `apps/web/src/editor/input-tuning.ts`:

| Constant             | Fine | Coarse | Provenance                                                                                             |
| -------------------- | ---- | ------ | ------------------------------------------------------------------------------------------------------ |
| `HIT_PX`             | 9    | 24     | A fingertip contact patch measures 9–11mm; at roughly 160 CSS px/inch that is about 24 CSS px across   |
| `SNAP_PX`            | 18   | 32     | Held proportionally above `HIT_PX` so snapping still beats plain hit-testing                           |
| `DRAG_PX`            | 4    | 10     | Finger-down jitter routinely exceeds 4px, at which a tap registers as a drag                           |
| `FREEHAND_SAMPLE_PX` | 16   | 16     | Unchanged. Sample spacing is a geometry-fidelity choice, not a precision one                           |
| `STRAIGHT_SNAP_PX`   | 10   | 20     | A screen distance by design, per its comment at `interactions.ts:77-81`, so it scales with the pointer |

It belongs in `apps/web`, not `packages/core`.
`docs/development/explanation/architecture.md:230` assigns interaction state to
the web app and reserves core for the rules of what a transit system is.
Pointer precision is a fact about a hand, not about a transit network. It stays
a plain exported table of numbers, which is what makes it reachable from
`apps/web/tests/verify.test.ts` with no browser.

The resolved profile threads through `attachInteractions`' existing options
object instead of being read from a module global, so a test installs a profile
by argument and never stubs `matchMedia`.

### 4. The gesture table

| Gesture                            | Resolves to            | Notes                                                                                                                             |
| ---------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| One-finger drag                    | The active tool's verb | Identical to desktop's left-drag: draw, move a point, move a station, extend a terminus, marquee                                  |
| Two-finger drag                    | `pan`                  | The analogue of the desktop rule that the primary press belongs to the tool and the camera needs a deliberate second input        |
| Pinch                              | Zoom                   | Already works. `touchZoomRotate` stays on, with `disableRotation()` as `embed/main.ts:85` calls it                                |
| Long-press, 500ms within `DRAG_PX` | `actions` channel      | Covers the whole right-click family: `open-line-actions`, `open-terminus-actions`, `open-corridor-actions`, and the action anchor |
| Double-tap                         | Finish a way           | `doubleClickZoom` is already false, so the gesture is unclaimed                                                                   |

Two-finger tap for undo is **rejected**. It is a convention from document
viewers, it collides with the two-finger pan gesture's own touch-down, and undo
already has a visible button in the action cluster.

Implementation constraints:

- Branch on `e.points.length` at `touchstart` only, then latch the branch for
  the gesture's lifetime. A finger lifting mid-pinch must not convert a pan
  into a draw.
- The long-press timer starts at `touchstart` and is cancelled by movement past
  the coarse `DRAG_PX` or by `touchend`. On fire it synthesizes the same
  channel state the right button sets and dispatches through the existing path.
  Haptic confirmation through `navigator.vibrate` where it exists, guarded:
  iOS Safari does not implement it.
- `onMouseDown`'s dispatch does not fork. The body below its `oe.button` guard
  at `interactions.ts:1943` extracts into `beginGesture(target, modifiers,
point)`, which both sources call.

### 5. Two-finger pan: the implementation choice

**Decided: the app owns two-finger pan.** `dragPan` stays false. The touch
source feeds centroid deltas into the existing `startPan` rAF-accumulate loop
at `interactions.ts:618`, which already drives `map.panBy`.

The alternative was calling `map.dragPan.enable()` and disabling only its mouse
sub-handler, since `DragPanHandler` holds `_mousePan` and `_touchPan`
separately. It is rejected: both are underscore-prefixed internals with no
public accessor, so a MapLibre upgrade breaks desktop's "the left button
belongs to the tool" rule silently, and the failure surfaces as an editing bug
rather than a build error.

`cooperativeGestures: true` is a third option that gives exactly the desired
two-finger semantics, and it is also rejected: it gates wheel zoom behind Ctrl,
which would break desktop scroll-to-zoom, and it renders its own overlay copy.

The owned implementation composes correctly with MapLibre's pinch, which zooms
`around` the centroid and so holds the centroid fixed while the app translates
it.

### 6. Modifier channels

Shift, Alt, Ctrl, and Space gate real verbs. Touch has none of them, and
inventing a chorded touch gesture per modifier produces something nobody can
learn.

They become state with two input paths. The field names in `ModifierState` are
key names, which is the wrong altitude once a toggle can also set them:

| Today         | Becomes     | Gates                                             |
| ------------- | ----------- | ------------------------------------------------- |
| `space`       | `pan`       | Camera pan over any target                        |
| `shift`       | `constrain` | Angle-snap, constrained move                      |
| `alt`         | `alternate` | Erase in Select, separate corridor in Way         |
| `ctrlOrMeta`  | `secondary` | Split at an interior point, extend at an endpoint |
| `rightButton` | `actions`   | The action-anchor menus                           |

The names are channels, not verbs, on purpose. `alternate` means erase under
Select and separate-corridor under Way, so a verb name would be accurate in one
tool and a lie in the other. `resolvePointerIntent`'s body does not change;
only the field names it reads do.

**Where the toggles live.** Not a strip above the tool dock.
`apps/web/src/ui/inspector/drafts.tsx:18-27` records that surface being removed
deliberately — "one dynamic surface, not two" — and CLAUDE.md carries it as an
invariant. They belong in the right-hand inspector beside a tool's other draft
options, rendered by `ToolDraftInspector` as a shared section.

That exposes a gap. `ToolDraftInspector` returns `null` for the Select tool,
and the inspector is hidden when nothing is selected, yet Select is where
erase, split, and constrain matter most. Select gains a draft section of its
own, and `hasSupplementalContent` (`Workbench.tsx:66`) counts it. The mobile
sheet's auto-expand effect at `Workbench.tsx:143-145` needs re-checking against
that: it must not pop the sheet open on every tool switch.

**Desktop gets this too.** The toggles render for every pointer type, as live
indicators reflecting held keys that can also be clicked to latch. Held keys
are unaffected, so muscle memory survives, and the modifiers stop being
undiscoverable — today the only way to learn that Alt erases is the shortcuts
dialog. A latched channel must also be visible on the map, or an armed Erase
becomes a trap the next tap springs.

### 7. Intent feedback without hover

`cursorFor()` at `interactions.ts:2571` and `map/PointerBadge.tsx` carry the
whole "what will this press do" contract, and
`docs/product/reference/editor-interactions.md` is a normative table of cursors
and badges. Neither survives the loss of an idle pointer.

Touch has no idle state but it does have a press before the drag threshold. The
intent resolves at `touchstart` and the badge shows immediately, anchored above
the contact point. `PointerBadge` offsets `+14/+14` today, which places it
under the fingertip; when `!hoverCapable` it offsets upward instead. The person
sees what the gesture will do while there is still time to lift and cancel,
which is the guarantee hover gives, moved inside the gesture.

Follow-on consequences: the badge survives the whole press rather than only the
pre-drag window; a `not-allowed` intent needs a visible refusal, since no
cursor will change to express it; and `PointerIntent.cursor` simply goes unread
on coarse pointers, so it needs no optionality.

### 8. Viewport and chrome physics

Independent of everything above and shippable at any point.

- `viewport-fit=cover` on `apps/web/index.html:5` and `embed.html:5`.
- `env(safe-area-inset-bottom)` folded into `--controls-clearance` and the
  sheet's padding. The sheet, the tool dock's `pb-14` at `Workbench.tsx:296`,
  and MapLibre's bottom-right controls all sit at the bottom edge, under the
  iPhone home indicator.
- `dvh` replacing `vh` at `app.css:823` (`.panel`, `100vh`), `:2449` (`.modal`,
  `90vh`), and `:2942` (the sheet, `62vh`). Mobile URL-bar collapse makes `vh`
  wrong by the bar's height for a whole session.
- `touch-action: none` on the map container, so the browser does not claim a
  drag as a scroll or a pull-to-refresh before the app sees it.
  `overscroll-behavior: none` on `.app`.
- On-screen-keyboard avoidance through `visualViewport`'s resize event, insetting
  the sheet. Focusing the system-name input or an inspector field on a phone
  currently puts the keyboard over the sheet.
- Orientation change needs no map work: `MapCanvas.tsx:1277` already runs a
  `ResizeObserver` calling `map.resize()`. The sheet's height and the wrapped
  action cluster need checking on a short landscape viewport.

## Testing

Every stage passes `pnpm check` on its own.

| Surface                                                    | Where                                                                                                                                                                                              |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The capability store, both axes independent                | New `apps/web/tests/ui/device-capabilities.test.ts`                                                                                                                                                |
| Layout fork against capability, coarse-and-wide included   | `apps/web/tests/ui/Workbench.test.tsx`, extending its `vi.stubGlobal('window', {matchMedia})` pattern                                                                                              |
| The tuning table's declared values                         | A `// --- input tuning: coarse pointers get proportional tolerances ---` section in `apps/web/tests/verify.test.ts`, in `check()` style                                                            |
| A latched channel and a held key produce identical intents | Same file, beside the existing pointer-intent cases                                                                                                                                                |
| Touch gestures                                             | `apps/web/tests/map/interactions.test.ts`. Its fake map already dispatches synthetic map events, and `MapTouchEvent` needs only `point`, `points`, `lngLat`, `originalEvent`, and `preventDefault` |
| Select's draft section makes `hasSupplementalContent` true | `apps/web/tests/ui/`                                                                                                                                                                               |

Touch cases to cover explicitly: a one-finger drag draws; a two-finger drag
pans and does not draw; a finger lifted mid-pinch does not start a draw; a
long-press opens actions; a long-press cancelled by movement does not;
double-tap finishes a way; a 6px move is a click under both profiles while a
12px move is a drag under fine and a click under coarse.

Genuinely browser-only, recorded per the acceptance matrix's "Recording a
release result": finger-against-stylus precision, safe-area rendering on a
notched device, keyboard avoidance, orientation change, and haptics.

**An end-to-end tree is warranted here and is not warranted anywhere else
yet.** Touch gestures are the first behaviour in this codebase whose failure
mode is that synthetic events pass and real fingers do not.
`scripts/check-file-names.ts:69-76` already sanctions
`apps/web/tests/e2e/<name>.spec.ts` and the Vitest globs already exclude it, so
no configuration changes. It needs a runner script wired somewhere other than
`verify`, which is required to stay free of a browser and a network.
`playwright-core` is already a dev dependency for the performance harness, and
`apps/web/src/perf/scenarios.ts` already defines a 390×844 device-pixel-ratio-3
mobile profile to reuse.

## Documentation this invalidates

- `docs/product/reference/editor-interactions.md` — the normative pointer-intent
  table needs a touch column, and its `Space`/`Alt`/`Shift` rows need the
  channel names from §6. It is wrong the moment §6 lands.
- `docs/product/tutorials/getting-started.md:13-18` — states "Pan: right-drag,
  or hold space and drag" with no touch equivalent.
- `docs/product/reference/keyboard-shortcuts.md:3-4` — "Everything the keyboard
  does is also reachable by mouse" becomes a claim about pointers.
- `docs/development/reference/project-structure.md` — records the two new
  modules. Its heading shape is enforced by `check:structure`.
- `docs/development/explanation/architecture.md` — the device position, under
  section 2, Architecture Constraints. Twelve fixed headings and a 5,000-word
  cap, so it fits an existing section or it does not land.
- `docs/development/reference/performance-acceptance-matrix.md:61` — the
  Responsive layouts row names the gesture table in §4 as its criterion.

## Open questions

- **Stylus.** An Apple Pencil reports `pointer: fine` on a device whose layout
  is compact, which the capability model handles correctly by construction.
  Untested, and no maintainer has the hardware.
- **The 500ms long-press threshold** is the platform convention, not a measured
  value. It is a candidate for the eventual tuning-override setting.
- **Marquee select by touch** works under this design through a one-finger drag
  on empty ground, but it competes with nothing else only while the Select tool
  is armed and `constrain` is unlatched. Whether that is discoverable is a
  question for live testing, not for this document.
