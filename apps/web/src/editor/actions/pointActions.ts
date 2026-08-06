// Actions that act on the POINT you clicked, not on the whole object.
//
// Cutting a line used to be possible only at a stop: the inspector walks the
// stop sequence and hands trimPatternTo/splitServiceAt that station's anchor.
// Both store actions have always taken an arbitrary position along a way, and
// nothing ever passed one — so removing a stretch of a line that had no
// station at each end could not be asked for at all.
//
// The interaction layer resolves the hit once, while it still has the exact
// rendered occurrence. These providers deliberately consume that result
// instead of projecting a geographic click back onto a possibly different
// pass through the same corridor.

import {
  refIds,
  type ActionContext,
  type SelectionAction,
  type SelectionActionProvider,
} from '@transitmapper/core/model/selectionActions';
import { isOneWay } from '@transitmapper/core/model/profile';
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

/**
 * Cutting a LINE at the clicked point.
 *
 * All three of these already existed and were reachable only from a stop row.
 * "Cut here" leaves two lines you can delete either half of, which is how a
 * stretch in the middle comes out: cut at both ends, delete the middle.
 */
export function servicePointActionProvider(store: EditorStore): SelectionActionProvider {
  return ({ refs, serviceHit }: ActionContext) => {
    const [serviceId] = refIds(refs, 'service');
    if (!serviceId || refs.length !== 1) return [];
    // A terminus has its own constrained menu. Offering line cuts beside the
    // conversion action would turn one exact handle into competing commands.
    if (serviceHit?.terminusSide) return [];
    if (serviceHit?.serviceId !== serviceId || !serviceHit.position) return [];

    const actions: SelectionAction[] = [
      {
        id: 'service.cutHere',
        label: 'Divide line here',
        hint: 'Two lines over the same track; delete either half',
        group: 'cut',
        run: () => store.getState().divideServiceAt(serviceId, serviceHit.position!),
      },
      {
        id: 'service.endHere',
        label: 'End line here',
        hint: 'Keeps the longer side and ends it at this point',
        group: 'cut',
        run: () => store.getState().endPatternAt(serviceId, serviceHit.position!),
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
  return ({ refs, corridorHit, system }: ActionContext) => {
    const [wayId] = refIds(refs, 'way');
    if (!wayId || refs.length !== 1) return [];
    if (!corridorHit || corridorHit.wayId !== wayId) return [];
    const way = system.ways.find((w) => w.id === wayId);
    const actions: SelectionAction[] = [
      {
        id: 'way.splitHere',
        label: 'Split corridor here',
        hint: 'Two streets, each editable on its own',
        group: 'cut',
        run: () => store.getState().splitWayAtT(wayId, corridorHit.t),
      },
    ];
    // Also offered from the Way Inspector's Lanes tab — surfaced here too so
    // it's reachable from the same right-click a person already tried it
    // from, rather than only from a panel they have to know to open. Hidden
    // once a way is already one-way rather than left to separateCarriageways'
    // own silent no-op, which is the more honest affordance.
    if (way && !isOneWay(way.profile)) {
      actions.push({
        id: 'way.separateCarriageways',
        label: 'Separate carriageways',
        hint: 'Two one-way streets around a median, each draggable from its own end',
        group: 'cut',
        run: () => store.getState().separateCarriageways(wayId),
      });
    }
    return actions;
  };
}
