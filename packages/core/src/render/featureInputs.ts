import type { TransitSystem } from '../model/system';

// Which TransitSystem fields buildFeatures actually reads.
//
// The live map rebuilds whenever the store hands it a new `system` reference.
// But most of TransitSystem is not renderable: typing one character into the
// name field mints a new `system`, and that used to run a full 14-collection
// buildFeatures plus fourteen whole-collection setData uploads — at RTC scale
// (~3.8k ways / ~121k waypoints / ~3.8k stops) that is hundreds of
// milliseconds of main-thread work to redraw a map that did not change.
//
// Splitting the fields into "render" and "meta" lets MapCanvas skip the rebuild
// entirely when only meta changed. The risk this trades against is the worst
// failure this codebase can have — a screen that is silently stale because a
// field was misclassified — so two things guard it:
//
//   1. The Record<keyof TransitSystem, …> below is EXHAUSTIVE by type. Adding a
//      field to TransitSystem is a compile error until it is classified here.
//      A new renderable field cannot be forgotten into staleness.
//   2. apps/web/tests/verify.test.ts asserts the classification by experiment:
//      for every "meta" field it mutates the field and checks that all 14
//      collections come out byte-identical. That catches the residual hole —
//      a field classified correctly today whose USE changes tomorrow.
//
// The "render" set is exactly the eight fields read inside buildFeatures.ts.
// The non-obvious "meta" entries, because a reader will reasonably doubt them:
//
//   - `drivingSide` and `medians` are consumed at IMPORT time
//     (model/import.ts) and baked into each Way's profile; the renderer reads
//     the profile, never these.
//   - `approachControls` are rendered as arm-level control markers and the
//     associated crosswalk/stop-bar markings. They are separate from
//     Node.control because a signal can govern only one incoming approach.
//   - `vehicleKinds` drives the vehicle sources, which apps/web/src/sim/
//     vehicles.ts fills from its own store.getState() inside its animation
//     tick with no subscription, so it self-heals within one frame.
//   - `viewport` is not the live camera: apps/web/src/camera/liveCamera.ts owns
//     that, precisely so a pan does not mint a new `system`.
//   - `name` is rendered only on EXPORTS (render/svg.ts titles, legends), which
//     build through their own call into buildFeatures rather than through this
//     gate, so they are unaffected.
export const FEATURE_INPUT_ROLE: Record<keyof TransitSystem, 'render' | 'meta'> = {
  ways: 'render',
  lines: 'render',
  services: 'render',
  stops: 'render',
  stations: 'render',
  facilities: 'render',
  groups: 'render',
  nodes: 'render',
  namedWays: 'render',
  // Read by connectorCurves for the selected node's turn guides
  // (buildFeatures.ts, the connectors collection).
  turnRestrictions: 'render',

  version: 'meta',
  id: 'meta',
  name: 'meta',
  description: 'meta',
  viewport: 'meta',
  createdAt: 'meta',
  updatedAt: 'meta',
  vehicleKinds: 'meta',
  palette: 'meta',
  drivingSide: 'meta',
  medians: 'meta',
  approachControls: 'render',
};

// Derived from the table above rather than written out a second time, so the
// two can never disagree.
const RENDER_INPUT_KEYS = (Object.keys(FEATURE_INPUT_ROLE) as (keyof TransitSystem)[]).filter(
  (key) => FEATURE_INPUT_ROLE[key] === 'render',
);

/** Whether anything buildFeatures reads differs between two systems.
 *
 *  Compares by REFERENCE, not by value: the store mutates with surgical spreads,
 *  so an untouched sub-array keeps its identity and a touched one is always a
 *  fresh object. That makes this a fixed-size pointer check rather than a deep walk,
 *  and it cannot report a real change as clean — a mutation that kept the same
 *  array identity would already be invisible to every memo in render/. */
export function featureInputsChanged(before: TransitSystem, after: TransitSystem): boolean {
  if (before === after) return false;
  for (const key of RENDER_INPUT_KEYS) {
    if (before[key] !== after[key]) return true;
  }
  return false;
}
