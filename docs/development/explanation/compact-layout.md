# The compact layout

## The layout condition

```
(max-width: 767px), (max-height: 500px)
```

`COMPACT_LAYOUT_QUERY` in `device/capabilities.ts` decides which component
tree mounts. `ui/app.css` repeats the same condition in every media query
that has to move with that tree, and `pnpm check:breakpoint` compares the
two, failing on drift — including a stylesheet query that spells out only
the width half.

The height clause exists because a phone held sideways is 844x390. A
width-only test would put that screen on the desktop branch, docking a
280px workspace card over most of the available height. 500px is the
height below which a full-height side card stops holding a useful list — a
different question from where two 280px columns stop leaving a map between
them — so neither number is derived from the other.

`ui/app.css` also declares `--breakpoint-md` at 768px, one more than the
condition's `max-width`, so Tailwind's `md:` utilities agree about the
width half. `md:` cannot express the height half, so it must never fork
layout: used that way, a landscape phone would take the desktop branch. It
stays correct for anything that only cares about width.

## Three questions, never bundled

`device/capabilities.ts` exposes three independent questions, and no code
in this layout collapses one into another:

| Question                  | Media query         | Decides                                                                 |
| ------------------------- | ------------------- | ----------------------------------------------------------------------- |
| Is the viewport small?    | the condition above | which component tree mounts                                             |
| Is the pointer imprecise? | `(pointer: coarse)` | hit tolerance on the map, and every control's minimum size (44px floor) |
| Can the device hover?     | `(hover: none)`     | whether anything may be revealed only on hover                          |

A touchscreen laptop answers no, yes, yes. Keying touch sizing to viewport
width would miss it. Keying hover reveals to pointer precision would take
actions away from its mouse. Each stays a separate hook so a caller reaches
for the question it actually means, not a proxy that happens to correlate
on most devices.

## Two anchored surfaces

Below the condition, chrome does not float over the map. A top bar and a
workbench sit flush against the screen's edges, full width, separated from
the map by a hairline border rather than a shadow. The map owns the band
between them, and nothing overlaps anything else.

```
┌───────────────────────────────────────┐
│ ▤  Untitled system   Network ⌄   ◈  ⋯ │  .compact-top-bar — 48px, flush, no radius
├───────────────────────────────────────┤
│                                       │
│                 M A P                 │  the band between the two bars
│                            ┌──┐       │
│                            │+ │       │  MapLibre reads --workbench-h
╞═══════════════════════════════════════╡  .compact-workbench — 16px top radius, it moves
│ ▭   Line 1                        ⌄   │  SheetHandle
│     detail panel (the one scroller)   │  .workbench-panel
├───────────────────────────────────────┤
│ ▶ 08:00 1×  │  ▸ ⌁ ▬ ⬤ ⛬  → scrolls   │  .workbench-rail — after the panel, always visible
└───────────────────────────────────────┘  + env(safe-area-inset-bottom)
```

`.compact-top-bar` has no corner radius and does not move.
`.compact-workbench` keeps a 16px top radius because it moves with its
detent.

The tool rail lives inside the workbench, after the panel in DOM order
rather than beneath it in z-order. Growing the panel cannot cover the
rail: the two are siblings, not stacked layers, so there is no z-order for
the panel to win.

## Detents

`Detent` is `'closed' | 'half' | 'full'`. Which stop a newly shown panel
opens to depends on why it appeared:

- An armed tool opens to `closed` because you armed it to work on the map,
  not to read a panel about it. It names itself in the handle while it
  waits.
- A selection opens to `half`. You selected the object to look at it.

`detentFor()` in `Workbench.tsx` is a plain function of `SupplementalKind`,
which makes it testable without a renderer. A mounted component test could
only ever observe the first stop: effects do not run in a static render.

Dragging the handle moves the surface one stop in the direction of the
drag, not to the nearest stop. Its height is a CSS transition rather than
a value bound to the pointer, so a drag that skipped a stop would land
somewhere the user could not have predicted.

Every stop is a fraction of the viewport height, capped so the surface can
never rise above the top bar.

## `--workbench-h`

`usePublishedHeight` writes the workbench's rendered height to
`--workbench-h` on the document root on every resize.
`.maplibregl-ctrl-bottom-right` reads it to stay clear of the workbench.
MapLibre renders those controls outside React's tree, so this variable is
their only way to learn the workbench's current height.

Two rules protect that channel:

- `--workbench-h` must be declared in `:root`, even though only JavaScript
  writes to it. Left undeclared, the CSS optimizer folds
  `calc(var(--workbench-h, 96px) + 8px)` into a flat constant, and the
  controls stop moving.
- The `bottom` rule that reads `--workbench-h` must carry no `transition`
  of its own. With one, the computed value freezes at whatever it read
  when the transition first ran, instead of tracking the variable — the
  workbench's own height already animates via `max-height`, so the
  consumer must update immediately or not at all.

## Density is a property of the container

Two controls in the top row have a wide rendering and a narrow one, and
the container's available width picks between them:

- the view switch — three segments, or one labelled button that opens the
  same three
- the simulation transport — a four-button speed ladder, or play/pause
  plus a clock, with the ladder behind a trigger wearing the current speed

`ROOMY_TOP_ROW_QUERY`, `(min-width: 1089px)` in `Workbench.tsx`, sets the
threshold. 1089 is arithmetic over fixed widths, not a measured
breakpoint: 280px for the workspace panel, 254px for the segmented view
switch, 337px for the simulation bar, 178px for the action bar's narrowest
step, 24px for three 8px gaps, and 16px for the overlay's inset. Adding a
control to either bar changes this sum; re-measure it when that happens.

`.top-app-bar` keeps `overflow-x: auto` as a backstop, so a wrong
threshold degrades to a scroll instead of hiding content with nothing to
say so.

The choice tracks available width, not device type: a phone gets the
narrow rendering because it is narrow, and a compact browser window on a
desktop gets it for the same reason. That is why the component is named
`SimControlsCompact` rather than anything naming a device.

## Nothing is gated on a device check

No capability in this layout is hidden, disabled, or reduced by a device
check. Cross-section editing, junction editing, and GTFS import are all
reachable on a phone, with correct touch targets and reachable labels
instead of a separate, smaller feature set.

The touch gesture grammar in `map/touch-gestures.ts` does not change for
the compact layout. One finger drives whichever tool is armed. Two fingers
pan the camera. A pinch zooms. A double tap finishes a line. A long press
acts as a right-click.
