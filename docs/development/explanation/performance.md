# Performance

This page is the entry point for performance work. It states what the
application protects, which numbers gate a change, what each module owns, and
what the measurement suite should look like versus what it looks like today.
The browser protocol lives in
[Measure browser performance](../how-to/measure-performance.md) and the
release checklist in the
[performance acceptance matrix](../reference/performance-acceptance-matrix.md).

## Terms

| Term        | Meaning                                                                                      |
| ----------- | -------------------------------------------------------------------------------------------- |
| LCP         | Largest Contentful Paint: when the largest element of the first screen finished painting.    |
| INP         | Interaction to Next Paint: from a click, tap, or key press to the paint that answers it.     |
| CLS         | Cumulative Layout Shift: how far visible content moved after it had already painted.         |
| p95, p99    | The value 95% or 99% of samples fall below. A p99 of 40 ms means 1 sample in 100 was worse.  |
| 16.7 ms     | One frame at 60 Hz. A frame that takes longer misses its display refresh.                    |
| LOD         | Level of detail: the renderer draws simpler geometry when a corridor is narrow on screen.    |
| Culling     | Skipping geometry outside the camera. Candidate features are considered; visible ones drawn. |
| RTC fixture | The largest deterministic test system: about 3,800 ways, 121,000 points, and 285 patterns.   |

## Classes of work

Whether a user notices a delay depends on what the application is doing when
the delay happens, not on which surface it happens on. There are four cases,
and every budget in the suite protects one of them.

### Continuous gestures

Station drag, camera drag, and freehand draw update on every frame while the
pointer is down. The measurement is the frame interval during the gesture,
and the gate belongs on the slowest frames rather than the median. One 40 ms
frame mid-drag puts the geometry visibly behind the cursor; the same 40 ms
with the pointer at rest is invisible. The current gates are a 16.7 ms p95
and fewer than 1% of frames over 33.3 ms. At RTC scale the failures sit
above p95, so the tail gate should move to p99.

### Discrete commits

Drag release, line close, undo, and delete produce one result and one
acknowledgement. Below 100 ms a user reads the response as instantaneous, and
up to about 1 s they stay in the task. The 50 ms INP p95 covers that latency.
It does not cover the second failure, where a committed edit appears and then
reverts once deferred work settles. The station-release path prevents that by
keeping the gesture preview visible and hit-testable until the source reports
loaded. That invariant is worth as much as the timing number.

### Deferred work

Validation, autosave, simulation, GTFS import, export encoding, and publish
run without a user waiting on the result. Their duration is not user-facing.
Two other quantities are: the longest main-thread block they cause, gated at
50 ms, and the delay between a cancel request and the next honored input. A
10 s import that never blocks input beats a 2 s import that blocks for
200 ms.

### Load

A share or embed visitor loads the page once and leaves if it is slow, so
LCP at 2.5 s gates those surfaces. An editor user has committed to a session,
and LCP there reports when a canvas painted, not when the document became
editable. The honest editor gate is the `tm:interactive` milestone, and time
to a first edit that survives reload is a better one. LCP and CLS stay on
the editor as diagnostics.

## Fidelity counters

Any timing number improves when the renderer draws less, so a timing number
alone cannot separate a speedup from a fidelity loss. The report prints
`projectionDurationMs` beside candidate and visible feature counts, generated
vertices, and cache hits, which lets a reviewer tell the two apart. The same
pairing applies everywhere: startup time beside the committed document
revision, heap growth beside proof that autosave landed, bundle transfer
beside the eager and lazy split in `bundle-report.json`. A change whose
number improved while its paired counter fell is a regression.

## Module responsibilities

### `packages/core`

Core holds the domain model, migrations, and the simulation, all pure and
runnable in both runtimes. Its performance obligation is that every mechanism
is testable without a browser: deterministic operation-count tests protect
projection derivation, serialization slicing, and migration cost. When new
logic can only be checked by clicking through the app, it moves down here.

### `packages/renderer`

The renderer owns the cost of turning a document into MapLibre sources:
feature projection, cooperative scheduling in four-entity units, LOD chosen
from displayed corridor width, and source banks that upload differentially.
It is the module where most frame-interval and projection budgets are won or
lost. Its evidence is the projection counters in `report.json` and the fixed
116-image capture corpus, which exists so a timing win cannot silently drop
detail.

### `packages/map` and `packages/workspace`

Map owns the MapLibre lifecycle and camera; workspace keeps one `MapSurface`
mounted while host chrome changes. Their shared obligation is that pointer
movement and view switching never rebuild the map or the RTC-sized document.
The onboarding phase fails if a dialog creates a second canvas or WebGL
context.

### `apps/web`

The editor owns startup, persistence, and delivery. Startup publishes the
`tm:*` milestones and must render the shell before any load resolves. Saves
serialize cooperatively and commit atomically to IndexedDB; the report
separates draw-commit, serialization, and write time. The build keeps
MapLibre, React, and the renderer in stable cache chunks, with an 810 kB raw
limit on the MapLibre chunk and 500 kB on every other output.
`apps/web/src/perf` holds the budgets; `apps/web/scripts/perf` holds the
harness that enforces them.

### `apps/worker`

The Worker serves shares, embeds, and the API. Its obligations are byte
ceilings rather than frame times: the share API refuses bodies over 1 MB,
responses negotiate compression at the edge, and performance-sample
ingestion accepts 8 KiB with seven-day raw retention. Share and embed
scenarios measure its output on the same Chrome protocol as the editor.

### Service worker

The PWA layer precaches the editor shell, its three workers, and lazy editor
chunks. Its gate is behavioral: an installed editor must reopen offline,
populate a system overlay on the local blank style, and commit a real edit.
`pwa-report.json` compares the precache graph against the build graph so the
two cannot drift.

## Suite structure

### Current shape

The measurement infrastructure is about 17,000 lines: 5,500 in
`apps/web/src/perf`, 8,600 across 44 files in `apps/web/scripts/perf`, and
3,100 in `apps/web/scripts/renderer-capture`, plus 56 test files. Of the 806
commits since July 2026, 100 touched the suite. A measurement layer
consuming 12% of commit volume is maintenance the application is not
getting.

Three findings say the structure is wrong, not just large:

- `apps/web/perf/baseline.json` contains no scenario or sample data. The
  regression half of the interactive gates — the 10% median rule, variance,
  coefficient of variation, CPU calibration — currently compares against
  nothing. The absolute budgets carry the entire gate.
- The tree carries tooling for exactly one dead commit:
  `freeze-497a549-baseline.ts`, `historic-baseline.ts`, and
  `legacy-first-session-marks.ts` exist to measure build `497a549`, and
  `perf:freeze-497a549` is wired into `package.json` as if it were routine.
- `frameStats.ts` and `report.ts` each implement percentile with different
  rounding, and the suite has two frame-summary shapes. Two implementations
  of one statistic eventually disagree in a report nobody can explain.

### Target shape

Three layers, matching how often each can afford to run.

| Layer         | Runs                          | Contents                                                                         |
| ------------- | ----------------------------- | -------------------------------------------------------------------------------- |
| Deterministic | `pnpm check`                  | Operation counts, projection counters, chunk policy, precache-graph comparison   |
| Pull request  | `pnpm perf -- --scenario rtc` | Absolute budgets only: INP, frame tail, long tasks, LCP, durable-save latency    |
| Dispatched    | Performance workflow          | Full desktop and mobile matrix, ten-minute soak, offline proof, renderer capture |

The pull-request layer gates on absolute values alone. The regression
machinery returns only when a maintainer commits to recording and reviewing
baselines; until then it is dead weight that every suite change must keep
compiling.

### Removals

- The `497a549` archaeology: both scripts, the legacy marks module, the
  `perf:freeze-497a549` script entry, and their tests. Historical evidence
  belongs in an artifact archive, not in the build graph.
- The interactive-regression apparatus, until a real baseline exists. The
  bundle baseline stays; it has data and it works.

### Rewrites

- One statistics module: a single percentile and summary implementation
  consumed by the frame meter, the gesture gate, and the report.
- The capture harness keeps its settlement-boundary waiting and fixtures,
  which are domain knowledge, and sheds the hand-rolled manifest, hash, and
  provenance bookkeeping in favor of a golden-file comparison.
- `measure-performance.md` shrinks to a protocol reference once this page
  owns the reasoning. A 400-line document that must caveat its own coverage
  is recording process debt as prose.

## Open measurements

The suite measures one fixture, so it detects regressions and cannot state a
ceiling. Users hit the ceiling: a system grows past some threshold during
ordinary work and the editor degrades without warning. Measuring the
continuous, discrete, and deferred classes at 500, 4,000, and 20,000 ways
would name which class fails first and at what size. Empty-editor startup is
also still a manual row; the automated fixture union has no zero-entity
scenario.

## Evidence commands

| Command                                 | Proof                                                          |
| --------------------------------------- | -------------------------------------------------------------- |
| `pnpm check`                            | Deterministic mechanism tests, budgets as data, precache graph |
| `pnpm perf -- --scenario rtc`           | Editor responsiveness gates at RTC scale                       |
| `pnpm perf`                             | The complete desktop matrix plus share, embed, and PWA phases  |
| `pnpm perf:soak`                        | Ten-minute leak gate on heap, DOM, listeners, workers, WebGL   |
| `pnpm renderer:capture -- --phase <id>` | Visual fidelity evidence for renderer changes                  |
