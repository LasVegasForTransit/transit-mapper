// What a selected line — or two — lets you do.
//
// Joining Services changes the ride itself. Grouping Services under one
// public Line changes only what the agency designates on its map.

import {
  refIds,
  type ActionContext,
  type SelectionAction,
  type SelectionActionProvider,
} from '@transitmapper/core/model/selectionActions';
import { patternHasCouplet } from '@transitmapper/core/model/geo';
import {
  lineForService,
  serviceDisplayLabel,
  servicePattern,
  servicesForLine,
} from '@transitmapper/core/model/line-service';
import { servicesShareOrCross, terminiMeet } from '@transitmapper/core/model/selectionRelations';
import type { EditorStore } from '../store';

export const JOIN_THROUGH_SERVICE_LABEL = 'Join into a through-service';

function lineActions(
  store: EditorStore,
  { system, refs }: ActionContext,
  lineIds: string[],
): SelectionAction[] {
  if (lineIds.length !== 2 || refs.length !== 2) return [];
  const [targetLineId, sourceLineId] = lineIds;
  const targetServices = servicesForLine(system, targetLineId);
  const sourceServices = servicesForLine(system, sourceLineId);
  if (targetServices.length === 0 || sourceServices.length === 0) return [];
  const [target] = targetServices;
  const [source] = sourceServices;
  const actions: SelectionAction[] = [];
  if (
    targetServices.length === 1 &&
    sourceServices.length === 1 &&
    target.modeId === source.modeId &&
    terminiMeet(system, target.id, source.id)
  ) {
    actions.push({
      id: 'service.throughRoute',
      label: JOIN_THROUGH_SERVICE_LABEL,
      hint: `One continuous Service, keeping “${serviceDisplayLabel(system, target.id)}”`,
      group: 'merge',
      run: () => store.getState().throughRouteInto(target.id, source.id),
    });
  }
  actions.push({
    id: 'line.groupServices',
    label: 'Group under one line',
    hint: 'Keep both operations while presenting them as one public Line',
    group: 'merge',
    run: () => {
      for (const service of sourceServices)
        store.getState().moveServiceToLine(service.id, targetLineId);
    },
  });
  return actions;
}

function singleServiceActions(
  store: EditorStore,
  { system, serviceHit }: ActionContext,
  serviceId: string,
): SelectionAction[] {
  const service = system.services.find((candidate) => candidate.id === serviceId);
  if (!service) return [];
  const { terminusSide, position } = serviceHit ?? {};
  if (terminusSide && position && serviceHit?.serviceId === service.id) {
    return [
      {
        id: 'service.convertTerminus',
        label: 'Add a return trip from here',
        hint: 'Drag to where this line should turn back',
        group: 'direction',
        run: () =>
          store.getState().armTerminus({
            serviceId: serviceHit.serviceId,
            patternId: serviceHit.patternId,
            side: terminusSide,
            position,
          }),
      },
    ];
  }
  const pattern = servicePattern(service);
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
    : [];
}

function pairedServiceActions(
  store: EditorStore,
  { system }: ActionContext,
  [a, b]: string[],
): SelectionAction[] {
  const first = system.services.find((service) => service.id === a);
  const second = system.services.find((service) => service.id === b);
  if (!first || !second) return [];
  const actions: SelectionAction[] = [];
  if (first.modeId === second.modeId && terminiMeet(system, a, b)) {
    actions.push({
      id: 'service.throughRoute',
      label: JOIN_THROUGH_SERVICE_LABEL,
      hint: `One continuous service, keeping “${serviceDisplayLabel(system, first.id)}”`,
      group: 'merge',
      run: () => store.getState().throughRouteInto(a, b),
    });
  }
  const targetLine = servicesShareOrCross(system, a, b) ? lineForService(system, a) : undefined;
  if (targetLine)
    actions.push({
      id: 'service.mergeInto',
      label: 'Group under one line',
      hint: `Move “${serviceDisplayLabel(system, second.id)}” under the same public line`,
      group: 'merge',
      run: () => store.getState().moveServiceToLine(b, targetLine.id),
    });
  return actions;
}

export function serviceActionProvider(store: EditorStore): SelectionActionProvider {
  return (context) => {
    const lineIds = refIds(context.refs, 'line');
    if (lineIds.length > 0) return lineActions(store, context, lineIds);
    const serviceIds = refIds(context.refs, 'service');
    if (serviceIds.length === 1 && context.refs.length === 1) {
      return singleServiceActions(store, context, serviceIds[0]);
    }
    if (serviceIds.length !== 2 || context.refs.length !== 2) return [];
    return pairedServiceActions(store, context, serviceIds);
  };
}
