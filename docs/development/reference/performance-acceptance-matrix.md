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

| Surface  | Scale                    | Journey                                             | Required evidence                                                                                                                     |
| -------- | ------------------------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Editor   | Small, dense, RTC-shaped | Cold load, warm reload, meaningful system paint     | LCP, CLS, transfer, long tasks, heap, and network counters                                                                            |
| Editor   | Small, dense, RTC-shaped | Station drag, camera drag, line draw                | Trusted input-to-paint, action-scoped MapLibre frames, model revision, projection phases, and source uploads                          |
| Editor   | RTC-shaped               | Ten-minute pan, edit/undo, and export-dialog cycle  | Heap, DOM nodes, listeners, workers, and WebGL contexts return within 10% of the warmed baseline                                      |
| Share    | Large publishable        | Cold/warm load and camera drag                      | LCP, CLS, transfer, meaningful system paint, input-to-paint, and MapLibre frames                                                      |
| Embed    | Large publishable        | Cold/warm load and camera drag                      | LCP, CLS, transfer, meaningful system paint, and input-to-paint                                                                       |
| PWA      | Small                    | Install, clear HTTP cache, disconnect, reload, edit | Cached editor graph, local blank-map fallback, populated system overlay, and a committed model edit                                   |
| Delivery | All entries              | Production build                                    | Disjoint eager/lazy entry graphs, eager first-load budgets, lazy chunk ceilings, Worker/install/precache graphs, and PWA verification |

Chrome Stable runs headed at 1440 × 900, device-pixel ratio 1, four-times CPU
slowdown, and Fast 4G for cold loads. Mobile uses 390 × 844 at device-pixel
ratio 3. Synthetic touch events pass where real fingers do not, so the touch
row below is a hardware row and no automated result substitutes for it. The exact budgets and repetition policy are in
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

## Shipping startup milestones

The editor publishes the following User Timing marks in production. Each name
is recorded at most once, carries no document or user data, and is optional
observability: an unavailable or restricted User Timing implementation cannot
interrupt startup.

| Mark                      | Boundary                                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------- |
| `tm:bootstrap-start`      | The editor entry is about to ask React to render.                                               |
| `tm:shell-mounted`        | React committed the always-available editor shell.                                              |
| `tm:storage-read-start`   | Local library bootstrap started.                                                                |
| `tm:storage-read-end`     | Local library bootstrap returned or failed, including unavailable storage.                      |
| `tm:deserialize-start`    | The first stored document began Worker or compatibility-path deserialization.                   |
| `tm:deserialize-end`      | That deserialization settled through success, timeout, fallback, or parse failure.              |
| `tm:system-committed`     | Startup installed the requested local or shared document, never the temporary placeholder.      |
| `tm:map-style-ready`      | MapLibre produced its first usable remote or local blank style.                                 |
| `tm:first-system-paint`   | A render completed after the real document's representative overlay source loaded.              |
| `tm:interactive`          | The real document is committed and map interactions are attached.                               |
| `tm:service-worker-ready` | Workbox completed the essential editor-shell install. Public shares and embeds do not register. |

The public share route has no local-storage milestones and deliberately has no
service-worker milestone. The standalone embed uses its own entry point and
does not register the editor service worker.

## Anonymous field-sampling release check

Before releasing a change to field sampling, verify the editor, full share,
and embed all expose a keyboard-accessible Privacy link and that `/privacy`
works without JavaScript. Confirm the page is in the sitemap but absent from
the editor's eager import graph and service-worker precache. In a release-tagged
build, GPC and each DNT signal must prevent observer construction; local,
untagged, disabled, wrong-origin, and unsampled builds must not construct an
observer either. Exercise accepted beacon, rejected beacon, thrown beacon, and
failed keepalive paths without allowing an error to reach the page.

## Manual critical journeys

Record browser version, operating system, fixture, whether simulation was
running or paused, and any visible delay or input loss. Run the desktop rows
in current Safari and Firefox. Run the layout rows at phone, tablet, and
desktop widths.

| Area                 | Journeys                                                                                                                                                                                                                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Startup and recovery | Empty/small/RTC saved systems; corrupt active record; storage temporarily unavailable; PWA update; offline reload; failed basemap and font. Every one of these renders the full shell — map, workbench, and toolbars — and reports itself in a banner. A journey that reaches a screen with no editor on it has failed, however good its numbers. |
| Network view         | Pan, zoom, hover, select, draw, snap, freehand, erase, marquee, way/node/station/group drag, route/adopt, keyboard repeat, undo/redo                                                                                                                                                                                                              |
| Infrastructure view  | Network-view journeys plus lanes, platforms, facilities, footprints, junctions, and vehicle geometry                                                                                                                                                                                                                                              |
| Diagram view         | Load, switch in/out, select, drag, route display, undo/redo, and return to the geographic camera                                                                                                                                                                                                                                                  |
| Concurrent work      | Each manipulation with simulation running and paused; validation and autosave landing during the gesture’s deferred window                                                                                                                                                                                                                        |
| Imports              | GTFS download/processing/reconciliation; cancellation during each phase; timeout and malformed archive; OSM endpoint failover and cancellation                                                                                                                                                                                                    |
| Library              | Many documents; open, rename, duplicate, create, delete; quota full; storage unavailable; close immediately after an edit                                                                                                                                                                                                                         |
| Exports              | PNG, SVG, and JSON; preview-map pan/reset; repeated invocation; cancellation, timeout, and failed encoding                                                                                                                                                                                                                                        |
| Publishing           | Under-limit and over-limit payload; repeated Publish; optional preview failure; timeout, cancellation, and server failure                                                                                                                                                                                                                         |
| Public delivery      | Share page, embed, API error, preview response, GTFS cache, compression, and cold/warm Worker/D1/cache response                                                                                                                                                                                                                                   |
| Responsive layouts   | Phone and tablet load, tap response, tool switching, inspector, dialogs, keyboard avoidance, and orientation change                                                                                                                                                                                                                               |
| Touch input          | Every gesture in [Touch equivalents](../../product/reference/editor-interactions.md#touch-equivalents), by finger on real hardware: one-finger draw and drag, two-finger pan, pinch, long press, double tap, and the latched modifier channels                                                                                                    |
| Accessibility        | Keyboard-only critical journeys, visible focus, dialog focus return, reduced motion, and screen-reader labels during progress/cancellation                                                                                                                                                                                                        |

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
