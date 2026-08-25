# The compact layout

## The layout condition

```
(max-width: 767px), (max-height: 500px)
```

`COMPACT_LAYOUT_QUERY` in `packages/workspace/src/media-query.ts` decides which
component tree mounts. `packages/workspace/src/workbench.css` repeats the same
condition for shared chrome. `apps/web/src/ui/app.css` repeats it for map and
editor presentation. `pnpm check:breakpoint` compares all three and fails on
drift, including a stylesheet query that spells out only the width half.

The height clause exists because a phone held sideways is 844x390. A
width-only test would put that screen on the desktop branch, docking a
280px workspace card over most of the available height. 500px is the
height below which a full-height side card stops holding a useful list — a
different question from where two 280px columns stop leaving a map between
them — so neither number is derived from the other.

`apps/web/src/ui/app.css` also declares `--breakpoint-md` at 768px, one more than the
condition's `max-width`, so Tailwind's `md:` utilities agree about the
width half. `md:` cannot express the height half, so it must never fork
layout: used that way, a landscape phone would take the desktop branch. It
stays correct for anything that only cares about width.

## Three questions, never bundled

`apps/web/src/device/capabilities.ts` exposes three independent questions
through the workspace package's generic media-query APIs. No code in this
layout collapses one into another:

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
│                            │+ │       │  MapLibre reads --map-pad-bottom
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

`supplementalDetent()` in `apps/web/src/ui/workspace-adapter.ts` is a plain
function of `SupplementalKind`. It keeps editor meaning out of the shared
Workbench and makes the policy testable without a renderer. The Workbench
accepts only the resulting initial detent.

Dragging the handle moves the surface one stop in the direction of the
drag, not to the nearest stop. Its height is a CSS transition rather than
a value bound to the pointer, so a drag that skipped a stop would land
somewhere the user could not have predicted.

Every stop is a fraction of the viewport height, capped so the surface can
never rise above the top bar.

## What the chrome covers

The map is full-bleed behind the chrome, so it has no idea any of it is there.
Four custom properties in `packages/workspace/src/workbench.css` say what it covers:

```
--map-pad-top  --map-pad-bottom  --map-pad-left  --map-pad-right
```

They are declared beside the rules that create the chrome. The base values on
`.workspace-root` describe the docked layout. The compact and short-viewport
blocks override them, so there is one source and two readers.

`MapCanvas` reads them and calls `map.setPadding()`, which makes every camera
operation frame inside the visible band. Without it, `fitBounds` centres on the
whole canvas: at 844×390 the map's centre landed 40px below the middle of the
band you can see, and content fitted to bounds ran under both bars. The three
fits in that file add their own margin to these values rather than passing a
bare number, because `fitBounds`'s `padding` replaces the map's padding instead
of adding to it.

`.maplibregl-ctrl-bottom-right` reads `--map-pad-bottom` for the same reason:
MapLibre renders its controls inside the map, which does not know where the
bottom bar is.

Three things to know before changing them:

- **They are registered with `@property`**, and have to be. An unregistered
  custom property hands back its raw token stream, so
  `getPropertyValue('--map-pad-top')` returns the string `calc(48px + 0px)` and
  `parseFloat` gives `NaN`. The camera read four of those, fell back to zero,
  and held no padding while devtools showed every value as correct.
- **The bottom figures are measured, not estimated.** 168px portrait and 128px
  landscape, both taken from the rendered workbench. Estimates of 152 and 112
  went in first and left the zoom buttons 15px inside it. Re-measure if the
  rail's contents change.
- **They describe the chrome at rest**, not at whichever detent the panel is
  on. A panel the user opened is meant to cover the map; that is what opening
  it means. An earlier version tracked the live height with a `ResizeObserver`
  that wrote it to the document root, and the tracking was never the point.

## Density is a property of the container

Two controls in the top row have a wide rendering and a narrow one, and
the container's available width picks between them:

- the view switch — three segments, or one labelled button that opens the
  same three
- the simulation transport — a four-button speed ladder, or play/pause
  plus a clock, with the ladder behind a trigger wearing the current speed

`ROOMY_TOP_ROW_QUERY`, `(min-width: 1089px)` in
`packages/workspace/src/workbench.tsx`, sets the threshold. 1089 is arithmetic
over fixed widths, not a measured breakpoint: 280px for the workspace panel,
254px for the segmented view switch, 337px for the simulation bar, 178px for
the action bar's narrowest step, 24px for three 8px gaps, and 16px for the
overlay's inset. Adding a control to either bar changes this sum; re-measure it
when that happens.

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
