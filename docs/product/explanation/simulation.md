# The simulation

The vehicles moving on the map are not decoration. They run on a simulated
clock, at the headways and speeds the system actually specifies, and you can
pause that clock, speed it up, or ask what the network looks like at a
particular time of day.

This page explains how that works — the design choice underneath it, where the
state lives, and what the model deliberately cannot do.

## The simulator has no state

There are two ways to build a simulation like this.

A **stepping** simulator keeps a list of vehicle objects and moves them forward
a little on every tick: `position += speed × dt`, with a state machine per
vehicle. This is what "simulator" usually implies.

A **resolved** simulator keeps no vehicles at all. It answers one question —
_given a simulated instant, where is everything?_ — as a pure function.
Vehicles aren't objects that survive between frames; they are the result of
evaluating the schedule at that instant.

TransitMapper's is resolved. A vehicle's position is a function of the time,
the service's schedule, and the geometry of its path, with no dependence on
what happened before. Consequences, all of which you can see in the editor:

- **Nothing drifts.** Watching at 4× and watching in realtime agree exactly
  about where a train is at 17:30.
- **Pausing freezes rather than hides.** The clock stops advancing; the same
  instant keeps resolving to the same positions.
- **Jumping is free.** There is no state to fast-forward through, so moving the
  clock to 03:00 costs the same as advancing one frame.
- **Editing isn't a simulation event.** Reshape a way and the next frame simply
  resolves against the new geometry. Nothing needs restarting.
- **It is testable without a browser.** The whole simulator is reachable from
  `pnpm verify` — no animation loop, no map, no DOM.

The cost is real and worth stating: **a resolved simulator cannot model
anything path-dependent.** Bunching, cascading delay, crowding, a vehicle held
up behind another — all of those are consequences of history, and this design
has none. That suits what the tool is for today (sketching and comparing
service levels) and it is where the design would have to change to support
ridership modeling later.

## What a run is

The simulation adds no new stored records. It derives a small hierarchy from
data a saved system already holds:

|           |         |                                                                                                          |
| --------- | ------- | -------------------------------------------------------------------------------------------------------- |
| `Service` | stored  | identity, mode, color, and its schedule                                                                  |
| `Pattern` | stored  | one path; a branch is a second pattern on the same service                                               |
| Plan      | derived | for a given headway: how many vehicles the pattern needs, the cycle they share, and the terminal layover |
| Run       | derived | vehicle _i_ of that plan                                                                                 |

A run has no id and no memory. "Vehicle 3 of the main pattern" is a coordinate,
not an object — two consecutive frames are unrelated calculations that happen
to agree.

## Why "every 10 minutes" is exactly true

Set a line's headway to 10 minutes and its stops are served every 10 minutes —
not approximately, exactly. That comes from building the cycle **from** the
headway rather than the other way round, which is also how an agency sizes a
line:

```
fleet   = ⌈(round trip + minimum layover) ÷ headway⌉
cycle   = fleet × headway          ← a whole number of headways
layover = (cycle − round trip) ÷ 2 ← the slack, spent at each terminal
run i departs i headways after run 0
```

Because the cycle is an exact multiple of the headway, run _i+1_ is always one
headway behind run _i_ — including across the wrap from the last run back to
the first, which is the seam that spacing vehicles evenly around a loop gets
wrong.

The leftover time isn't a fudge factor. It's recovery time: a vehicle sitting
at the end of the line before starting back, which is what actually happens.
Every line gets at least two minutes of it, and longer lines get more.

Some consequences worth expecting:

- **Adding stations grows the fleet.** More stops means a longer round trip,
  which means more vehicles to hold the same headway.
- **A headway longer than the round trip is fine.** One vehicle, waiting a
  long time at the terminal — an hourly service on a 25-minute loop.
- **A service with no headway set runs a single vehicle.** That is every
  GTFS-imported route today, since import brings in no timing.

The map draws at most twelve vehicles per pattern. That is a **rendering** cap,
not a modeling one: the plan keeps its true fleet and headway and only the
first twelve are drawn, so very frequent service on a long line shows gaps
rather than wrong spacing. Clamping the fleet itself would shorten the cycle
below the round trip, which no vehicle could run.

## The clock

One number — milliseconds since Monday 00:00 — is the simulation's entire
mutable state. Everything else on screen is derived from it.

It advances by real elapsed time multiplied by the current speed:

| Speed        | Simulated seconds per real second | A full day takes |
| ------------ | --------------------------------- | ---------------- |
| Realtime     | 1                                 | 24 hours         |
| 1× (default) | 60                                | 24 minutes       |
| 2×           | 120                               | 12 minutes       |
| 4×           | 240                               | 6 minutes        |

At the default, one real second is one simulated minute. A fresh session starts
at Monday 08:00 — mid-morning on purpose, since a new line defaults to a
06:00–23:00 span and starting at midnight would open onto an empty map.

Two deliberate behaviors:

- The clock only advances while the tab is being watched. `requestAnimationFrame`
  stops when a tab is hidden, and the tick clamps how much time a single frame
  may contribute, so returning to a backgrounded tab doesn't silently skip
  most of a simulated day.
- If the reader's system asks for reduced motion, the simulation starts
  paused. It still exists and the play button still works; it just doesn't
  start moving on its own.

Day names and times of day come from `Intl`, so the clock reads the way the
reader writes times — 24-hour or 12-hour, in their own language.

## What's running right now

A line only runs when its schedule says it does. At 03:00 a route with a
06:00–23:00 span shows no vehicles, because at 03:00 it isn't running — which
is what a span of service means.

The rules, in the order they apply:

1. A detailed `schedule` supersedes the flat fields. The first period whose day
   scope and span both cover the current simulated time wins, and its headway
   is what the line runs. An hour no period covers is an hour with no service.
2. Otherwise `frequencyMinutes`, bounded by `spanStart`/`spanEnd`.
3. A service with nothing set at all runs all day at no stated frequency — one
   vehicle. That is every GTFS-imported route, since import brings in no
   timing, and it is deliberately unchanged.

The simulated week is Monday-to-Sunday, which is the shortest cycle that can
express the weekday/weekend split `ScheduleDayScope` models. Nothing here
models dates, months, or holidays.

### Pinning a scenario

Following the clock answers "what does the network look like now". The other
question — "what does peak look like next to midday" — shouldn't require
waiting for the right hour. So a schedule period can be **pinned**: every line
then runs that period's configuration whatever the clock says, spans and day
scopes included.

The scenarios on offer are the period names found across the system's own
services, the way the layer filters come from the catalogs. A system whose
periods are "Rush" and "Quiet" offers exactly those, and one that has never
had a schedule edited offers none — the control doesn't appear at all.

A line with no period by the pinned name doesn't run in that scenario, which
is the honest answer for a weekday-only express under "Weekend". A line with
no detailed schedule runs its flat headway in every scenario.

The clock keeps ticking while a scenario is pinned — vehicles still need a
time base to move against — it just isn't deciding service levels any more,
and the readout dims to say so.

Two practical notes. The clock starts at Monday 08:00 so a fresh map isn't
empty. And a service that isn't running is skipped before its geometry is
resolved, so a system half-asleep at 23:30 does roughly half the work.

## Where the state lives

Three kinds, kept apart on purpose.

|              | Examples                                                              | Where                                     | Changes             |
| ------------ | --------------------------------------------------------------------- | ----------------------------------------- | ------------------- |
| **Document** | `frequencyMinutes`, `spanStart`/`spanEnd`, `schedule`, `dwellSeconds` | the editor store, inside `system`         | when the user edits |
| **Settings** | speed, paused                                                         | `ui/SimProvider.tsx` React context        | on a click          |
| **Live**     | the clock                                                             | a `SimClock` instance (`sim/simClock.ts`) | 30 times a second   |

The split matters. A value that ticks 30 times a second cannot live in the
editor store: writing it into the immutable `system` would mint a new system
reference every frame, and with it a full feature rebuild, every mounted
selector, and an autosave. Camera position taught this project that lesson
once (see `camera/liveCamera.ts`), and a clock ticks whether or not anyone is
dragging. It can't live in React context either, for the same reason at a
different layer — it would re-render every consumer thirty times a second.

So the clock is a plain object, created once by `SimProvider` and **handed** to
whoever needs it: the animation loop gets it by injection, exactly as the
editor store does. It isn't a module-level singleton, so tests can make one,
and nothing can reach it without being given it. The single component that
displays the time subscribes to the instance directly and throttles itself to
about four updates a second.

## Where the code is

|                                      |                                                                                                           |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `packages/core/src/sim/clock.ts`     | the speed ladder, time-of-day and weekday math, span math. Pure.                                          |
| `packages/core/src/sim/fleet.ts`     | fleet size, cycle time, layover, and where run _i_ is. Pure.                                              |
| `packages/core/src/sim/timetable.ts` | travel and dwell along one pattern. Pure.                                                                 |
| `apps/web/src/sim/simClock.ts`       | the `SimClock` instance: the mutable number and its subscribers.                                          |
| `apps/web/src/sim/vehicles.ts`       | the 30 Hz animation host — advances the clock, asks core where everything is, pushes GeoJSON to MapLibre. |
| `apps/web/src/sim/devHandle.ts`      | `window.__sim`, a development-only handle for driving the clock by hand.                                  |
| `apps/web/src/ui/SimProvider.tsx`    | speed and paused state, and ownership of the clock instance.                                              |
| `apps/web/src/ui/SimControls.tsx`    | the transport controls, beside the view switch.                                                           |

The line between the last two groups is the one that matters: `packages/core`
decides _what the answer is_ and the app decides _when to ask_. That is why the
simulator can be tested without a browser.

## Driving the clock during development

In a development build, `window.__sim` drives the clock directly — useful
because the interesting questions are about specific times, and because a
headless browser parks `requestAnimationFrame` so the clock never advances on
its own.

```js
__sim.setTime('17:30'); // jump to a time of day, keeping the weekday
__sim.setTime('09:00', 5); // …or move to a specific day (0 = Monday)
__sim.step(10); // move 10 simulated minutes, even while paused
__sim.state(); // { simMs, clock, speedId, paused }
```

It sits alongside the performance harness (`window.__perf`, `__panBench`) and,
like it, does not exist in a production build.
