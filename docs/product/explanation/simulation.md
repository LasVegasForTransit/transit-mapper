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

|               |         |                                                                                                 |
| ------------- | ------- | ----------------------------------------------------------------------------------------------- |
| `Line`        | stored  | public name and color, grouping one or more Services                                            |
| `Service`     | stored  | one mode, one path, and its schedule                                                            |
| `ServicePath` | stored  | the infrastructure sequence that Service operates                                               |
| Plan          | derived | for a given headway: how many vehicles the Service needs, their cycle, and the terminal layover |
| Run           | derived | vehicle _i_ of that plan                                                                        |

A run has no id and no memory. "Vehicle 3 of the Service" is a coordinate,
not an object — two consecutive frames are unrelated calculations that happen
to agree.

## Ramping up and down between stops

A vehicle's travel time between two stops used to be a straight division —
`distance ÷ speed`, the same constant from the first meter to the last. Every
leg (a run's first stretch out of a terminal, each stop to the next, and the
last stretch into one) is now its own accelerate/cruise/decelerate move
instead, starting and ending at rest, same as a real vehicle actually leaving
and arriving.

A leg long enough covers all three phases: speed up, hold the top speed, then
brake to a stop. A leg too short to reach top speed at all — closely-spaced
stops, the ordinary case on a tram or bus line — never gets there: it
accelerates to whatever peak it can reach and immediately starts braking. Both
cases fall out of one closed-form calculation with no iteration and no
per-frame state, so this costs about the same near-zero share of the frame
budget the old division did.

Acceleration and deceleration are properties of the vehicle
(`VehicleKind.accelMps2`/`decelMps2`, alongside its top speed), with a
plausible built-in default for anything left unset — the same fallback
pattern top speed already followed before a vehicle kind existed to override
it.

One consequence worth expecting: a round trip now takes a little longer than
distance ÷ speed ever suggested, and a Service whose stops sit close together can
spend the whole run never actually reaching its vehicle's nominal top speed.
That grows the round trip — and can grow the fleet a headway needs — a little
further than stops and dwell alone already did.

## Why "every 10 minutes" is exactly true

Set a Service's headway to 10 minutes and its stops are served every 10 minutes —
not approximately, exactly. That comes from building the cycle **from** the
headway rather than the other way round, which is also how an agency sizes a
Service:

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

The round trip is the outward trip **plus** the return, not twice either. Each
direction carries its own timetable, measured against its own path, because a
one-way couplet's return trip is a different street with its own length and its
own stops. For a Service that comes back the way it went the two are equal and
the round trip is exactly twice the one-way time, so nothing about such a Service
changed when this stopped being assumed.

That is also why a returning vehicle's position is walked forward along the
return path rather than counted down the outward one. There is no single ruler
both directions can be measured against once they are different ground.

The leftover time isn't a fudge factor. It's recovery time: a vehicle sitting
at the end of the line before starting back, which is what actually happens.
Every Service gets at least two minutes of it, and longer Services get more.

Some consequences worth expecting:

- **Adding stations grows the fleet.** More stops means a longer round trip,
  which means more vehicles to hold the same headway.
- **A headway longer than the round trip is fine.** One vehicle, waiting a
  long time at the terminal — an hourly service on a 25-minute loop.
- **A service with no headway set runs a single vehicle.** That is any route
  whose timing couldn't be established — including an imported one whose feed
  publishes no departure times.

The map draws at most twelve vehicles per Service. That is a **rendering** cap,
not a modeling one: the plan keeps its true fleet and headway and only the
first twelve are drawn, so very frequent service on a long line shows gaps
rather than wrong spacing. Clamping the fleet itself would shorten the cycle
below the round trip, which no vehicle could run.

## Seeing the chain

The inspector states all three links, live against the simulated clock, so
none of it has to be taken on trust:

> **Round trip** 22 min · **Vehicles** 3
>
> At Mon 08:00 AM it runs every 10 min (Peak). 2 stops and 10 min of dwell, a
> round trip takes 22 min, so holding that headway needs 3 vehicles, each
> waiting 4.1 min at either end.

Change any input and the numbers move: add a station, raise its dwell, assign
a faster vehicle kind, or edit the headway. That's the point — before this,
adding a station silently added a train.

The inspector and the map resolve through the same functions in
`packages/core/src/sim/serviceStats.ts`, so the figure a planner reads and the
fleet the map runs cannot drift apart.

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
at Monday 08:00 — mid-morning on purpose, since a new Service defaults to a
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

A Service only runs when its schedule says it does. At 03:00 an operation with a
06:00–23:00 span shows no vehicles, because at 03:00 it isn't running — which
is what a span of service means.

The rules, in the order they apply:

1. A detailed `schedule` supersedes the flat fields. The first period whose day
   scope and span both cover the current simulated time wins, and its headway
   is what the Service runs. An hour no period covers is an hour with no service.
2. Otherwise `frequencyMinutes`, bounded by `spanStart`/`spanEnd`.
3. A service with nothing set at all runs all day at no stated frequency — one
   vehicle. That is the fallback for anything whose timing is unknown, and it
   is deliberately unchanged.

The simulated week is Monday-to-Sunday, which is the shortest cycle that can
express the weekday/weekend split `ScheduleDayScope` models. Nothing here
models dates, months, or holidays.

### Pinning a scenario

Following the clock answers "what does the network look like now". The other
question — "what does peak look like next to midday" — shouldn't require
waiting for the right hour. So a schedule period can be **pinned**: every Service
then runs that period's configuration whatever the clock says, spans and day
scopes included.

The scenarios on offer are the period names found across the system's own
services, the way the layer filters come from the catalogs. A system whose
periods are "Rush" and "Quiet" offers exactly those, and one that has never
had a schedule edited offers none — the control doesn't appear at all.

A Service with no period by the pinned name doesn't run in that scenario, which
is the honest answer for a weekday-only express under "Weekend". A Service with
no detailed schedule runs its flat headway in every scenario.

The clock keeps ticking while a scenario is pinned — vehicles still need a
time base to move against — it just isn't deciding service levels any more,
and the readout dims to say so.

Two practical notes. The clock starts at Monday 08:00 so a fresh map isn't
empty. And a service that isn't running is skipped before its geometry is
resolved, so a system half-asleep at 23:30 does roughly half the work.

## Routes that share a stop

Two Services on the same Way are evaluated **independently** — each
resolves its own schedule, plan and runs, and neither knows the other exists.
Their vehicles already ride distinct lanes and draw at distinct offsets, so
nothing needs coordinating.

What they add up to is a separate question, and the most useful number the
tool produces from overlapping lines: two 10-minute routes are a **5-minute**
service to anyone standing between them. Frequencies add; headways don't.

That's computed as analysis over the same schedule data the animation resolves
against (`packages/core/src/sim/frequency.ts`), not measured off the animation
— so it's exact, instant, and readable in the Station inspector without
watching the map. The two are independent routes to the same number, which
makes each a check on the other.

The typical-wait figure assumes riders turn up without consulting a timetable
and that the routes aren't deliberately timed against each other. Both hold
for frequent, turn-up-and-go service, and the inspector says so rather than
leaving it implied.

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

|                                             |                                                                                |
| ------------------------------------------- | ------------------------------------------------------------------------------ |
| `packages/core/src/sim/clock.ts`            | the speed ladder, time-of-day and weekday math, span math. Pure.               |
| `packages/core/src/sim/fleet.ts`            | fleet size, cycle time, layover, and where run _i_ is. Pure.                   |
| `packages/core/src/sim/frequency.ts`        | which services call at a stop, and their combined frequency. Pure.             |
| `packages/core/src/sim/timetable.ts`        | travel — accelerating, cruising, braking — and dwell, along one pattern. Pure. |
| `packages/core/src/sim/serviceStats.ts`     | the one measurement of a Service: path, stops, timetable, plan. Pure.          |
| `packages/core/src/geometry/vehicleLane.ts` | the lane-accurate polyline one leg of a pattern rides. Pure.                   |
| `apps/web/src/sim/simClock.ts`              | the `SimClock` instance: the mutable number and its subscribers.               |
| `apps/web/src/sim/vehicles.ts`              | the stable browser animation API facade.                                       |
| `apps/web/src/sim/vehicleAnimationHost.ts`  | the 30 Hz host — advances the clock and pushes GeoJSON to MapLibre.            |
| `apps/web/src/sim/patternGeometry.ts`       | dependency-aware geometry and timetable caches for each pattern.               |
| `apps/web/src/sim/serviceSchedule.ts`       | minute-level active-service resolution and idle wake-up policy.                |
| `apps/web/src/sim/devHandle.ts`             | `window.__sim`, a development-only handle for driving the clock by hand.       |
| `apps/web/src/ui/SimProvider.tsx`           | speed and paused state, and ownership of the clock instance.                   |
| `apps/web/src/ui/SimControls.tsx`           | the transport controls, beside the view switch.                                |

The line between the last two groups is the one that matters: `packages/core`
decides _what the answer is_ and the app decides _when to ask_. That is why the
simulator can be tested without a browser.

## Cost and interaction priority

The simulation resolves on a fixed 30 Hz tick, decoupled from the render loop,
and skips whole patterns whose path is off-screen. Three things keep it cheap:

- A service that isn't running is skipped before its geometry is resolved.
- Schedule resolution — walking each service's periods and parsing their spans
  — is redone only when the simulated **minute** changes, not every frame.
- During a transient geometry edit, animation continues against the last
  settled system. This preserves truthful time and visible motion without
  rebuilding pattern geometry for every pointer snapshot; release adopts the
  committed system on the next frame. Camera manipulation continues using the
  current bounds normally.

At agency scale, imported feeds now carry real service levels (see below), so
every pattern plans a real fleet rather than a single vehicle. What bounds the
cost on screen is the per-pattern draw cap: the plan keeps its true fleet and
headway, and only the first twelve runs are drawn.

**What has been measured.** The simulation's own per-tick cost, over 285
patterns — RTC Southern Nevada's order of magnitude — on a 71-minute round trip
with 25 stops, running the real `activeSchedule` → `planService` → `runStateAt`
chain 300 times:

| service level              | fleet/pattern | vehicles drawn | per tick | share of a 30 Hz budget |
| -------------------------- | ------------- | -------------- | -------- | ----------------------- |
| untimed (one vehicle each) | 1             | 285            | 0.056 ms | 0.2%                    |
| every 10 min               | 8             | 2,280          | 0.115 ms | 0.3%                    |
| every 5 min                | 15 (12 drawn) | 3,420          | 0.161 ms | 0.5%                    |

An eightfold rise in vehicles costs about twice the time, because per-service
schedule resolution — one call per service however many vehicles it runs —
dominates at the low end. In absolute terms it is half a percent of the frame
budget, so deriving headways from a feed is not what will make this slow.

These numbers predate accelerating/decelerating between stops. The per-leg
calculation is still one closed-form computation with no iteration — a few
more multiplies and a square root in place of one division — so the shape of
this table should hold, but that is an expectation, not a re-measurement; the
table above hasn't been rerun against it.

**Browser attribution.** The fixed headed-Chrome suite now measures the
downstream work too: source uploads, MapLibre painted-frame intervals, and
unexpected long tasks while trusted pointer input runs with the simulation
both running and paused. `__panBench` / `__zoomBench` with
`__perf.vehicles` toggled remain the local A/B seam. See
[Measure browser performance](../../development/how-to/measure-performance.md)
for the protocol and current evidence.

## Service levels from an imported feed

A GTFS feed knows how often its routes run, and import used to throw all of it
away. It now recovers a headway and a span per route, from whichever source the
feed offers:

1. **`frequencies.txt`, when present.** That file is a headway plus a time
   window, stated by the agency — it maps onto schedule periods exactly, named
   for the hour they start (AM peak, Midday, PM peak, Evening, Night).
2. **Otherwise the departure times in `stop_times.txt`**, which is a
   measurement rather than a statement, so three things it would be easy to get
   wrong are handled deliberately:
   - **The median gap, not the mean.** Departures aren't evenly spread, and
     there is an enormous gap overnight. A mean is dragged upward by it; the
     median is what a rider waits for most of the day.
   - **Per direction.** Counting both directions together reports twice the
     real frequency, since a rider going one way can't use the other.
   - **One service day.** `calendar.txt` isn't imported, so trips are measured
     under the busiest `service_id` — in practice the ordinary weekday — rather
     than blending a weekday peak with a Sunday timetable.

A feed that publishes no usable times still imports untimed, and those routes
keep the single-vehicle behavior described above.

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
