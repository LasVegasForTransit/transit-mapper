# Measure browser performance

The browser performance suite is deliberately separate from `pnpm check`.
`pnpm check` stays deterministic, browser-free, and network-free; performance
work needs stable Google Chrome, a display, and the remote basemap.

Performance is a user-experience constraint, not permission to remove user
experience. An optimization is invalid if it passes a budget by freezing or
hiding visible feedback, disabling a capability, weakening accessibility, or
making settled output less accurate. Progressive detail must remain continuous
and converge to the same correct result after the gesture.

## Run the fixed protocol

Install stable Google Chrome, then run:

```bash
pnpm perf
```

The command first builds and gates the production app, then builds a private
instrumented variant, starts Vite preview on `127.0.0.1:4173`, and measures the
complete desktop matrix. Bundle and PWA reports always describe the public
production graph; the measurement-only harness is not counted as shipped
payload. To diagnose one surface without replacing a baseline:

```bash
pnpm perf -- --scenario rtc
pnpm perf -- --scenario share
pnpm perf -- --scenario embed
```

`--scenario` cannot be combined with `perf:record`, because a partial report
must never replace the complete baseline.

A pull request runs one candidate-only RTC smoke:

```bash
pnpm perf -- --smoke --scenario rtc
```

The smoke still builds the production graph and completes one cold and warm
agency-scale journey, including camera movement, station drag, line draw, and
durable persistence. It fails when the build, Chrome, or any required journey
proof fails. One sample is not enough evidence for a timing verdict, so smoke
mode does not enforce numeric timing or regression budgets. It also does not
build or measure the base revision. Use the full fixed protocol above when a
change needs statistical performance evidence.

The protocol is fixed in `apps/web/src/perf/scenarios.ts`:

- stable, headed Google Chrome;
- four-times CPU slowdown and Fast 4G (4 Mbps down, 3 Mbps up, 20 ms
  latency);
- 1440 × 900 at device-pixel ratio 1 for desktop;
- a cache-cleared cold navigation followed by an HTTP-cache warm reload;
- one discarded warm-up and five measured runs; and
- deterministic small, dense, and RTC-shaped systems. The RTC fixture has
  about 3,800 ways, 121,000 points, 3,800 stations, and 285 patterns.

The automated fixture set does not yet include the acceptance matrix's empty
editor startup. Adding that gate requires an `empty` fixture/scenario ID, a
zero-entity generator branch, and a startup-only journey that does not require
a station target. Until those pieces land, record empty startup separately and
do not describe `pnpm perf` as covering it.

The share page and the dedicated embed entry both use the RTC-shaped fixture.
The manually dispatched workflow also runs the 390 × 844,
device-pixel-ratio 3 mobile profile:

```bash
pnpm perf -- --profile mobile
```

The historical `firstMapCanvasMs` field is marked only after the first render
whose system sources have loaded. A MapLibre canvas element existing in the DOM
does not satisfy the startup gate.

Each editor sample resolves a known fixture station from both its GeoJSON
source and painted hit-test layer, then drags it with trusted pointer input.
It performs a deterministic right-button camera drag and a separate line draw,
then allows validation, simulation, and the shared autosave debounce to run.
The driver requires the station coordinate and document revision to change,
the camera to move, and the line draw to advance both the system revision and
model way count before naming those actions in a report. Cold editor journeys
prove the simulation is running; warm journeys press `K`, prove the play label
is visible, and measure the same work while paused. Share and embed samples
perform the camera drag without editing and record simulation as not
applicable.
Chrome's Event Timing API supplies interaction-to-next-paint values; MapLibre
`render` events supply painted-frame intervals only during the continuous
entity and camera drags. Discrete line clicks retain Event Timing and
long-task coverage, but their intentional 24 ms gaps are not mislabeled as
dropped continuous-animation frames. The separate scripted pan remains in
diagnostics for attribution, not as the hard-gate sample. The embed, which
intentionally has no editor harness, labels its rAF proxy in the report rather
than pretending those are MapLibre render events.

## Read the result

Normal output is under `apps/web/artifacts/performance/current/<profile>/`.
It includes:

- `report.json`, with every raw sample, min/median/p95/max, variance, standard
  deviation, coefficient of variation, cache hits/misses, source uploads, and
  full/gesture projection phase counters;
- `bundle-report.json`, covering each entry's complete static and dynamic
  import graph in raw, gzip, and Brotli bytes plus every emitted JavaScript
  chunk's raw size and budget;
- `pwa-report.json`, the deterministic build-graph/precache comparison; and
- `pwa-runtime-report.json`, proof that an installed editor reopened offline
  after Chrome's HTTP cache was cleared, populated a system overlay on its
  local blank map, and committed a real station edit.

`perf:record` also writes one Chrome trace per measured run and refreshes the
checked baseline at a stable path:

```bash
pnpm perf:record
# apps/web/perf/baseline.json

pnpm perf:record -- --profile mobile
# apps/web/perf/baseline-mobile.json
```

Review baseline diffs as measurement evidence. Do not update one simply to
make a regression disappear.

Absolute startup gates use the five-run p95. Direct-manipulation gates combine
the raw samples across all five runs, so one bad run cannot hide behind a
median:

- interaction-to-next-paint p95 is at most 50 ms;
- painted-frame p95 is at most 16.7 ms;
- fewer than 1% of painted frames may exceed 33.3 ms;
- no unexpected long task may exceed 50 ms;
- LCP is at most 2.5 seconds on editor, share, and embed surfaces; and
- CLS, transfer, startup, and bundle limits are the absolute values beside
  each scenario.

A value exactly at the stated maximum passes except the dropped-frame ratio:
“fewer than 1%” means exactly 1% fails. A checked or base-revision median more
than 10% worse also fails. Duration regressions are normalized by the report's
deterministic four-times-throttled CPU calibration; absolute user-facing gates
are never normalized. Calibration also records 60 consecutive rAF intervals,
their median, and the inferred display refresh rate so the headed environment
is auditable. Display cadence is diagnostic only and never changes a budget or
normalizes a regression. Gzip and Brotli delivery bytes get the same 10%
regression check during a full audit. Raw graph size remains in the report for
diagnosis, but it is not an absolute or regression gate; browser measurements
own parse and responsiveness costs.

The production build keeps MapLibre and React in stable cache chunks so an
editor release does not make a returning browser download those runtimes
again. MapLibre 4 is itself one prebundled module, so an output named
`map-engine` whose source map contains only MapLibre modules has a narrow
810 kB raw limit. Every other JavaScript output, including service-worker and
nested outputs, is limited to 500 kB. These are enforced in
`bundle-report.json`; Vite's generic warning threshold is not the only guard.

Missing Chrome produces an `unavailable` report and a non-zero exit. The
harness never writes placeholder timings.

## Large-system persistence boundary

The production save path serializes in a dedicated Worker, then atomically
writes the complete document and its lightweight library row to IndexedDB.
`localStorage` remains a backward-compatible reader and a best-effort
synchronous close-time fallback for documents small enough to fit its quota.
Startup treats an unavailable IndexedDB library as unavailable; it never
replaces it with an empty document.

Every sample also runs a diagnostic boundary probe on the real preview origin
before the app loads. It reports JSON parse, main-thread stringify, and a real
`localStorage` write as separate compatibility phases. This is not presented
as end-to-end autosave latency. Editor fixtures are seeded into real IndexedDB,
and every trusted draw must pass through the production serialization Worker
and atomic IndexedDB transaction. The report separately records draw-commit to
durable-save time, Worker serialization time, and IndexedDB write time, then
reads the stored document back and verifies the committed revision and way
count. The RTC fixture is about 5.9 MB of UTF-8 JSON, already past the report's
conservative 4,000,000-byte `localStorage` boundary.

The report flags the off-thread boundary when parse or stringify exceeds
50 ms, and the IndexedDB boundary when a document exceeds 4,000,000 bytes or
the real compatibility write reports quota exhaustion or unavailability.

## Run the leak soak

The manually dispatched workflow also runs:

```bash
pnpm perf:soak
```

It warms one proven station edit and one real PNG export before taking the
initial snapshot. Measured cycles repeatedly perform balanced pans, proven
station edit/undo cycles, and actual non-empty PNG and SVG downloads through
the lazy export dialog and its second MapLibre map for ten minutes. A soak
with no measured download of either format fails. It forces collection before
the initial and final snapshots and fails if JS heap, DOM nodes, listeners,
dedicated workers, or WebGL contexts grow by more than 10%. WebGL is counted as
contexts created minus observed `webglcontextlost` events; the report names
that source because the browser does not expose a general live-context census.
Its evidence is `soak-report.json`. When the listener count grows, the report
also groups the retained initial and final listeners by queried root, actual
backend node when Chrome supplies it, event type, capture/passive/once flags,
and handler-code location, then lists signed count deltas. Script URLs are
preferred over per-session script IDs. The location identifies the handler
code, not necessarily the `addEventListener` call. This diagnostic inspects
`window`, `document`, and the main map canvas at CDP depth 1; it is not an
all-page listener census. The unchanged scalar count remains the hard gate.

A shorter `--soak-duration <milliseconds>` is available only to smoke-test or
diagnose the mechanism. The manual Performance workflow can run only that
remote soak and accept the same duration override, which keeps headed Chrome
inside Xvfb instead of taking over a local desktop. A shorter diagnostic result
cannot satisfy the leak gate; omit the override for ten-minute acceptance
evidence. The baseline warms both PNG and SVG export paths before its first
forced-GC snapshot so one-time initialization is not mistaken for retained
growth.

## What “offline” means

The service worker keeps the editor HTML, eager and lazy editor chunks, local
icons, and install metadata. The browser check writes a fixture once through
the real legacy `localStorage` keys, loads the editor, and proves the
application migrated both the complete document and library row into
IndexedDB and removed the legacy document. It then installs the worker, clears
the HTTP cache, disconnects the context, reloads without reinjecting any
fixture, and verifies the IndexedDB document's editor opens. Finally it waits
for a populated system source and layer and moves a station through the real
pointer interaction path. Embed-only assets are excluded, and `/api`, `/s`,
and `/e` navigations never fall back to the editor shell.

The basemap style and tiles come from OpenFreeMap, and the Outfit font is
hosted remotely. If the initial style errors or does not load within 1.5
seconds, the editor switches to a bundled blank style. Geographic system
geometry and editing affordances remain usable; remote basemap detail and
text-symbol layers are unavailable until a connected reload.
