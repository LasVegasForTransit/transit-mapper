# Performance acceptance matrix

This matrix is the release checklist for changes that can affect editor
responsiveness. The numeric Chrome gate is automated by `pnpm perf`; the
manual rows cover browser and failure-path behavior that a deterministic lab
fixture cannot represent honestly.

Do not substitute a successful load for a responsive editor. A row passes only
when input remains available while deferred validation, simulation, and
persistence work is running. It also fails if a measurement improves only
because visible feedback freezes, disappears, or an editing or accessibility
capability is disabled.

## Automated Chrome gate

| Surface  | Scale                    | Journey                                             | Required evidence                                                                                            |
| -------- | ------------------------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Editor   | Small, dense, RTC-shaped | Cold load, warm reload, meaningful system paint     | LCP, CLS, transfer, long tasks, heap, and network counters                                                   |
| Editor   | Small, dense, RTC-shaped | Station drag, camera drag, line draw                | Trusted input-to-paint, action-scoped MapLibre frames, model revision, projection phases, and source uploads |
| Editor   | RTC-shaped               | Ten-minute pan, edit/undo, and export-dialog cycle  | Heap, DOM nodes, listeners, workers, and WebGL contexts return within 10% of the warmed baseline             |
| Share    | Large publishable        | Cold/warm load and camera drag                      | LCP, CLS, transfer, meaningful system paint, input-to-paint, and MapLibre frames                             |
| Embed    | Large publishable        | Cold/warm load and camera drag                      | LCP, CLS, transfer, meaningful system paint, and input-to-paint                                              |
| PWA      | Small                    | Install, clear HTTP cache, disconnect, reload, edit | Cached editor graph, local blank-map fallback, populated system overlay, and a committed model edit          |
| Delivery | All entries              | Production build                                    | Complete dynamic import graph, raw-size reporting, gzip/Brotli budgets, and PWA graph verification           |

Chrome Stable runs headed at 1440 × 900, device-pixel ratio 1, four-times CPU
slowdown, and Fast 4G for cold loads. Mobile uses 390 × 844 at device-pixel
ratio 3. The exact budgets and repetition policy are in
[Measure browser performance](../how-to/measure-performance.md).

Pull requests run one candidate-only cold/warm RTC smoke. That smoke proves
the production graph and critical browser journey complete, but it is not
treated as statistical timing evidence. The five-run desktop/mobile matrix and
ten-minute leak audit run only when the Performance workflow is deliberately
dispatched.

Empty editor startup remains a required release row but is not yet in the
fixed automated fixture union. Record it with the manual startup-and-recovery
row until the dedicated zero-entity scenario described in the measurement
guide lands; a green `pnpm perf` result alone does not satisfy that row.

## Manual critical journeys

Record browser version, operating system, fixture, whether simulation was
running or paused, and any visible delay or input loss. Run the desktop rows
in current Safari and Firefox. Run the layout rows at phone, tablet, and
desktop widths.

| Area                 | Journeys                                                                                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Startup and recovery | Empty/small/RTC saved systems; corrupt active record; storage temporarily unavailable; PWA update; offline reload; failed basemap and font     |
| Network view         | Pan, zoom, hover, select, draw, snap, freehand, erase, marquee, way/node/station/group drag, route/adopt, keyboard repeat, undo/redo           |
| Infrastructure view  | Network-view journeys plus lanes, platforms, facilities, footprints, junctions, and vehicle geometry                                           |
| Diagram view         | Load, switch in/out, select, drag, route display, undo/redo, and return to the geographic camera                                               |
| Concurrent work      | Each manipulation with simulation running and paused; validation and autosave landing during the gesture’s deferred window                     |
| Imports              | GTFS download/processing/reconciliation; cancellation during each phase; timeout and malformed archive; OSM endpoint failover and cancellation |
| Library              | Many documents; open, rename, duplicate, create, delete; quota full; storage unavailable; close immediately after an edit                      |
| Exports              | PNG, SVG, and JSON; preview-map pan/reset; repeated invocation; cancellation, timeout, and failed encoding                                     |
| Publishing           | Under-limit and over-limit payload; repeated Publish; optional preview failure; timeout, cancellation, and server failure                      |
| Public delivery      | Share page, embed, API error, preview response, GTFS cache, compression, and cold/warm Worker/D1/cache response                                |
| Responsive layouts   | Phone and tablet load, tap response, tool switching, inspector, dialogs, keyboard avoidance, and orientation change                            |
| Accessibility        | Keyboard-only critical journeys, visible focus, dialog focus return, reduced motion, and screen-reader labels during progress/cancellation     |

## Recording a release result

Attach the following to the change:

- the current and comparison `report.json` files;
- raw Chrome traces from the recorded matrix;
- `bundle-report.json`, `pwa-report.json`, and
  `pwa-runtime-report.json`;
- the ten-minute `soak-report.json`;
- Safari and Firefox versions plus pass/fail notes for the manual critical
  journeys; and
- any accepted limitation, with the affected journey and a follow-up issue.

An optimization is accepted only when its before/after evidence improves a
user-visible journey or removes a demonstrated source of input blocking.
Deterministic operation-count tests protect the mechanism; they do not replace
the browser result.
