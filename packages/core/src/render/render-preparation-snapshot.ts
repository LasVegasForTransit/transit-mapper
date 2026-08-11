import type {
  PreparedSnapshotInternals,
  RenderPreparationSnapshotDraft,
} from './render-preparation-plan-builder';
import type {
  RenderPreparationDiagnostics,
  RenderPreparedSnapshot,
} from './render-preparation-types';

const internalsBySnapshot = new WeakMap<RenderPreparedSnapshot, PreparedSnapshotInternals>();

export function preparedSnapshotInternals(
  snapshot: RenderPreparedSnapshot,
): PreparedSnapshotInternals {
  const internals = internalsBySnapshot.get(snapshot);
  if (!internals) throw new Error('Unknown renderer prepared snapshot');
  return internals;
}

export function publishRenderPreparedSnapshot(
  draft: RenderPreparationSnapshotDraft,
  diagnostics: RenderPreparationDiagnostics,
): RenderPreparedSnapshot {
  const snapshot: RenderPreparedSnapshot = Object.freeze({
    kind: 'render-prepared-snapshot' as const,
    revision: draft.revision,
    generation: draft.generation,
    system: draft.system,
    presentation: draft.presentation,
    ...(draft.candidateEnvelope ? { candidateEnvelope: draft.candidateEnvelope } : {}),
    categories: draft.categories,
    candidates: draft.candidates,
    invalidation: draft.invalidation,
    ...(draft.fullProjectionReason ? { fullProjectionReason: draft.fullProjectionReason } : {}),
    waysById: draft.waysById,
    nodesById: draft.nodesById,
    servicesById: draft.servicesById,
    stationsById: draft.stationsById,
    namedWaysById: draft.namedWaysById,
    facilitiesById: draft.facilitiesById,
    groupsById: draft.groupsById,
    servicesByWay: draft.servicesByWay,
    serviceBundleSlots: draft.serviceBundleSlots,
    wayIdsByStation: draft.wayIdsByStation,
    modeIds: draft.modeIds,
    wayTypeIds: draft.wayTypeIds,
    diagnostics,
  });
  internalsBySnapshot.set(snapshot, draft.internals);
  return snapshot;
}
