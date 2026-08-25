/**
 * Source-local representation retained between accepted RenderScenes.
 *
 * It stores visual and hit collections together with semantic ownership and
 * stable-ID indexes. Both synchronous compatibility code and resumable scene
 * drafting use this single definition.
 */
import type { Feature } from 'geojson';
import type { SystemFeatureName, SystemFeatures } from '@transitmapper/core/render/buildFeatures';
import type {
  RenderDomainIdentity,
  RenderFeatureId,
  SystemFeatureSourceId,
} from '@transitmapper/core/render/render-identity';
import type {
  RenderFeature,
  RenderFeatureCollection,
  RenderScene,
} from '@transitmapper/core/render/render-scene';
import { createSystemRenderScene } from '@transitmapper/core/render/system-render-scene';
import {
  ALL_SYSTEM_FEATURE_SOURCES,
  emptySystemFeatures,
  SYSTEM_FEATURE_NAME_BY_SOURCE,
  SYSTEM_FEATURE_SOURCE_BY_NAME,
  type MapSystemFeatureSourceId,
} from './system-feature-sources';
import { ResumableGeometryVertexCount } from './scene-draft-work';

export interface IncrementalSceneOperationCounts {
  normalizedSourceCount: number;
  normalizedFeatureCount: number;
  indexedFeatureCount: number;
  diffedSourceCount: number;
  diffedFeatureCount: number;
  comparedFeatureCount: number;
  comparisonUnitCount: number;
  comparisonStepCount: number;
  comparedValueCount: number;
  referenceEqualFeatureCount: number;
  authoritativeChangedFeatureCount: number;
  diffBypassedSourceCount: number;
}

export interface SourceFeatureStats {
  visualFeatureCount: number;
  visualVertexCount: number;
  hitFeatureCount: number;
  hitVertexCount: number;
}

export interface IncrementalSourceState {
  sourceId: SystemFeatureSourceId;
  visual: RenderFeatureCollection;
  hits: RenderFeatureCollection;
  domains: ReadonlyMap<RenderDomainIdentity, readonly RenderFeatureId[]>;
  visualDomains: ReadonlyMap<RenderDomainIdentity, readonly RenderFeatureId[]>;
  domainsByFeature: ReadonlyMap<RenderFeatureId, readonly RenderDomainIdentity[]>;
  featureIds: readonly RenderFeatureId[];
  featureIdSet: ReadonlySet<RenderFeatureId>;
  featuresById: ReadonlyMap<RenderFeatureId, RenderFeature>;
  /** Exact cached geometry size lets scoped removals update diagnostics without
   * reopening a potentially huge Multi* or GeometryCollection feature. */
  vertexCountByFeatureId?: ReadonlyMap<RenderFeatureId, number>;
  visualFeatureIdSet: ReadonlySet<RenderFeatureId>;
  hitFeatureIdSet: ReadonlySet<RenderFeatureId>;
  stats: SourceFeatureStats;
}

export interface NormalizeRequestedStatesInput {
  revision: string;
  features: SystemFeatures;
  counts?: IncrementalSceneOperationCounts;
}

export const EMPTY_RENDER_COLLECTION: RenderFeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

export function renderSourceId(sourceId: MapSystemFeatureSourceId): SystemFeatureSourceId {
  return SYSTEM_FEATURE_SOURCE_BY_NAME[SYSTEM_FEATURE_NAME_BY_SOURCE[sourceId]];
}

export function canonicalRequestedSources(
  sourceIds: readonly MapSystemFeatureSourceId[],
): MapSystemFeatureSourceId[] {
  const requested = new Set(sourceIds);
  return ALL_SYSTEM_FEATURE_SOURCES.filter((sourceId) => requested.has(sourceId));
}

function requestedFeatures(
  features: SystemFeatures,
  sourceIds: readonly MapSystemFeatureSourceId[],
): SystemFeatures {
  const requested = new Set<SystemFeatureName>(
    sourceIds.map((sourceId) => SYSTEM_FEATURE_NAME_BY_SOURCE[sourceId]),
  );
  const empty = emptySystemFeatures();
  const pick = <Name extends SystemFeatureName>(name: Name): SystemFeatures[Name] =>
    requested.has(name) ? features[name] : empty[name];
  return {
    ways: pick('ways'),
    services: pick('services'),
    stops: pick('stops'),
    handles: pick('handles'),
    serviceTermini: pick('serviceTermini'),
    footprints: pick('footprints'),
    platforms: pick('platforms'),
    facilities: pick('facilities'),
    physicalHandles: pick('physicalHandles'),
    lanes: pick('lanes'),
    laneMarkings: pick('laneMarkings'),
    laneArrows: pick('laneArrows'),
    serviceArrows: pick('serviceArrows'),
    junctions: pick('junctions'),
    connectors: pick('connectors'),
    wayLabels: pick('wayLabels'),
  };
}

export function addDomainFeature(
  domains: Map<RenderDomainIdentity, RenderFeatureId[]>,
  domain: RenderDomainIdentity,
  featureId: RenderFeatureId,
): void {
  const featureIds = domains.get(domain);
  if (featureIds) featureIds.push(featureId);
  else domains.set(domain, [featureId]);
}

export function canonicalDomainMap(
  domains: ReadonlyMap<RenderDomainIdentity, readonly RenderFeatureId[]>,
): ReadonlyMap<RenderDomainIdentity, readonly RenderFeatureId[]> {
  const canonical = new Map<RenderDomainIdentity, readonly RenderFeatureId[]>();
  for (const domain of [...domains.keys()].sort()) {
    canonical.set(domain, [...(domains.get(domain) ?? [])].sort());
  }
  return canonical;
}

function domainsByFeature(
  domains: ReadonlyMap<RenderDomainIdentity, readonly RenderFeatureId[]>,
): ReadonlyMap<RenderFeatureId, readonly RenderDomainIdentity[]> {
  const domainsByFeatureId = new Map<RenderFeatureId, RenderDomainIdentity[]>();
  for (const [domain, featureIds] of domains) {
    for (const featureId of featureIds) {
      const featureDomains = domainsByFeatureId.get(featureId);
      if (featureDomains) featureDomains.push(domain);
      else domainsByFeatureId.set(featureId, [domain]);
    }
  }
  return new Map(
    [...domainsByFeatureId.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([featureId, featureDomains]) => [featureId, featureDomains.sort()]),
  );
}

interface RequestedStateIndexes {
  domainsBySource: Map<SystemFeatureSourceId, Map<RenderDomainIdentity, RenderFeatureId[]>>;
  visualDomainsBySource: Map<SystemFeatureSourceId, Map<RenderDomainIdentity, RenderFeatureId[]>>;
}

interface RequestedFeatureOwners {
  sourceByFeatureId: ReadonlyMap<RenderFeatureId, SystemFeatureSourceId>;
  visualFeatureIds: ReadonlySet<RenderFeatureId>;
}

function requestedFeatureOwners(
  partialScene: RenderScene,
  requestedSourceIds: readonly SystemFeatureSourceId[],
  hitsBySource: ReadonlyMap<SystemFeatureSourceId, RenderFeatureCollection>,
): RequestedFeatureOwners {
  const sourceByFeatureId = new Map<RenderFeatureId, SystemFeatureSourceId>();
  const visualFeatureIds = new Set<RenderFeatureId>();
  for (const sourceId of requestedSourceIds) {
    for (const feature of partialScene.featuresBySource.get(sourceId)?.features ?? []) {
      sourceByFeatureId.set(feature.id, sourceId);
      visualFeatureIds.add(feature.id);
    }
    for (const feature of hitsBySource.get(sourceId)?.features ?? []) {
      sourceByFeatureId.set(feature.id, sourceId);
    }
  }
  return { sourceByFeatureId, visualFeatureIds };
}

function createRequestedStateIndexes(
  partialScene: RenderScene,
  requestedSourceIds: readonly SystemFeatureSourceId[],
  hitsBySource: ReadonlyMap<SystemFeatureSourceId, RenderFeatureCollection>,
): RequestedStateIndexes {
  const domainsBySource = new Map<
    SystemFeatureSourceId,
    Map<RenderDomainIdentity, RenderFeatureId[]>
  >();
  const visualDomainsBySource = new Map<
    SystemFeatureSourceId,
    Map<RenderDomainIdentity, RenderFeatureId[]>
  >();
  for (const sourceId of requestedSourceIds) {
    domainsBySource.set(sourceId, new Map());
    visualDomainsBySource.set(sourceId, new Map());
  }
  const owners = requestedFeatureOwners(partialScene, requestedSourceIds, hitsBySource);
  for (const [domain, featureIds] of partialScene.identityIndex.renderFeatureIdsByDomain) {
    for (const featureId of featureIds) {
      const sourceId = owners.sourceByFeatureId.get(featureId);
      if (!sourceId) throw new Error(`Requested feature has no renderer source: ${featureId}`);
      const domains = domainsBySource.get(sourceId);
      const visualDomains = visualDomainsBySource.get(sourceId);
      if (!domains || !visualDomains) {
        throw new Error(`Requested feature resolved to an unknown renderer source: ${sourceId}`);
      }
      addDomainFeature(domains, domain, featureId);
      if (owners.visualFeatureIds.has(featureId)) {
        addDomainFeature(visualDomains, domain, featureId);
      }
    }
  }
  return { domainsBySource, visualDomainsBySource };
}

function hitSourceId(feature: RenderFeatureCollection['features'][number]): SystemFeatureSourceId {
  const sourceId: unknown = feature.properties?.renderSourceId;
  if (typeof sourceId !== 'string' || sourceId.length === 0) {
    throw new Error(`Hit feature has no retained renderer source: ${feature.id}`);
  }
  return sourceId as SystemFeatureSourceId;
}

function partitionHits(
  partialScene: RenderScene,
  requestedSourceIds: readonly SystemFeatureSourceId[],
): ReadonlyMap<SystemFeatureSourceId, RenderFeatureCollection> {
  const requested = new Set(requestedSourceIds);
  const featuresBySource = new Map<SystemFeatureSourceId, RenderFeatureCollection['features']>(
    requestedSourceIds.map((sourceId) => [sourceId, []]),
  );
  for (const feature of partialScene.hitFeatures.features) {
    const sourceId = hitSourceId(feature);
    if (!requested.has(sourceId)) {
      throw new Error(`Hit feature resolved to an unrequested renderer source: ${sourceId}`);
    }
    const features = featuresBySource.get(sourceId);
    if (!features) throw new Error(`Hit feature has no source partition: ${sourceId}`);
    features.push(feature);
  }
  return new Map(
    requestedSourceIds.map((sourceId) => [
      sourceId,
      { type: 'FeatureCollection', features: featuresBySource.get(sourceId) ?? [] },
    ]),
  );
}

function sourceFeatureStats(
  visual: RenderFeatureCollection,
  hits: RenderFeatureCollection,
): SourceFeatureStats {
  const vertexCount = (features: readonly RenderFeature[]): number =>
    features.reduce((sum, feature) => sum + renderFeatureVertexCount(feature), 0);
  return {
    visualFeatureCount: visual.features.length,
    visualVertexCount: vertexCount(visual.features),
    hitFeatureCount: hits.features.length,
    hitVertexCount: vertexCount(hits.features),
  };
}

function renderFeatureVertexCount(feature: RenderFeature): number {
  const comparison = new ResumableGeometryVertexCount({
    id: `synchronous-feature-stats:${feature.id}`,
    geometry: feature.geometry,
    stepsPerUnit: 512,
  });
  for (;;) {
    const work = comparison.nextWork();
    if (!work) break;
    work.run();
  }
  return comparison.result();
}

export function requireRenderFeature(feature: Feature, label: string): RenderFeature {
  if (typeof feature.id !== 'string' || feature.id.trim().length === 0) {
    throw new Error(`Every feature requires a stable top-level string ID in ${label}.`);
  }
  return feature as RenderFeature;
}

export function normalizedRequestedStates(
  input: NormalizeRequestedStatesInput,
  requestedMapSources: readonly MapSystemFeatureSourceId[],
): ReadonlyMap<SystemFeatureSourceId, IncrementalSourceState> {
  const requestedSourceIds = requestedMapSources.map(renderSourceId);
  const partialScene = createSystemRenderScene({
    revision: input.revision,
    features: requestedFeatures(input.features, requestedMapSources),
    sourceIds: SYSTEM_FEATURE_SOURCE_BY_NAME,
  });
  const hitsBySource = partitionHits(partialScene, requestedSourceIds);
  const indexes = createRequestedStateIndexes(partialScene, requestedSourceIds, hitsBySource);
  const states = new Map<SystemFeatureSourceId, IncrementalSourceState>();
  for (const sourceId of requestedSourceIds) {
    const visual = partialScene.featuresBySource.get(sourceId) ?? EMPTY_RENDER_COLLECTION;
    const hits = hitsBySource.get(sourceId) ?? EMPTY_RENDER_COLLECTION;
    const featureIds = [
      ...visual.features.map((feature) => feature.id),
      ...hits.features.map((feature) => feature.id),
    ];
    const visualFeatureIdSet = new Set(visual.features.map((feature) => feature.id));
    const hitFeatureIdSet = new Set(hits.features.map((feature) => feature.id));
    const allFeatures = [...visual.features, ...hits.features];
    states.set(sourceId, {
      sourceId,
      visual,
      hits,
      domains: canonicalDomainMap(indexes.domainsBySource.get(sourceId) ?? new Map()),
      visualDomains: canonicalDomainMap(indexes.visualDomainsBySource.get(sourceId) ?? new Map()),
      domainsByFeature: domainsByFeature(indexes.domainsBySource.get(sourceId) ?? new Map()),
      featureIds,
      featureIdSet: new Set(featureIds),
      featuresById: new Map(allFeatures.map((feature) => [feature.id, feature])),
      vertexCountByFeatureId: new Map(
        allFeatures.map((feature) => [feature.id, renderFeatureVertexCount(feature)]),
      ),
      visualFeatureIdSet,
      hitFeatureIdSet,
      stats: sourceFeatureStats(visual, hits),
    });
  }
  if (input.counts) {
    const featureCount = [...states.values()].reduce(
      (sum, state) => sum + state.featureIds.length,
      0,
    );
    input.counts.normalizedSourceCount += requestedSourceIds.length;
    input.counts.normalizedFeatureCount += featureCount;
    input.counts.indexedFeatureCount += featureCount;
  }
  return states;
}

function emptySourceState(sourceId: SystemFeatureSourceId): IncrementalSourceState {
  return {
    sourceId,
    visual: EMPTY_RENDER_COLLECTION,
    hits: EMPTY_RENDER_COLLECTION,
    domains: new Map(),
    visualDomains: new Map(),
    domainsByFeature: new Map(),
    featureIds: [],
    featureIdSet: new Set(),
    featuresById: new Map(),
    vertexCountByFeatureId: new Map(),
    visualFeatureIdSet: new Set(),
    hitFeatureIdSet: new Set(),
    stats: {
      visualFeatureCount: 0,
      visualVertexCount: 0,
      hitFeatureCount: 0,
      hitVertexCount: 0,
    },
  };
}

export function initialSourceStates(): ReadonlyMap<SystemFeatureSourceId, IncrementalSourceState> {
  return new Map(
    ALL_SYSTEM_FEATURE_SOURCES.map((mapSourceId) => {
      const sourceId = renderSourceId(mapSourceId);
      return [sourceId, emptySourceState(sourceId)];
    }),
  );
}
