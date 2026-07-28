// What a selected line — or two — lets you do.
//
// The two merges here are genuinely different operations and the geometry
// picks between them: lines that meet end to end become one continuous ride,
// while lines that share or cross a corridor become one line with two
// branches. Offering both at once would ask people to know the difference
// before they had a reason to care.

import {
  refIds,
  type SelectionAction,
  type SelectionActionProvider,
} from '@transitmapper/core/model/selectionActions';
import { patternHasCouplet } from '@transitmapper/core/model/geo';
import { servicesShareOrCross, terminiMeet } from '@transitmapper/core/model/selectionRelations';
import type { EditorStore } from '../store';

export function serviceActionProvider(store: EditorStore): SelectionActionProvider {
  return ({ system, refs }) => {
    const serviceIds = refIds(refs, 'service');

    // One line selected: the couplet gestures. Offered here rather than only
    // in the inspector because splitting a line is a thing you decide while
    // looking at where it runs, which is the map.
    if (serviceIds.length === 1 && refs.length === 1) {
      const service = system.services.find((s) => s.id === serviceIds[0]);
      // A branching line has no single path to split — which of its branches
      // gets the return trip is a question the menu cannot ask.
      if (!service || service.patterns.length !== 1) return [];
      const pattern = service.patterns[0];
      return patternHasCouplet(pattern)
        ? [
            {
              id: 'service.makeTwoWay',
              label: 'Make it run both ways on one street',
              hint: 'Its return trip rejoins the outward one',
              group: 'direction',
              run: () => store.getState().makePatternTwoWay(service.id, pattern.id),
            },
          ]
        : [
            {
              id: 'service.drawReturnPath',
              label: 'Draw a separate return path',
              hint: 'Trace the streets the return trip runs — a one-way couplet',
              group: 'direction',
              run: () => store.getState().startReturnPathDraft(service.id, pattern.id),
            },
          ];
    }

    if (serviceIds.length !== 2 || refs.length !== 2) return [];

    const [a, b] = serviceIds;
    const first = system.services.find((s) => s.id === a);
    const second = system.services.find((s) => s.id === b);
    // A bus line and a rail line cannot become one line at all. The inspector
    // says so in prose; the menu simply has nothing to offer.
    if (!first || !second || first.modeId !== second.modeId) return [];

    const actions: SelectionAction[] = [];

    if (terminiMeet(system, a, b)) {
      actions.push({
        id: 'service.throughRoute',
        label: 'Join into a through-route',
        hint: `One continuous line, keeping the name “${first.name}”`,
        group: 'merge',
        run: () => store.getState().throughRouteInto(a, b),
      });
    }

    if (servicesShareOrCross(system, a, b)) {
      actions.push({
        id: 'service.mergeInto',
        label: 'Merge into one line',
        hint: `“${second.name}” becomes a branch of “${first.name}”`,
        group: 'merge',
        run: () => store.getState().mergeServiceInto(b, a),
      });
    }

    return actions;
  };
}
