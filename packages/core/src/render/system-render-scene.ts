import type { Feature, FeatureCollection, GeoJsonProperties } from 'geojson';
import type { SystemFeatureName, SystemFeatures } from './buildFeatures';
import { featureCollectionStats } from './feature-stats';
import {
  createRenderIdentityIndex,
  renderDomainIdentity,
  type RenderDomainIdentity,
  type RenderFeatureId,
  type RenderIdentityBinding,
  type SystemFeatureSourceId,
} from './render-identity';
import {
  createRenderScene,
  emptyRenderSceneStats,
  renderSceneRevision,
  type RenderScene,
  type RenderSceneStats,
} from './render-scene';

export type SystemFeatureSourceMap = Readonly<Record<SystemFeatureName, SystemFeatureSourceId>>;

export interface CreateSystemRenderSceneInput {
  revision: string;
  features: SystemFeatures;
  sourceIds: SystemFeatureSourceMap;
  stats?: RenderSceneStats;
}

export interface OrderedSystemRenderVisuals {
  scene: RenderScene;
  /** Deterministically paint-ordered visual collections. Hit geometry is
   * available only on `scene.hitFeatures` and never leaks back into a paint source. */
  features: SystemFeatures;
}

const FEATURE_NAMES: readonly SystemFeatureName[] = [
  'ways',
  'services',
  'stops',
  'handles',
  'serviceTermini',
  'footprints',
  'platforms',
  'facilities',
  'physicalHandles',
  'lanes',
  'laneMarkings',
  'laneArrows',
  'serviceArrows',
  'junctions',
  'connectors',
  'wayLabels',
];

interface DomainPropertyBinding {
  kind: string;
  propertyKeys: readonly string[];
}

const DOMAIN_BINDINGS: Record<SystemFeatureName, readonly DomainPropertyBinding[]> = {
  ways: [{ kind: 'way', propertyKeys: ['id'] }],
  services: [
    { kind: 'service', propertyKeys: ['serviceId'] },
    { kind: 'way', propertyKeys: ['wayId'] },
    // A Street-tier service connector changes when its junction moves even
    // when neither service record nor way shape changed. Ordinary service
    // fragments carry no nodeId, so this expands ownership only for that
    // explicitly junction-owned geometry.
    { kind: 'node', propertyKeys: ['nodeId'] },
  ],
  stops: [{ kind: 'stop', propertyKeys: ['id'] }],
  handles: [{ kind: 'way', propertyKeys: ['wayId'] }],
  serviceTermini: [{ kind: 'service', propertyKeys: ['serviceId'] }],
  footprints: [
    { kind: 'station', propertyKeys: ['stationId'] },
    { kind: 'group', propertyKeys: ['groupId'] },
  ],
  platforms: [{ kind: 'station', propertyKeys: ['stationId'] }],
  facilities: [{ kind: 'facility', propertyKeys: ['id'] }],
  physicalHandles: [
    { kind: 'station', propertyKeys: ['stationId'] },
    { kind: 'group', propertyKeys: ['groupId'] },
  ],
  lanes: [{ kind: 'way', propertyKeys: ['wayId', 'id'] }],
  laneMarkings: [{ kind: 'way', propertyKeys: ['wayId', 'id'] }],
  laneArrows: [{ kind: 'way', propertyKeys: ['wayId', 'id'] }],
  serviceArrows: [
    { kind: 'service', propertyKeys: ['serviceId'] },
    { kind: 'way', propertyKeys: ['wayId'] },
  ],
  junctions: [{ kind: 'node', propertyKeys: ['nodeId'] }],
  connectors: [{ kind: 'node', propertyKeys: ['nodeId'] }],
  wayLabels: [
    { kind: 'labelDependency', propertyKeys: ['labelDependencyId'] },
    { kind: 'namedWay', propertyKeys: ['namedWayId'] },
    { kind: 'way', propertyKeys: ['wayId'] },
  ],
};

function stringProperty(properties: GeoJsonProperties, key: string): string | null {
  if (!properties || typeof properties !== 'object') return null;
  const value: unknown = (properties as Record<string, unknown>)[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function firstStringProperty(
  properties: GeoJsonProperties,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = stringProperty(properties, key);
    if (value) return value;
  }
  return null;
}

/** Resolves the stable semantic owners of one source-shaped render feature.
 * Incremental adapters use this same mapping so chunked normalization cannot
 * drift from the one-shot scene contract. */
export function renderFeatureDomainIdentities(
  sourceName: SystemFeatureName,
  feature: Feature,
): RenderDomainIdentity[] {
  const domains: RenderDomainIdentity[] = [];
  for (const binding of DOMAIN_BINDINGS[sourceName]) {
    const id = firstStringProperty(feature.properties, binding.propertyKeys);
    if (id) domains.push(renderDomainIdentity(binding.kind, id));
  }
  return domains;
}

function bindFeature(
  bindings: RenderIdentityBinding[],
  sourceName: SystemFeatureName,
  feature: Feature,
): void {
  if (typeof feature.id !== 'string') return;
  for (const domainIdentity of renderFeatureDomainIdentities(sourceName, feature)) {
    bindings.push({ domainIdentity, renderFeatureIds: [feature.id as RenderFeatureId] });
  }
}

function defaultStats(
  visualCollections: readonly FeatureCollection[],
  hitFeatures: FeatureCollection,
): RenderSceneStats {
  const stats = emptyRenderSceneStats();
  const visual = featureCollectionStats(visualCollections);
  const hits = featureCollectionStats([hitFeatures]);
  return {
    ...stats,
    candidateFeatureCount: visual.featureCount + hits.featureCount,
    visibleFeatureCount: visual.featureCount,
    generatedVisualFeatureCount: visual.featureCount,
    generatedHitFeatureCount: hits.featureCount,
    generatedVertexCount: visual.vertexCount + hits.vertexCount,
  };
}

/** Resolve legacy source-shaped output into the renderer's authoritative
 * stable-ID scene. Invisible interaction geometry is separated from visual
 * batching, while its original source identity is retained for hit routing. */
export function createSystemRenderScene(input: CreateSystemRenderSceneInput): RenderScene {
  const featuresBySource = new Map<SystemFeatureSourceId, FeatureCollection>();
  const hitFeatures: Feature[] = [];
  const identityBindings: RenderIdentityBinding[] = [];

  for (const sourceName of FEATURE_NAMES) {
    const sourceId = input.sourceIds[sourceName];
    const visualFeatures: Feature[] = [];
    for (const feature of input.features[sourceName].features) {
      bindFeature(identityBindings, sourceName, feature);
      if (feature.properties?.hitTarget === true) {
        hitFeatures.push({
          ...feature,
          properties: { ...feature.properties, renderSourceId: sourceId },
        });
      } else {
        visualFeatures.push(feature);
      }
    }
    featuresBySource.set(sourceId, { type: 'FeatureCollection', features: visualFeatures });
  }

  const hitCollection: FeatureCollection = { type: 'FeatureCollection', features: hitFeatures };
  const visualCollections = [...featuresBySource.values()];
  return createRenderScene({
    revision: renderSceneRevision(input.revision),
    featuresBySource,
    hitFeatures: hitCollection,
    identityIndex: createRenderIdentityIndex(identityBindings),
    stats: input.stats ?? defaultStats(visualCollections, hitCollection),
  });
}

function visualCollection<Name extends SystemFeatureName>(
  scene: RenderScene,
  sourceIds: SystemFeatureSourceMap,
  name: Name,
): SystemFeatures[Name] {
  const collection = scene.featuresBySource.get(sourceIds[name]);
  if (!collection) throw new Error(`Resolved render scene is missing source ${name}.`);
  return collection as unknown as SystemFeatures[Name];
}

/** Converts a validated RenderScene back to the source-shaped compatibility
 * contract used by MapLibre adapters. This is the only reverse adapter: live,
 * static, and vector surfaces therefore share stable ordering, duplicate-ID
 * rejection, and hit separation instead of each normalizing GeoJSON itself. */
export function orderedSystemFeaturesFromScene(
  scene: RenderScene,
  sourceIds: SystemFeatureSourceMap,
): SystemFeatures {
  return {
    ways: visualCollection(scene, sourceIds, 'ways'),
    services: visualCollection(scene, sourceIds, 'services'),
    stops: visualCollection(scene, sourceIds, 'stops'),
    handles: visualCollection(scene, sourceIds, 'handles'),
    serviceTermini: visualCollection(scene, sourceIds, 'serviceTermini'),
    footprints: visualCollection(scene, sourceIds, 'footprints'),
    platforms: visualCollection(scene, sourceIds, 'platforms'),
    facilities: visualCollection(scene, sourceIds, 'facilities'),
    physicalHandles: visualCollection(scene, sourceIds, 'physicalHandles'),
    lanes: visualCollection(scene, sourceIds, 'lanes'),
    laneMarkings: visualCollection(scene, sourceIds, 'laneMarkings'),
    laneArrows: visualCollection(scene, sourceIds, 'laneArrows'),
    serviceArrows: visualCollection(scene, sourceIds, 'serviceArrows'),
    junctions: visualCollection(scene, sourceIds, 'junctions'),
    connectors: visualCollection(scene, sourceIds, 'connectors'),
    wayLabels: visualCollection(scene, sourceIds, 'wayLabels'),
  };
}

/** One-shot compatibility boundary for non-incremental renderers. */
export function createOrderedSystemRenderVisuals(
  input: CreateSystemRenderSceneInput,
): OrderedSystemRenderVisuals {
  const scene = createSystemRenderScene(input);
  return { scene, features: orderedSystemFeaturesFromScene(scene, input.sourceIds) };
}
