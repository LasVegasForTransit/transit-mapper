# Measure browser performance

The browser performance suite is deliberately separate from `pnpm check`.
`pnpm check` stays deterministic, browser-free, and network-free; performance
work needs stable Google Chrome, a display, and the remote basemap.

Performance is a user-experience constraint, not permission to remove user
experience. An optimization is invalid if it passes a budget by freezing or
hiding visible feedback, disabling a capability, weakening accessibility, or
making settled output less accurate. Progressive detail must remain continuous
and converge to the same correct result after the gesture.

## Capture renderer evidence

Renderer changes carry deterministic visual evidence alongside timing data:

```bash
pnpm renderer:capture -- --phase 00-baseline
pnpm renderer:capture -- --phase 01-lod
```

The phase is a kebab-case artifact label. A complete run builds the same
private instrumented application used by the performance protocol, replaces
remote basemap styles with bundled source-free styles, and writes a browsable
contact sheet under `apps/web/artifacts/renderer/<phase>/index.html`. It
captures fixed desktop/mobile viewports, light/dark themes, all three views,
five detail cameras, fractional-zoom filmstrips, the editor/onboarding/embed/
export contexts, and dedicated Port Mason, density, scale, curve, junction,
grade, rail, service-bundle, and Diagram fixtures.

A rerun clears only that exact phase directory. Earlier phases remain beside
it so the sheet can show baseline, previous, current, and pixel-difference
images. Generated captures are ignored build artifacts until a reviewed final
set is deliberately promoted to visual-regression goldens.

Use `--skip-build` only when `apps/web/dist` is still the current instrumented
build from a successful capture or performance run. `--profile desktop|mobile`
and `--theme light|dark` produce a faster diagnostic subset; they intentionally
omit the cross-surface, fixture, and filmstrip evidence that belongs to a
complete phase boundary.

Capture before renderer behavior changes, after every renderer phase, and
after a later change to geometry, LOD thresholds, styling, labels, or layer
ordering. A timing improvement is rejected when the contact sheet shows
missing detail, popping, label instability, altered topology, reduced
contrast, or an incorrect settled frame.

## Run the fixed protocol

Install stable Google Chrome, then run:

```bash
pnpm perf
```

The command first builds and gates the production app, then builds a private
instrumented variant, starts Vite preview on an isolated loopback port, and measures the
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
- deterministic small, dense, large-published, and RTC-shaped systems. The
  RTC fixture has about 3,800 ways, 121,000 points, 3,800 stations, and 285
  patterns.

The automated fixture set does not yet include the acceptance matrix's empty
editor startup. Adding that gate requires an `empty` fixture/scenario ID, a
zero-entity generator branch, and a startup-only journey that does not require
a station target. Until those pieces land, record empty startup separately and
do not describe `pnpm perf` as covering it.

RTC scale belongs to the editor: the production share API refuses request
bodies above 1 MB. The share page and dedicated embed instead use a roughly
715 kB request fixture, large enough to exercise their real work while leaving
ordinary model-growth headroom beneath the publishing contract.
Their mocked API response negotiates precomputed gzip when Chrome accepts it,
matching the encoded-byte semantics of the transfer metric and production edge
compression without charging compression work to the browser trace. Chrome
still decodes and parses the complete JSON response.

The manually dispatched workflow also runs the 390 × 844, device-pixel-ratio 3
mobile profile:

```bash
pnpm perf -- --profile mobile
```

The historical `firstMapCanvasMs` field is marked only after the first render
whose system sources have loaded. A MapLibre canvas element existing in the DOM
does not satisfy the startup gate.

Each editor sample resolves a known fixture station from both its GeoJSON
source and painted hit-test layer, then drags it with trusted pointer input.
An isolated Network-view station release replaces only the changed promoted-ID
feature. The exact gesture preview remains visible and hit-testable until the
station source reports loaded and a later map render occurs, so the reduced
settlement work cannot introduce a snap-back or a temporarily dead station.
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
- `bundle-report.json`, whose version 3 delivery graphs separate each entry's
  eager document and static-import closure from files reached only through
  dynamic imports. The `complete` entry graph is their union and remains the
  bundle-budget authority. Separate graphs report dedicated Workers, the
  service Worker and its Workbox runtime, install-only assets, and the complete
  service-worker precache union;
- `pwa-report.json`, the deterministic build-graph/precache comparison; and
- `pwa-runtime-report.json`, proof that an installed editor reopened offline
  after Chrome's HTTP cache was cleared, populated a system overlay on its
  local blank map, and committed a real station edit.

`perf:record` writes one Chrome trace per measured run. It does not create or
replace a checked baseline. Freeze a comparison point only with the explicit
flag:

```bash
pnpm perf:record -- --freeze-baseline
# apps/web/perf/baseline.json
# apps/web/perf/baseline.json.sha256

pnpm perf:record -- --profile mobile --freeze-baseline
# apps/web/perf/baseline-mobile.json
# apps/web/perf/baseline-mobile.json.sha256
```

The freeze is write-once and validates the complete cold editor/share/embed
matrix, the fixed protocol, the 60-second window, required milestones,
settlement, and CDP request totals before publication. The checksum companion
makes an in-place edit fail closed. To replace a baseline, delete both files in
an explicit reviewed change, run the same base and candidate artifacts on the
same runner, and freeze the chosen report again. Review the complete baseline
diff as measurement evidence; never replace it merely to make a regression
disappear.

`sourceUploadCount` means application-issued GeoJSON source mutations during
the measured action. Both complete `setData` replacements and differential
`updateData` calls count once. It is an operation counter, not a byte estimate;
deterministic projection tests separately prove how many features a targeted
mutation derives.

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
own parse and responsiveness costs. The compressed absolute limits are round
delivery guardrails, not snapshots of the current build plus a few kilobytes,
so ordinary feature work does not require ritual budget churn.

The production build keeps MapLibre and React in stable cache chunks so an
editor release does not make a returning browser download those runtimes
again. MapLibre 4 is itself one prebundled module, so an output named
`map-engine` whose source map contains only MapLibre modules has a narrow
810 kB raw limit. Every other JavaScript output, including service-worker and
nested outputs, is limited to 500 kB. These are enforced in
`bundle-report.json`; Vite's generic warning threshold is not the only guard.
Every delivery graph contains sorted file records with raw, gzip, and Brotli
sizes plus a SHA-256 content digest. These records make an N-1 comparison able
to distinguish added, removed, and changed files without counting a file twice
when, for example, it belongs to both the editor graph and the independent
precache union. The comparison also reports every graph separately and records
membership transitions, so an unchanged file moving from lazy to eager cannot
disappear inside a zero-byte overall delta. Production reporting requires the
seven known dedicated Worker entry identities; missing, additional, or
multiply emitted boundaries fail the build instead of silently shrinking or
expanding the Worker graph.

Missing Chrome produces an `unavailable` report and a non-zero exit. The
harness never writes placeholder timings.

## Read anonymous field evidence

The fixed harness remains the release gate. Production field samples answer a
different question: how released builds behave on the coarse mix of devices,
networks, cache states, and browser capabilities that people actually use.
Only a release-tagged production build on the configured live origin is
eligible. Sampling is 5% for the first 24 hours after the build, then 1%. One
random decision is kept as `0` or `1` in `sessionStorage` under the public
build id; blocked storage falls back to module memory. No random value or
visitor id is retained or sent.

Global Privacy Control and Do Not Track are checked before observers or
sampling are installed and again by the Worker. A selected page sends at most
one allowlisted, self-counted body on its first hidden or pagehide boundary.
The body is refused above 8 KiB. See the public
[Privacy policy](https://map.lasvegasfortransit.org/privacy) for the fields,
purpose, retention, processor, and never-collected list.

The browser client uses native `PerformanceObserver`, User Timing, Navigation
Timing, and Resource Timing rather than adding a vitals dependency. LCP keeps
the last reported candidate. CLS uses the standard maximum session window
(less than one second between shifts and at most five seconds total) and
excludes shifts after recent input. INP groups Event Timing durations by
interaction id and uses the p98 rank approximation, but the observer's 40 ms
threshold means a page with only faster interactions may report INP as null.
Unsupported or unavailable APIs remain null. Field Resource Timing cannot
prove a network quiet window, so `networkIdleMs` is also null; the controlled
harness owns that measurement. Opaque cross-origin byte categories are null,
never guessed.
Page Resource Timing cannot observe service-worker install and precache
requests, so `serviceWorkerBytes` remains null rather than reporting a
misleading zero or partial script count.

The synchronous entry code contains only the privacy, live-release/origin, and
stable-sampling gates. It dynamically imports the observer and payload client
only for a selected visit. First service-worker install precaches only the
static editor closure, so this conditional client remains outside both an
unsampled navigation and its install download. If selected or later fetched,
the ordinary adaptive CacheFirst route retains it for subsequent use.

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
Both snapshots come from the same build after the tested edit and export paths
have been warmed. A feature that has a higher but stable resource baseline
therefore passes; the gate targets retained growth across repeated lifecycles,
not a fixed historical count.
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

The service worker initially keeps the editor HTML, eager chunks and CSS, local
font, favicon, and install metadata. Lazy tools, dedicated Workers, telemetry,
and install artwork are cached when used. A returning or installed session may
add at most 64 KiB of declared uncompressed payload during one idle period,
after Save-Data, 2G-hint, and quota checks. The exposed readiness values mean:
`essential` for a reopenable shell, `adaptive-pending` while optional assets
remain, `complete` when the current first-party optional graph is present, and
`deferred` when policy or a failure prevented background work. None includes
the third-party basemap.

The browser check writes a fixture once through
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
Profile or theme subsets are diagnostic captures. They are written to a
`diagnostic-<phase>-<profile>-<theme>` sibling so they cannot replace the
complete numbered phase used by contact-sheet history.
