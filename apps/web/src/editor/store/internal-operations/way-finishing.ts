import { patternLegs, oneSection, wholeLeg } from '@transitmapper/core/model/geo';
import { servicePattern } from '@transitmapper/core/model/line-service';
import { resyncAutoNamedStations } from '@transitmapper/core/model/geo/crossStreetNaming';
import { deleteSelection } from '@transitmapper/core/model/selection-deletion';
import type { TransitSystem } from '@transitmapper/core/model/system';
import type { EditorState } from '../state';

export interface WayFinishingOperations {
  readonly createId: () => string;
  readonly conflatePattern: (
    system: TransitSystem,
    serviceId: string,
    patternId: string,
  ) => TransitSystem;
  readonly formCrossings: (system: TransitSystem, wayId: string) => TransitSystem;
}

export interface WayFinishChange {
  system: TransitSystem;
  transient: Pick<
    EditorState,
    'activeWayId' | 'addingServiceDraft' | 'draftSeparate' | 'selection'
  >;
}

function withAddedService(
  system: TransitSystem,
  wayId: string,
  draft: EditorState['addingServiceDraft'],
  createId: () => string,
): { system: TransitSystem; selectionId: string | null } {
  if (!draft) return { system, selectionId: null };
  const line = system.lines.find((candidate) => candidate.id === draft.lineId);
  const parent = system.services.find((service) => line?.serviceIds.includes(service.id));
  if (!line || !parent) {
    return { system, selectionId: null };
  }
  const serviceId = createId();
  const service = {
    id: serviceId,
    name: draft.name.trim(),
    modeId: draft.modeId,
    path: { id: serviceId, sections: oneSection([wholeLeg(wayId)]) },
    frequencyMinutes: parent.frequencyMinutes,
    spanStart: parent.spanStart,
    spanEnd: parent.spanEnd,
    schedule: parent.schedule,
  };
  const lines = system.lines.map((candidate) =>
    candidate.id === line.id
      ? { ...candidate, serviceIds: [...candidate.serviceIds, serviceId] }
      : candidate,
  );
  return {
    system: resyncAutoNamedStations(
      { ...system, lines, services: [...system.services, service] },
      new Set([wayId]),
    ),
    selectionId: serviceId,
  };
}

function withConflatedPattern(
  system: TransitSystem,
  wayId: string,
  conflatePattern: WayFinishingOperations['conflatePattern'],
): TransitSystem {
  for (const service of system.services) {
    const pattern = servicePattern(service);
    if (patternLegs(pattern).some((leg) => leg.wayId === wayId)) {
      return conflatePattern(system, service.id, pattern.id);
    }
  }
  return system;
}

/**
 * Completes one drawing workflow as a pure document change. Conflation and
 * crossing formation are folded into this result so the runtime publishes
 * exactly one content commit and history records exactly one undo step.
 */
export function finishActiveWay(
  state: EditorState,
  operations: WayFinishingOperations,
): WayFinishChange {
  const wayId = state.activeWayId;
  const transient: WayFinishChange['transient'] = {
    activeWayId: null,
    addingServiceDraft: null,
    draftSeparate: false,
    selection: state.selection,
  };
  if (!wayId) return { system: state.system, transient };
  const way = state.system.ways.find((candidate) => candidate.id === wayId);
  if (!way) return { system: state.system, transient };
  if (way.points.length < 2) {
    return {
      system: deleteSelection(state.system, [{ kind: 'way', id: wayId }]),
      transient: { ...transient, selection: null },
    };
  }

  const addition = withAddedService(
    state.system,
    wayId,
    state.addingServiceDraft,
    operations.createId,
  );
  let system = state.draftSeparate
    ? addition.system
    : withConflatedPattern(addition.system, wayId, operations.conflatePattern);
  if (system.ways.some((candidate) => candidate.id === wayId)) {
    system = operations.formCrossings(system, wayId);
  }
  return {
    system,
    transient: {
      ...transient,
      selection: addition.selectionId
        ? { kind: 'service', id: addition.selectionId }
        : transient.selection,
    },
  };
}
