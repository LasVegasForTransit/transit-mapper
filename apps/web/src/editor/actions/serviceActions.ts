// What two selected lines let you do.
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
import { servicesShareOrCross, terminiMeet } from '@transitmapper/core/model/selectionRelations';
import type { EditorStore } from '../store';

export function serviceActionProvider(store: EditorStore): SelectionActionProvider {
  return ({ system, refs }) => {
    const serviceIds = refIds(refs, 'service');
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
