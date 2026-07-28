// What two or more selected pieces of infrastructure let you do.
//
// A provider is the only place that knows both a relationship and an
// operation: core answers "these two ways share an endpoint", the store knows
// how to merge them, and this decides that the first is worth offering the
// second. Neither side has to learn about the other.

import { wayLengthMeters } from '@transitmapper/core/model/geo';
import {
  refIds,
  type SelectionAction,
  type SelectionActionProvider,
} from '@transitmapper/core/model/selectionActions';
import {
  crossingBetween,
  runsAlongside,
  sharedEndpointNode,
  wayCarriesService,
} from '@transitmapper/core/model/selectionRelations';
import type { TransitSystem } from '@transitmapper/core/model/system';
import type { EditorStore } from '../store';

/** Longest first, matching what mergeWaysIntoCorridor does internally: a long
 *  trunk should be the corridor everything else joins, not a short shuttle
 *  that happened to be clicked first. */
function longestFirst(system: TransitSystem, wayIds: string[]): string[] {
  return [...wayIds].sort((a, b) => {
    const wa = system.ways.find((w) => w.id === a);
    const wb = system.ways.find((w) => w.id === b);
    return (wb ? wayLengthMeters(wb) : 0) - (wa ? wayLengthMeters(wa) : 0);
  });
}

/**
 * True when merging this set into one corridor would actually move something.
 *
 * Co-alignment alone is not enough. mergeWaysIntoCorridor rebinds SERVICES
 * onto the keeper, so a way that runs alongside one but carries no line is
 * left exactly where it is — offering the merge there would do nothing and
 * teach people the action is broken.
 */
function corridorMergeWouldAbsorb(system: TransitSystem, ordered: string[]): boolean {
  const [keeper, ...rest] = ordered;
  return rest.some((id) => wayCarriesService(system, id) && runsAlongside(system, id, keeper));
}

export function wayActionProvider(store: EditorStore): SelectionActionProvider {
  return ({ system, refs }) => {
    const wayIds = refIds(refs, 'way');
    // Mixed selections offer nothing here: a way and a station have no
    // relationship these operations act on.
    if (wayIds.length < 2 || wayIds.length !== refs.length) return [];

    const actions: SelectionAction[] = [];

    if (wayIds.length === 2) {
      const [a, b] = wayIds;
      if (sharedEndpointNode(system, a, b)) {
        actions.push({
          id: 'way.joinEndToEnd',
          label: 'Join end to end',
          hint: 'One way instead of two, keeping the first one’s name',
          group: 'merge',
          run: () => store.getState().mergeWays(a, b),
        });
      }
      if (crossingBetween(system, a, b)) {
        actions.push({
          id: 'way.connectAtCrossing',
          label: 'Connect at crossing',
          hint: 'Split both where they cross so vehicles can turn between them',
          group: 'merge',
          run: () => store.getState().formCrossingJunctions(a, b),
        });
      }
    }

    const ordered = longestFirst(system, wayIds);
    if (corridorMergeWouldAbsorb(system, ordered)) {
      actions.push({
        id: 'way.mergeCorridor',
        label: 'Merge into one corridor',
        hint: 'Lines on the others move onto the longest',
        group: 'merge',
        run: () => store.getState().mergeWaysIntoCorridor(ordered),
      });
    }

    return actions;
  };
}
