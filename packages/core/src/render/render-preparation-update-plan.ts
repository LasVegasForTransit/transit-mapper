import { resolveWayPath } from '../model/geo';
import type { NamedWay, Stop, Way } from '../model/system';
import type { RenderDependencyClosure } from './dependency-index';
import { nearWaysForStops } from './featureMemo';
import {
  emptyPreparedClosure,
  mergePreparedClosures,
  preparedWayClosure,
  type PreparedDependencyState,
} from './render-preparation-dependencies';
import { updateRenderPreparationMap } from './render-preparation-map';
import { addIncrementalPreparedCandidatePlan } from './render-preparation-incremental-candidates';
import { samePreparedCandidateQuery } from './render-preparation-candidate-query';
import { nearWaySearchBounds } from './render-preparation-station-proximity';
import type {
  PreparedSnapshotInternals,
  RenderPreparationPlanBuilder,
} from './render-preparation-plan-builder';
import { preparedSnapshotInternals } from './render-preparation-snapshot';
import type {
  PlanRenderPreparationOptions,
  RenderPreparationPatch,
  RenderPreparedSnapshot,
} from './render-preparation-types';
import type { RenderViewportCandidateSets } from './render-viewport-candidates';
import {
  createPreparedViewportDraft,
  replaceAndQueryViewportOwners,
  type PreparedViewportDraft,
  type PreparedViewportState,
  type ViewportOwnerEntries,
} from './render-preparation-viewport';
import {
  finalizePreparedViewportState,
  preparedViewportCandidates,
  preparedViewportFinalizeOperationCount,
  queryPreparedViewportState,
} from './render-preparation-viewport-state';
import { addBasePreparedViewportQueries } from './render-preparation-viewport-plan';
import { corridorViewportEntries, type ViewportSpatialEntry } from './viewport-index-entries';
import type { RenderViewportCategory } from './viewport-index';

export interface AddPreparedTransitionPlanOptions {
  readonly builder: RenderPreparationPlanBuilder;
  readonly options: PlanRenderPreparationOptions;
  readonly categories: readonly RenderViewportCategory[];
  readonly generation: number;
  readonly current: RenderPreparedSnapshot;
}

interface IncrementalContext extends AddPreparedTransitionPlanOptions {
  readonly internals: PreparedSnapshotInternals;
  readonly patch: NonNullable<RenderPreparationPatch['ways']>;
  readonly changedIds: readonly string[];
  readonly changedLabelIds: ReadonlySet<string>;
  readonly categorySet: ReadonlySet<RenderViewportCategory>;
  readonly viewport: PreparedViewportDraft;
  readonly wayUpserts: ReadonlyMap<string, Way>;
  readonly wayRemovals: ReadonlySet<string>;
  readonly refreshAllCandidates: boolean;
  waysById: ReadonlyMap<string, Way>;
  wayRank: ReadonlyMap<string, number>;
  nextDependency: PreparedDependencyState;
  invalidation: RenderDependencyClosure;
}

function changedWayIds(patch: NonNullable<RenderPreparationPatch['ways']>): readonly string[] {
  return [...new Set([...(patch.upsert ?? []).map(({ id }) => id), ...(patch.removeIds ?? [])])];
}

function createIncrementalContext(input: AddPreparedTransitionPlanOptions): IncrementalContext {
  const patch = input.options.patch?.ways;
  if (!patch) throw new Error('Incremental renderer preparation requires an explicit way patch.');
  const internals = preparedSnapshotInternals(input.current);
  const changedIds = changedWayIds(patch);
  return {
    ...input,
    internals,
    patch,
    changedIds,
    changedLabelIds: new Set(
      changedIds.flatMap((id) => internals.dependency.namedWayIdsByWay.get(id) ?? []),
    ),
    categorySet: new Set(input.categories),
    viewport: createPreparedViewportDraft(internals.viewport),
    wayUpserts: new Map((patch.upsert ?? []).map((way) => [way.id, way])),
    wayRemovals: new Set(patch.removeIds ?? []),
    refreshAllCandidates: !samePreparedCandidateQuery(input.current, input.options),
    waysById: input.current.waysById,
    wayRank: internals.wayRank,
    nextDependency: internals.dependency,
    invalidation: emptyPreparedClosure(),
  };
}

function addDomainAndClosure(context: IncrementalContext): void {
  const { builder, changedIds, internals } = context;
  builder.runtime.operations.dependencyEntityVisits += changedIds.length;
  builder.addUnit('dependency', changedIds.length, () => {
    context.invalidation = preparedWayClosure(internals.dependency, changedIds, internals);
  });
  builder.runtime.operations.domainEntityVisits += changedIds.length;
  builder.runtime.operations.overlayWrites += changedIds.length;
  builder.addUnit('domain', changedIds.length, () => {
    context.waysById = updateRenderPreparationMap(
      context.current.waysById,
      context.wayUpserts,
      context.wayRemovals,
    );
    const rankUpserts = new Map<string, number>();
    let nextRank = context.current.waysById.size;
    for (const id of context.wayUpserts.keys()) {
      if (!internals.wayRank.has(id)) rankUpserts.set(id, nextRank++);
    }
    context.wayRank = updateRenderPreparationMap(internals.wayRank, rankUpserts, new Set());
  });
}

interface StopUpdateDraft {
  readonly stopIdsByWay: Map<string, Set<string>>;
  readonly stopWayUpdates: Map<string, readonly string[]>;
}

function affectedStops(context: IncrementalContext): readonly Stop[] {
  const priorIds = new Set(
    context.changedIds.flatMap((id) => context.internals.dependency.stopsByWay.get(id) ?? []),
  );
  const search = nearWaySearchBounds([...context.wayUpserts.values()]);
  if (search) {
    for (const id of queryPreparedViewportState(
      context.internals.viewport,
      'stop',
      search.bounds,
      search.marginDegrees,
    )) {
      priorIds.add(id);
    }
  }
  return [...priorIds].flatMap((id) => {
    const stop = context.current.stopsById.get(id);
    return stop ? [stop] : [];
  });
}

function updateStopMembership(context: IncrementalContext, draft: StopUpdateDraft): void {
  const stops = affectedStops(context);
  context.builder.runtime.operations.dependencyEntityVisits += stops.length;
  const changedWays = [...context.wayUpserts.values()];
  const nearby = changedWays.length
    ? nearWaysForStops(stops as Stop[], changedWays)
    : stops.map(() => [] as string[]);
  for (let index = 0; index < stops.length; index++) {
    const stop = stops[index];
    const oldIds = context.internals.dependency.wayIdsByStop.get(stop.id) ?? [];
    const retained = oldIds.filter((id) => !draft.stopIdsByWay.has(id));
    const changed = context.changedIds.filter(
      (id) => nearby[index].includes(id) || stop.anchors.some(({ wayId }) => wayId === id),
    );
    for (const id of changed) draft.stopIdsByWay.get(id)?.add(stop.id);
    const nextIds = [...retained, ...changed];
    if (
      nextIds.length !== oldIds.length ||
      nextIds.some((id, position) => id !== oldIds[position])
    ) {
      draft.stopWayUpdates.set(stop.id, nextIds);
    }
  }
}

function addStopUpdates(context: IncrementalContext): void {
  const draft: StopUpdateDraft = {
    stopIdsByWay: new Map(context.changedIds.map((id) => [id, new Set<string>()])),
    stopWayUpdates: new Map(),
  };
  context.builder.addUnit(
    'dependency',
    context.changedIds.length,
    () => updateStopMembership(context, draft),
    'incremental-stop-proximity',
  );
  context.builder.addUnit('dependency', context.changedIds.length, () => {
    context.nextDependency = {
      ...context.internals.dependency,
      stopsByWay: updateRenderPreparationMap(
        context.internals.dependency.stopsByWay,
        new Map([...draft.stopIdsByWay].map(([id, stopIds]) => [id, [...stopIds]])),
        new Set(),
      ),
      wayIdsByStop: updateRenderPreparationMap(
        context.internals.dependency.wayIdsByStop,
        draft.stopWayUpdates,
        new Set(),
      ),
    };
  });
}

function replaceViewportOwners(
  context: IncrementalContext,
  category: RenderViewportCategory,
  owners: () => readonly ViewportOwnerEntries[],
): void {
  if (!context.categorySet.has(category)) return;
  const resolvedOwners = owners();
  if (resolvedOwners.length === 0) return;
  context.builder.runtime.operations.viewportEntityBuilds += resolvedOwners.length;
  context.builder.runtime.operations.viewportSegmentQueries++;
  context.builder.runtime.operations.overlayWrites += resolvedOwners.length;
  context.builder.addUnit('viewport-build', resolvedOwners.length, () => {
    replaceAndQueryViewportOwners({
      draft: context.viewport,
      category,
      owners: resolvedOwners,
      generation: context.generation,
      presentation: context.options.presentation,
      candidateEnvelope: context.options.candidateEnvelope,
    });
  });
}

function labelEntries(
  namedWay: NamedWay,
  waysById: ReadonlyMap<string, Way>,
): ViewportSpatialEntry[] {
  return [
    {
      id: namedWay.id,
      paths: namedWay.wayIds.flatMap((id) => {
        const way = waysById.get(id);
        return way ? [resolveWayPath(way)] : [];
      }),
    },
  ];
}

function addViewportUpdates(context: IncrementalContext): void {
  replaceViewportOwners(context, 'corridor', () =>
    context.changedIds.map((id) => {
      const way = context.wayUpserts.get(id);
      return { ownerId: id, entries: way ? corridorViewportEntries([way]) : [] };
    }),
  );
  replaceViewportOwners(context, 'label', () =>
    [...context.changedLabelIds].map((id) => {
      const namedWay = context.current.namedWaysById.get(id);
      return {
        ownerId: id,
        entries: namedWay ? labelEntries(namedWay, context.waysById) : [],
      };
    }),
  );
}

function addViewportCandidateRefresh(context: IncrementalContext): void {
  if (!context.refreshAllCandidates) return;
  addBasePreparedViewportQueries({
    builder: context.builder,
    viewport: context.viewport,
    state: context.internals.viewport,
    categories: context.categories,
    presentation: context.options.presentation,
    candidateEnvelope: context.options.candidateEnvelope,
  });
}

function addIncrementalFinalization(context: IncrementalContext): void {
  let candidates: RenderViewportCandidateSets = context.current.candidates;
  if (context.refreshAllCandidates) {
    context.builder.addUnit(
      'finalize',
      1,
      () => {
        candidates = preparedViewportCandidates(context.viewport, context.categorySet);
      },
      'candidate-refresh',
    );
  } else {
    addIncrementalPreparedCandidatePlan({
      builder: context.builder,
      current: context.current.candidates,
      additions: () => preparedViewportCandidates(context.viewport, context.categorySet),
      changedWayIds: new Set(context.changedIds),
      changedLabelIds: context.changedLabelIds,
      rankForId: (id) =>
        context.viewport.rankUpdates.get(id) ?? context.internals.viewport.rankById.get(id),
      accept: (resolved) => {
        candidates = resolved;
      },
    });
  }
  let viewportState: PreparedViewportState = context.internals.viewport;
  context.builder.addUnit(
    'finalize',
    preparedViewportFinalizeOperationCount(context.viewport),
    () => {
      viewportState = finalizePreparedViewportState(context.viewport, 'incremental');
    },
    'viewport-state',
  );
  context.builder.addUnit('finalize', 1, () => {
    const nextClosure = preparedWayClosure(context.nextDependency, context.changedIds, {
      ...context.internals,
      wayRank: context.wayRank,
    });
    context.builder.runtime.snapshot = {
      revision: context.options.revision,
      generation: context.generation,
      system: context.options.system,
      presentation: context.options.presentation,
      ...(context.options.candidateEnvelope
        ? { candidateEnvelope: context.options.candidateEnvelope }
        : {}),
      categories: context.categories,
      candidates,
      invalidation: mergePreparedClosures(context.invalidation, nextClosure),
      waysById: context.waysById,
      nodesById: context.current.nodesById,
      servicesById: context.current.servicesById,
      stopsById: context.current.stopsById,
      stationsById: context.current.stationsById,
      namedWaysById: context.current.namedWaysById,
      facilitiesById: context.current.facilitiesById,
      groupsById: context.current.groupsById,
      servicesByWay: context.current.servicesByWay,
      serviceBundleOrdering: context.current.serviceBundleOrdering,
      wayIdsByStop: context.nextDependency.wayIdsByStop,
      modeIds: context.current.modeIds,
      wayTypeIds: context.current.wayTypeIds,
      internals: {
        ...context.internals,
        dependency: context.nextDependency,
        viewport: viewportState,
        wayRank: context.wayRank,
      },
    };
  });
}

export function addIncrementalPreparationPlan(input: AddPreparedTransitionPlanOptions): void {
  const context = createIncrementalContext(input);
  addDomainAndClosure(context);
  addStopUpdates(context);
  addViewportUpdates(context);
  addViewportCandidateRefresh(context);
  addIncrementalFinalization(context);
}

export function addCameraPreparationPlan(input: AddPreparedTransitionPlanOptions): void {
  const internals = preparedSnapshotInternals(input.current);
  const viewport = createPreparedViewportDraft(internals.viewport);
  const categorySet = new Set(input.categories);
  addBasePreparedViewportQueries({
    builder: input.builder,
    viewport,
    state: internals.viewport,
    categories: input.categories,
    presentation: input.options.presentation,
    candidateEnvelope: input.options.candidateEnvelope,
  });
  input.builder.addUnit('finalize', 1, () => {
    input.builder.runtime.snapshot = {
      revision: input.options.revision,
      generation: input.generation,
      system: input.options.system,
      presentation: input.options.presentation,
      ...(input.options.candidateEnvelope
        ? { candidateEnvelope: input.options.candidateEnvelope }
        : {}),
      categories: input.categories,
      candidates: preparedViewportCandidates(viewport, categorySet),
      invalidation: emptyPreparedClosure(),
      waysById: input.current.waysById,
      nodesById: input.current.nodesById,
      servicesById: input.current.servicesById,
      stopsById: input.current.stopsById,
      stationsById: input.current.stationsById,
      namedWaysById: input.current.namedWaysById,
      facilitiesById: input.current.facilitiesById,
      groupsById: input.current.groupsById,
      servicesByWay: input.current.servicesByWay,
      serviceBundleOrdering: input.current.serviceBundleOrdering,
      wayIdsByStop: input.current.wayIdsByStop,
      modeIds: input.current.modeIds,
      wayTypeIds: input.current.wayTypeIds,
      internals,
    };
  });
}
