# Measure browser performance

The browser performance suite is deliberately separate from `pnpm check`.
`pnpm check` stays deterministic, browser-free, and network-free; performance
work needs stable Google Chrome, a display, and the remote basemap.

## Run the fixed protocol

Install stable Google Chrome, then run:

```bash
pnpm perf
```

The command builds the production app, starts Vite preview on
`127.0.0.1:4173`, and measures the complete desktop matrix. To diagnose one
surface without replacing a baseline:

```bash
pnpm perf -- --scenario rtc
pnpm perf -- --scenario share
pnpm perf -- --scenario embed
```

`--scenario` cannot be combined with `perf:record`, because a partial report
must never replace the complete baseline.

The protocol is fixed in `apps/web/src/perf/scenarios.ts`:

- stable, headed Google Chrome;
- four-times CPU slowdown and Fast 4G (4 Mbps down, 3 Mbps up, 20 ms
  latency);
- 1440 × 900 at device-pixel ratio 1 for desktop;
- a cache-cleared cold navigation followed by an HTTP-cache warm reload;
- one discarded warm-up and five measured runs; and
- deterministic small, dense, and RTC-shaped systems. The RTC fixture has
  about 3,800 ways, 121,000 points, 3,800 stations, and 285 patterns.

The share page and the dedicated embed entry both use the RTC-shaped fixture.
The nightly workflow also runs the 390 × 844, device-pixel-ratio 3 mobile
profile:

```bash
pnpm perf -- --profile mobile
```

Each editor sample drags a known fixture station with trusted pointer input,
performs a camera drag and a real line draw, then allows validation,
simulation, and the shared autosave debounce to run. A source-upload assertion
makes the station drag fail as unavailable if it did not commit an entity
change. Share and embed samples perform the camera drag without editing.
Chrome's Event Timing API supplies interaction-to-next-paint values; MapLibre
`render` events supply painted-frame intervals on the editor and share page.
The embed, which intentionally has no editor harness, labels its rAF proxy in
the report rather than pretending those are MapLibre render events.

## Read the result

Normal output is under `apps/web/artifacts/performance/current/<profile>/`.
It includes:

- `report.json`, with every raw sample, min/median/p95/max, variance, standard
  deviation, coefficient of variation, cache hits/misses, source uploads, and
  full/gesture projection phase counters;
- `bundle-report.json`, covering each entry's complete static and dynamic
  import graph in raw, gzip, and Brotli bytes;
- `pwa-report.json`, the deterministic build-graph/precache comparison; and
- `pwa-runtime-report.json`, proof that an installed editor reopened offline
  after Chrome's HTTP cache was cleared.

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
are never normalized. Bundle bytes get the same 10% regression check.

Missing Chrome produces an `unavailable` report and a non-zero exit. The
harness never writes placeholder timings.

## Large-system persistence boundary

Every sample measures JSON parse, JSON serialization, and a real localStorage
write on the preview origin **before** the fixture-only Storage shim is
installed. The RTC fixture is currently about 5.9 MB of UTF-8 JSON, already
past the report's conservative 4,000,000-byte localStorage boundary.

The report recommends:

- off-main-thread serialization when parse or stringify exceeds 50 ms; and
- IndexedDB when a document exceeds 4,000,000 bytes or the real localStorage
  write reports quota exhaustion/unavailability.

These are explicit migration conditions, not claims that the current
localStorage implementation can safely retain an agency-scale import.

## Run the leak soak

The nightly workflow also runs:

```bash
pnpm perf:soak
```

It repeatedly performs balanced pans, station edit/undo cycles, and
open/close cycles of the lazy export dialog and its second MapLibre map for
ten minutes. It forces collection before the initial and final snapshots and
fails if JS heap, DOM nodes, listeners, dedicated workers, or WebGL contexts
grow by more than 10%. WebGL is counted as contexts created minus observed
`webglcontextlost` events; the report names that source because the browser
does not expose a general live-context census. Its evidence is
`soak-report.json`. A shorter `--soak-duration <milliseconds>` is available
only to smoke-test the mechanism; CI always uses the ten-minute default.

## What “offline” means

The service worker keeps the editor HTML, eager and lazy editor chunks, local
icons, and install metadata. The browser check installs that worker, clears
the HTTP cache, disconnects the context, reloads, and verifies the saved
document's editor opens. Embed-only assets are excluded, and `/api`, `/s`, and
`/e` navigations never fall back to the editor shell.

The basemap style and tiles come from OpenFreeMap, and the Outfit font is
hosted remotely. With no network, the editor shell and stored document open,
but the basemap, system overlays that wait for that style, and hosted font may
be unavailable or fall back. The offline assertion does not claim otherwise.
