// Actions that act on the POINT you clicked, not on the whole object.
//
// Cutting a line used to be possible only at a stop: the inspector walks the
// stop sequence and hands trimPatternTo/splitServiceAt that station's anchor.
// Both store actions have always taken an arbitrary position along a way, and
// nothing ever passed one — so removing a stretch of a line that had no
// station at each end could not be asked for at all.
//
// A right-click knows where it landed, so these providers turn that position
// into the `t` those actions were already written to accept.

import { nearestOnPath, resolveWayPath } from '@transitmapper/core/model/geo';
import { patternRunLegs } from '@transitmapper/core/model/geo';
import { patternPositionAt, type PatternPosition } from '@transitmapper/core/model/serviceEdits';
import {
  refIds,
  type ActionContext,
  type SelectionAction,
  type SelectionActionProvider,
} from '@transitmapper/core/model/selectionActions';
import type { LngLat, TransitSystem } from '@transitmapper/core/model/system';
import type { EditorStore } from '../store';

// There is deliberately no distance check here.
//
// `at` only ever comes from a right-click, and that click already resolved
// what it hit through the map's own pixel hit-testing — the object under the
// cursor is what got selected. Re-checking the distance in METRES would
// re-introduce the zoom blindness that plagues this codebase elsewhere: at a
// zoom where one pixel is fifty metres, a click visually on the line is
// tens of metres off it, and a metric gate silently offers nothing.
//
// What remains worth checking is where along the object the point falls: a cut
// at either extreme removes nothing and splits nothing.

/** A position this close to an end is the end, and cutting there is a no-op. */
const END_T = 0.001;

interface PointOnWay {
  wayId: string;
  t: number;
}

/** Where a click lands along one specific way, or null if it missed. */
function pointOnWay(system: TransitSystem, wayId: string, at: LngLat): PointOnWay | null {
  const way = system.ways.find((w) => w.id === wayId);
  if (!way) return null;
  const near = nearestOnPath(resolveWayPath(way), at);
  if (!near) return null;
  if (near.t <= END_T || near.t >= 1 - END_T) return null;
  return { wayId, t: near.t };
}

/** Which of a line's own ways the click landed on, and where along it. A line
 *  runs over many ways; only the one under the cursor can be cut. */
function pointOnService(
  system: TransitSystem,
  serviceId: string,
  at: LngLat,
  renderedHit: ActionContext['serviceHit'],
): { position: PatternPosition } | null {
  const service = system.services.find((s) => s.id === serviceId);
  if (!service) return null;
  if (renderedHit?.serviceId === serviceId) {
    const pattern = service.patterns.find((candidate) => candidate.id === renderedHit.patternId);
    if (!pattern) return null;
    const leg = patternRunLegs(pattern, renderedHit.run)[renderedHit.legIndex];
    const way = leg && system.ways.find((candidate) => candidate.id === leg.leg.wayId);
    const near = way && nearestOnPath(resolveWayPath(way), at);
    if (!near || near.t <= END_T || near.t >= 1 - END_T) return null;
    const position = patternPositionAt(
      system.ways,
      pattern,
      renderedHit.run,
      renderedHit.legIndex,
      near.t,
    );
    return position ? { position } : null;
  }
  let best: { position: PatternPosition; distMeters: number } | null = null;
  for (const pattern of service.patterns) {
    for (const run of ['outbound', 'inbound'] as const) {
      for (const [legIndex, { leg }] of patternRunLegs(pattern, run).entries()) {
        const way = system.ways.find((candidate) => candidate.id === leg.wayId);
        if (!way) continue;
        const near = nearestOnPath(resolveWayPath(way), at);
        if (!near || near.t <= END_T || near.t >= 1 - END_T) continue;
        const position = patternPositionAt(system.ways, pattern, run, legIndex, near.t);
        if (!position || (best && best.distMeters <= near.distMeters)) continue;
        best = { position, distMeters: near.distMeters };
      }
    }
  }
  return best ? { position: best.position } : null;
}

/**
 * Cutting a LINE at the clicked point.
 *
 * All three of these already existed and were reachable only from a stop row.
 * "Cut here" leaves two lines you can delete either half of, which is how a
 * stretch in the middle comes out: cut at both ends, delete the middle.
 */
export function servicePointActionProvider(store: EditorStore): SelectionActionProvider {
  return ({ system, refs, at, serviceHit }: ActionContext) => {
    if (!at) return [];
    const [serviceId] = refIds(refs, 'service');
    if (!serviceId || refs.length !== 1) return [];
    const hit = pointOnService(system, serviceId, at, serviceHit);
    if (!hit) return [];

    const actions: SelectionAction[] = [
      {
        id: 'service.cutHere',
        label: 'Divide line here',
        hint: 'Two lines over the same track; delete either half',
        group: 'cut',
        run: () => store.getState().divideServiceAt(serviceId, hit.position),
      },
      {
        id: 'service.startHere',
        label: 'Start the line here',
        hint: 'Drops everything before this point',
        group: 'cut',
        run: () => store.getState().trimPatternAt(serviceId, hit.position, 'start'),
      },
      {
        id: 'service.endHere',
        label: 'End line here',
        hint: 'Drops everything after this point',
        group: 'cut',
        run: () => store.getState().endPatternAt(serviceId, hit.position),
      },
    ];
    return actions;
  };
}

/**
 * Cutting a WAY at the clicked point.
 *
 * splitWayAt has only ever taken a control-point INDEX, so a street could be
 * divided at a drag handle and nowhere else. The store's own stretch-removal
 * code already knows how to turn a position into an index by splicing a point
 * in; this exposes the same thing to a click.
 */
export function wayPointActionProvider(store: EditorStore): SelectionActionProvider {
  return ({ system, refs, at }: ActionContext) => {
    if (!at) return [];
    const [wayId] = refIds(refs, 'way');
    if (!wayId || refs.length !== 1) return [];
    const hit = pointOnWay(system, wayId, at);
    if (!hit) return [];
    return [
      {
        id: 'way.splitHere',
        label: 'Divide here',
        hint: 'Two streets, each editable on its own',
        group: 'cut',
        run: () => store.getState().splitWayAtT(wayId, hit.t),
      },
    ];
  };
}
