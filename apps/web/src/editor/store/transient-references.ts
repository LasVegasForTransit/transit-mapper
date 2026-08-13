import type { TransitSystem } from '@transitmapper/core/model/system';
import type { EditorState, MultiSelectItem, Selection } from './state';

type ReferentialTransientState = Pick<
  EditorState,
  | 'selection'
  | 'outlineHover'
  | 'activePatternId'
  | 'armedTerminus'
  | 'multiSelection'
  | 'activeWayId'
  | 'routeDraft'
  | 'placingFacilityForGroupId'
  | 'pickingMemberForGroupId'
  | 'addingServiceDraft'
  | 'focusNameStopId'
>;

function includesId(records: readonly { id: string }[], id: string): boolean {
  return records.some((record) => record.id === id);
}

function retainedId(id: string | null, records: readonly { id: string }[]): string | null {
  return id && includesId(records, id) ? id : null;
}

function referenceExists(
  system: TransitSystem,
  kind: NonNullable<Selection>['kind'],
  id: string,
): boolean {
  switch (kind) {
    case 'way':
      return includesId(system.ways, id);
    case 'line':
      return includesId(system.lines, id);
    case 'service':
      return includesId(system.services, id);
    case 'stop':
      return includesId(system.stops, id);
    case 'station':
      return includesId(system.stations, id);
    case 'facility':
      return includesId(system.facilities, id);
    case 'group':
      return includesId(system.groups, id);
    case 'node':
      return includesId(system.nodes, id);
  }
}

function pruneSelection(system: TransitSystem, selection: Selection): Selection {
  if (!selection || !referenceExists(system, selection.kind, selection.id)) return null;
  if (selection.kind === 'service' && selection.stopId) {
    return includesId(system.stops, selection.stopId)
      ? selection
      : { kind: 'service', id: selection.id };
  }
  if (selection.kind !== 'way' || !selection.relatedIds) return selection;
  const relatedIds = selection.relatedIds.filter((id) => includesId(system.ways, id));
  return relatedIds.length === selection.relatedIds.length
    ? selection
    : { ...selection, relatedIds };
}

function pruneMultiSelection(
  system: TransitSystem,
  selection: EditorState['multiSelection'],
): EditorState['multiSelection'] {
  const remaining = selection.filter((item: MultiSelectItem) =>
    referenceExists(system, item.kind, item.id),
  );
  return remaining.length === selection.length ? selection : remaining;
}

function routeDraftIsLive(state: EditorState, system: TransitSystem): boolean {
  const draft = state.routeDraft;
  if (!draft || !includesId(system.ways, draft.lastAnchor.wayId)) return false;
  if (draft.spans.some((span) => !includesId(system.ways, span.wayId))) return false;
  if (!draft.returnFor) return true;
  const service = system.services.find((candidate) => candidate.id === draft.returnFor?.serviceId);
  return service?.path.id === draft.returnFor.patternId;
}

function retainedPatternId(state: EditorState, system: TransitSystem): string | null {
  return state.activePatternId &&
    system.services.some((service) => service.path.id === state.activePatternId)
    ? state.activePatternId
    : null;
}

function retainedArmedTerminus(
  state: EditorState,
  system: TransitSystem,
): EditorState['armedTerminus'] {
  const armed = state.armedTerminus;
  if (!armed) return null;
  const service = system.services.find((candidate) => candidate.id === armed.serviceId);
  return service?.path.id === armed.patternId && includesId(system.ways, armed.position.wayId)
    ? armed
    : null;
}

function retainedAddingServiceDraft(
  state: EditorState,
  system: TransitSystem,
): EditorState['addingServiceDraft'] {
  const draft = state.addingServiceDraft;
  return draft && includesId(system.lines, draft.lineId) ? draft : null;
}

/**
 * Drop transient pointers whose document records disappeared in a content edit.
 * Command-specific focus changes are applied before this common consistency pass.
 */
export function pruneTransientReferences(
  state: EditorState,
  system: TransitSystem,
): Partial<ReferentialTransientState> {
  return {
    selection: pruneSelection(system, state.selection),
    outlineHover: pruneSelection(system, state.outlineHover),
    activePatternId: retainedPatternId(state, system),
    armedTerminus: retainedArmedTerminus(state, system),
    multiSelection: pruneMultiSelection(system, state.multiSelection),
    activeWayId: retainedId(state.activeWayId, system.ways),
    routeDraft: routeDraftIsLive(state, system) ? state.routeDraft : null,
    placingFacilityForGroupId: retainedId(state.placingFacilityForGroupId, system.groups),
    pickingMemberForGroupId: retainedId(state.pickingMemberForGroupId, system.groups),
    addingServiceDraft: retainedAddingServiceDraft(state, system),
    focusNameStopId: retainedId(state.focusNameStopId, system.stops),
  };
}
