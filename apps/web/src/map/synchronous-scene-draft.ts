/**
 * Synchronous scene drafting used by small editor-only updates and tests.
 *
 * The live committed renderer uses the resumable scene-draft pipeline. This
 * path shares the same source-state and ownership rules so the two cannot
 * produce different accepted scenes.
 */
import type { SystemFeatures } from '@transitmapper/core/render/buildFeatures';
import {
  emptyRenderIdentityIndex,
  type RenderDomainIdentity,
  type RenderFeatureId,
  type SystemFeatureSourceId,
} from '@transitmapper/core/render/render-identity';
import {
  diffRenderScenes,
  type RenderScenePatch,
} from '@transitmapper/core/render/render-scene-diff';
import {
  emptyRenderSceneStats,
  renderSceneRevision,
  type RenderFeatureCollection,
  type RenderScene,
  type RenderSceneStats,
} from '@transitmapper/core/render/render-scene';
import {
  canonicalRequestedSources,
  EMPTY_RENDER_COLLECTION,
  initialSourceStates,
  normalizedRequestedStates,
  renderSourceId,
  validateUnrequestedFeatureOwnership,
  type IncrementalSceneOperationCounts,
  type IncrementalSourceState,
} from './scene-source-state';
import { mergeScopedSourceState } from './synchronous-source-update';
import { assembleRenderScene } from './scene-draft-assembly';
import type { MapSystemFeatureSourceId } from './system-feature-sources';

export type { IncrementalSceneOperationCounts } from './scene-source-state';

export interface IncrementalLiveSceneState {
  sourceStates: ReadonlyMap<SystemFeatureSourceId, IncrementalSourceState>;
  scene: RenderScene;
}

export interface BuildIncrementalLiveSceneInput {
  previous: IncrementalLiveSceneState | null;
  revision: string;
  features: SystemFeatures;
  sourceIds: readonly MapSystemFeatureSourceId[];
  replacementDomainsBySource?: ReadonlyMap<
    MapSystemFeatureSourceId,
    readonly RenderDomainIdentity[]
  >;
  stats?: RenderSceneStats;
  counts?: IncrementalSceneOperationCounts;
}

export interface BuildIncrementalLiveSceneResult {
  state: IncrementalLiveSceneState;
  patch: RenderScenePatch;
  requestedSourceIds: readonly SystemFeatureSourceId[];
}

export interface IncrementalFeatureStateTarget {
  sourceId: SystemFeatureSourceId;
  featureId: RenderFeatureId;
}

function subsetScene(
  revision: string,
  states: ReadonlyMap<SystemFeatureSourceId, IncrementalSourceState>,
  sourceIds: readonly SystemFeatureSourceId[],
  includedFeatureIds?: ReadonlyMap<SystemFeatureSourceId, ReadonlySet<RenderFeatureId>>,
): RenderScene {
  const included = (sourceId: SystemFeatureSourceId, featureId: RenderFeatureId): boolean =>
    includedFeatureIds?.get(sourceId)?.has(featureId) ?? true;
  const hitFeatures = sourceIds.flatMap((sourceId) =>
    (states.get(sourceId)?.hits.features ?? []).filter((feature) => included(sourceId, feature.id)),
  );
  hitFeatures.sort((left, right) => left.id.localeCompare(right.id));
  return {
    revision: renderSceneRevision(revision),
    featuresBySource: new Map(
      sourceIds.map((sourceId) => [
        sourceId,
        includedFeatureIds
          ? {
              type: 'FeatureCollection',
              features: (states.get(sourceId)?.visual.features ?? []).filter((feature) =>
                included(sourceId, feature.id),
              ),
            }
          : (states.get(sourceId)?.visual ?? EMPTY_RENDER_COLLECTION),
      ]),
    ),
    hitFeatures: { type: 'FeatureCollection', features: hitFeatures },
    identityIndex: emptyRenderIdentityIndex(),
    stats: emptyRenderSceneStats(),
  };
}

function scopedReplacementDomains(
  requestedMapSources: readonly MapSystemFeatureSourceId[],
  replacementDomainsBySource: ReadonlyMap<
    MapSystemFeatureSourceId,
    readonly RenderDomainIdentity[]
  >,
): ReadonlyMap<SystemFeatureSourceId, readonly RenderDomainIdentity[]> {
  const requested = new Set<MapSystemFeatureSourceId>(requestedMapSources);
  const valid =
    replacementDomainsBySource.size === requested.size &&
    [...replacementDomainsBySource.keys()].every((sourceId) => requested.has(sourceId)) &&
    requestedMapSources.every((sourceId) => replacementDomainsBySource.has(sourceId));
  if (!valid) {
    throw new Error('Scoped replacement domains must match the requested renderer sources.');
  }

  const scoped = new Map<SystemFeatureSourceId, readonly RenderDomainIdentity[]>();
  for (const sourceId of requestedMapSources) {
    const domains = [...new Set(replacementDomainsBySource.get(sourceId) ?? [])].sort();
    if (domains.length === 0) {
      throw new Error(`Scoped replacement domains must not be empty for source: ${sourceId}`);
    }
    scoped.set(renderSourceId(sourceId), domains);
  }
  return scoped;
}

function completeHitCollection(
  previous: IncrementalLiveSceneState | null,
  states: ReadonlyMap<SystemFeatureSourceId, IncrementalSourceState>,
  patch: RenderScenePatch,
): RenderFeatureCollection {
  if (previous && patch.hitFeatures.add.length === 0 && patch.hitFeatures.remove.length === 0) {
    return previous.scene.hitFeatures;
  }
  const features = [...states.values()].flatMap((state) => state.hits.features);
  features.sort((left, right) => left.id.localeCompare(right.id));
  return { type: 'FeatureCollection', features };
}

interface RequestedStateMerge {
  nextStates: ReadonlyMap<SystemFeatureSourceId, IncrementalSourceState>;
  previousIncludedFeatureIds?: ReadonlyMap<SystemFeatureSourceId, ReadonlySet<RenderFeatureId>>;
  nextDiffStates: ReadonlyMap<SystemFeatureSourceId, IncrementalSourceState>;
  diffedFeatureCount: number;
}

function mergeFullRequestedStates(
  previousStates: ReadonlyMap<SystemFeatureSourceId, IncrementalSourceState>,
  requestedStates: ReadonlyMap<SystemFeatureSourceId, IncrementalSourceState>,
): RequestedStateMerge {
  const nextStates = new Map(previousStates);
  let diffedFeatureCount = 0;
  for (const [sourceId, state] of requestedStates) {
    nextStates.set(sourceId, state);
    diffedFeatureCount +=
      (previousStates.get(sourceId)?.featureIds.length ?? 0) + state.featureIds.length;
  }
  return { nextStates, nextDiffStates: nextStates, diffedFeatureCount };
}

function sourceStateOrThrow(
  states: ReadonlyMap<SystemFeatureSourceId, IncrementalSourceState>,
  sourceId: SystemFeatureSourceId,
): IncrementalSourceState {
  const state = states.get(sourceId);
  if (!state) throw new Error(`Scoped renderer source state is unavailable: ${sourceId}`);
  return state;
}

function mergeScopedRequestedStates(
  previousStates: ReadonlyMap<SystemFeatureSourceId, IncrementalSourceState>,
  requestedStates: ReadonlyMap<SystemFeatureSourceId, IncrementalSourceState>,
  requestedSourceIds: readonly SystemFeatureSourceId[],
  replacementDomains: ReadonlyMap<SystemFeatureSourceId, readonly RenderDomainIdentity[]>,
): RequestedStateMerge {
  const nextStates = new Map(previousStates);
  const previousIncludedFeatureIds = new Map<SystemFeatureSourceId, ReadonlySet<RenderFeatureId>>();
  let diffedFeatureCount = 0;
  for (const sourceId of requestedSourceIds) {
    const previous = sourceStateOrThrow(previousStates, sourceId);
    const partial = sourceStateOrThrow(requestedStates, sourceId);
    const merged = mergeScopedSourceState(
      previous,
      partial,
      replacementDomains.get(sourceId) ?? [],
    );
    nextStates.set(sourceId, merged.state);
    previousIncludedFeatureIds.set(sourceId, merged.replacedFeatureIds);
    diffedFeatureCount += merged.replacedFeatureIds.size + partial.featureIds.length;
  }
  return {
    nextStates,
    previousIncludedFeatureIds,
    nextDiffStates: requestedStates,
    diffedFeatureCount,
  };
}

function mergeRequestedStates(
  previousStates: ReadonlyMap<SystemFeatureSourceId, IncrementalSourceState>,
  requestedStates: ReadonlyMap<SystemFeatureSourceId, IncrementalSourceState>,
  requestedSourceIds: readonly SystemFeatureSourceId[],
  replacementDomains: ReadonlyMap<SystemFeatureSourceId, readonly RenderDomainIdentity[]> | null,
): RequestedStateMerge {
  return replacementDomains
    ? mergeScopedRequestedStates(
        previousStates,
        requestedStates,
        requestedSourceIds,
        replacementDomains,
      )
    : mergeFullRequestedStates(previousStates, requestedStates);
}

function validateMergedFeatureOwnership(
  states: ReadonlyMap<SystemFeatureSourceId, IncrementalSourceState>,
  requestedStates: ReadonlyMap<SystemFeatureSourceId, IncrementalSourceState>,
): void {
  for (const requestedState of requestedStates.values()) {
    for (const featureId of requestedState.featureIds) {
      let owner: SystemFeatureSourceId | null = null;
      for (const state of states.values()) {
        if (!state.featureIdSet.has(featureId)) continue;
        if (owner) throw new Error(`Duplicate render feature ID across scene: ${featureId}`);
        owner = state.sourceId;
      }
    }
  }
}

export function buildIncrementalLiveScene(
  input: BuildIncrementalLiveSceneInput,
): BuildIncrementalLiveSceneResult {
  const requestedMapSources = canonicalRequestedSources(input.sourceIds);
  const requestedSourceIds = requestedMapSources.map(renderSourceId);
  const previousStates = input.previous?.sourceStates ?? initialSourceStates();
  const replacementDomains = input.replacementDomainsBySource
    ? scopedReplacementDomains(requestedMapSources, input.replacementDomainsBySource)
    : null;
  const requestedStates = normalizedRequestedStates(
    {
      revision: input.revision,
      features: input.features,
      ...(input.counts ? { counts: input.counts } : {}),
    },
    requestedMapSources,
  );
  validateUnrequestedFeatureOwnership(previousStates, requestedStates);
  const merged = mergeRequestedStates(
    previousStates,
    requestedStates,
    requestedSourceIds,
    replacementDomains,
  );
  validateMergedFeatureOwnership(merged.nextStates, requestedStates);

  const previousSubset = subsetScene(
    input.previous?.scene.revision ?? input.revision,
    previousStates,
    requestedSourceIds,
    merged.previousIncludedFeatureIds,
  );
  const nextSubset = subsetScene(input.revision, merged.nextDiffStates, requestedSourceIds);
  const patch = diffRenderScenes(previousSubset, nextSubset);
  if (input.counts) {
    input.counts.diffedSourceCount += requestedSourceIds.length;
    input.counts.diffedFeatureCount += merged.diffedFeatureCount;
  }

  const scene = assembleRenderScene({
    revision: input.revision,
    states: merged.nextStates,
    hitFeatures: completeHitCollection(input.previous, merged.nextStates, patch),
    ...(input.stats ? { stats: input.stats } : {}),
  });
  return {
    state: { sourceStates: merged.nextStates, scene },
    patch,
    requestedSourceIds,
  };
}

export function visualTargetsForDomain(
  state: IncrementalLiveSceneState | null,
  domainIdentity: RenderDomainIdentity,
): readonly IncrementalFeatureStateTarget[] {
  if (!state) return [];
  const targets: IncrementalFeatureStateTarget[] = [];
  for (const sourceState of state.sourceStates.values()) {
    for (const featureId of sourceState.visualDomains.get(domainIdentity) ?? []) {
      targets.push({ sourceId: sourceState.sourceId, featureId });
    }
  }
  return targets;
}
