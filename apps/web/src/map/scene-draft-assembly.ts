import type {
  RenderDomainIdentity,
  RenderFeatureId,
  RenderIdentityIndex,
  SystemFeatureSourceId,
} from '@transitmapper/core/render/render-identity';
import {
  emptyRenderSceneStats,
  renderSceneRevision,
  type RenderFeatureCollection,
  type RenderScene,
  type RenderSceneStats,
} from '@transitmapper/core/render/render-scene';
import type { IncrementalLiveSceneState } from './accepted-scene-state';
import {
  addDomainFeature,
  canonicalDomainMap,
  EMPTY_RENDER_COLLECTION,
  renderSourceId,
  type IncrementalSourceState,
} from './scene-source-state';
import type { SceneDraft } from './scene-draft-types';
import type { MapSystemFeatureSourceId } from './system-feature-sources';

interface AssembleRenderSceneInput {
  readonly revision: string;
  readonly states: ReadonlyMap<SystemFeatureSourceId, IncrementalSourceState>;
  readonly hitFeatures: RenderFeatureCollection;
  readonly stats?: RenderSceneStats;
}

function aggregateSceneStats(
  states: ReadonlyMap<SystemFeatureSourceId, IncrementalSourceState>,
): RenderSceneStats {
  const stats = emptyRenderSceneStats();
  for (const state of states.values()) {
    stats.visibleFeatureCount += state.stats.visualFeatureCount;
    stats.generatedVisualFeatureCount += state.stats.visualFeatureCount;
    stats.generatedHitFeatureCount += state.stats.hitFeatureCount;
    stats.generatedVertexCount += state.stats.visualVertexCount + state.stats.hitVertexCount;
  }
  stats.candidateFeatureCount = stats.generatedVisualFeatureCount + stats.generatedHitFeatureCount;
  return stats;
}

/** Presents the complete retained identity index without rebuilding it for each
 * source-local projection. Ordinary feature-state lookup resolves one domain
 * from the small source summary set; full iteration materializes only on demand. */
class SourceDomainFeatureMap implements ReadonlyMap<
  RenderDomainIdentity,
  readonly RenderFeatureId[]
> {
  readonly [Symbol.toStringTag] = 'Map';
  private materialized: ReadonlyMap<RenderDomainIdentity, readonly RenderFeatureId[]> | null = null;
  private readonly resolved = new Map<RenderDomainIdentity, readonly RenderFeatureId[]>();

  constructor(
    private readonly states: ReadonlyMap<SystemFeatureSourceId, IncrementalSourceState>,
  ) {}

  get size(): number {
    return this.materialize().size;
  }

  get(domain: RenderDomainIdentity): readonly RenderFeatureId[] | undefined {
    const cached = this.resolved.get(domain);
    if (cached) return cached;
    let featureIds: readonly RenderFeatureId[] | undefined;
    for (const state of this.states.values()) {
      const sourceFeatureIds = state.domains.get(domain);
      if (!sourceFeatureIds) continue;
      featureIds = featureIds ? [...featureIds, ...sourceFeatureIds].sort() : sourceFeatureIds;
    }
    if (!featureIds) return undefined;
    this.resolved.set(domain, featureIds);
    return featureIds;
  }

  has(domain: RenderDomainIdentity): boolean {
    return this.get(domain) !== undefined;
  }

  entries(): MapIterator<[RenderDomainIdentity, readonly RenderFeatureId[]]> {
    return this.materialize().entries();
  }

  keys(): MapIterator<RenderDomainIdentity> {
    return this.materialize().keys();
  }

  values(): MapIterator<readonly RenderFeatureId[]> {
    return this.materialize().values();
  }

  forEach(
    callbackfn: (
      value: readonly RenderFeatureId[],
      key: RenderDomainIdentity,
      map: ReadonlyMap<RenderDomainIdentity, readonly RenderFeatureId[]>,
    ) => void,
    thisArg?: unknown,
  ): void {
    for (const [domain, featureIds] of this.materialize()) {
      callbackfn.call(thisArg, featureIds, domain, this);
    }
  }

  [Symbol.iterator](): MapIterator<[RenderDomainIdentity, readonly RenderFeatureId[]]> {
    return this.entries();
  }

  private materialize(): ReadonlyMap<RenderDomainIdentity, readonly RenderFeatureId[]> {
    if (this.materialized) return this.materialized;
    const domains = new Map<RenderDomainIdentity, RenderFeatureId[]>();
    for (const state of this.states.values()) {
      for (const [domain, featureIds] of state.domains) {
        for (const featureId of featureIds) addDomainFeature(domains, domain, featureId);
      }
    }
    this.materialized = canonicalDomainMap(domains);
    return this.materialized;
  }
}

function assembleRenderScene(input: AssembleRenderSceneInput): RenderScene {
  const featuresBySource = new Map<SystemFeatureSourceId, RenderFeatureCollection>();
  for (const sourceId of [...input.states.keys()].sort()) {
    featuresBySource.set(sourceId, input.states.get(sourceId)?.visual ?? EMPTY_RENDER_COLLECTION);
  }
  const identityIndex: RenderIdentityIndex = {
    renderFeatureIdsByDomain: new SourceDomainFeatureMap(input.states),
  };
  return {
    revision: renderSceneRevision(input.revision),
    featuresBySource,
    hitFeatures: input.hitFeatures,
    identityIndex,
    stats: input.stats ?? aggregateSceneStats(input.states),
  };
}

export function completeStagedLiveScene(
  revision: string,
  states: ReadonlyMap<SystemFeatureSourceId, IncrementalSourceState>,
  hitFeatures: RenderFeatureCollection,
  stats?: RenderSceneStats,
): RenderScene {
  return assembleRenderScene({
    revision,
    states,
    hitFeatures,
    ...(stats ? { stats } : {}),
  });
}

export function resolveScopedReplacementDomains(
  requestedMapSources: readonly MapSystemFeatureSourceId[],
  replacements: ReadonlyMap<MapSystemFeatureSourceId, readonly RenderDomainIdentity[]>,
): ReadonlyMap<SystemFeatureSourceId, readonly RenderDomainIdentity[]> {
  const requested = new Set(requestedMapSources);
  const valid =
    replacements.size === requested.size &&
    [...replacements.keys()].every((sourceId) => requested.has(sourceId)) &&
    requestedMapSources.every((sourceId) => replacements.has(sourceId));
  if (!valid) {
    throw new Error('Scoped replacement domains must match the requested renderer sources.');
  }
  const scoped = new Map<SystemFeatureSourceId, readonly RenderDomainIdentity[]>();
  for (const sourceId of requestedMapSources) {
    const domains = replacements.get(sourceId) ?? [];
    if (domains.length === 0) {
      throw new Error(`Scoped replacement domains must not be empty for source: ${sourceId}`);
    }
    scoped.set(renderSourceId(sourceId), domains);
  }
  return scoped;
}

function sourceVersionMatches(
  base: IncrementalSourceState | undefined,
  current: IncrementalSourceState | undefined,
): boolean {
  return (
    base === current ||
    (base !== undefined &&
      current !== undefined &&
      base.featureIdSet.size === 0 &&
      current.featureIdSet.size === 0)
  );
}

function unrequestedHitsChanged(
  base: IncrementalSourceState,
  current: IncrementalSourceState | undefined,
): boolean {
  if (base.hits === current?.hits) return false;
  return base.stats.hitFeatureCount > 0 || (current?.stats.hitFeatureCount ?? 0) > 0;
}

/**
 * Rebase only disjoint source changes. A changed requested source would make
 * the prepared patch relative to the wrong accepted scene and is stale.
 */
export function rebaseSceneDraft(
  prepared: SceneDraft,
  current: IncrementalLiveSceneState | null,
): IncrementalLiveSceneState {
  if (current === prepared.baseState) return prepared.state;
  if (!current) throw new Error('Prepared live render scene base state changed.');
  const requested = new Set(prepared.requestedSourceIds);
  for (const sourceId of prepared.requestedSourceIds) {
    if (
      !sourceVersionMatches(
        prepared.baseSourceStates.get(sourceId),
        current.sourceStates.get(sourceId),
      )
    ) {
      throw new Error(`Prepared live render scene requested source changed: ${sourceId}`);
    }
  }
  for (const [sourceId, base] of prepared.baseSourceStates) {
    if (
      !requested.has(sourceId) &&
      unrequestedHitsChanged(base, current.sourceStates.get(sourceId))
    ) {
      throw new Error(`Prepared live render scene unrequested hit source changed: ${sourceId}`);
    }
  }
  const states = new Map(current.sourceStates);
  for (const sourceId of prepared.requestedSourceIds) {
    const next = prepared.state.sourceStates.get(sourceId);
    if (!next) throw new Error(`Prepared live render scene source is unavailable: ${sourceId}`);
    states.set(sourceId, next);
  }
  const scene = completeStagedLiveScene(
    prepared.scene.revision,
    states,
    prepared.scene.hitFeatures,
  );
  return { sourceStates: states, scene };
}
