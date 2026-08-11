import type { Geometry } from 'geojson';
import type { RenderFeatureId, SystemFeatureSourceId } from './render-identity';
import {
  compareRenderPaintOrder,
  type RenderFeature,
  type RenderFeatureCollection,
  type RenderScene,
  type RenderSceneRevision,
} from './render-scene';

export interface RenderFeaturePatch {
  add: readonly RenderFeature[];
  remove: readonly RenderFeatureId[];
}

export interface RenderScenePatchStats {
  addedFeatureCount: number;
  changedFeatureCount: number;
  removedFeatureCount: number;
}

/** `add` contains both new features and complete replacements for changed IDs,
 * matching MapLibre's differential GeoJSON update contract. */
export interface RenderScenePatch {
  revision: RenderSceneRevision;
  add: ReadonlyMap<SystemFeatureSourceId, readonly RenderFeature[]>;
  remove: ReadonlyMap<SystemFeatureSourceId, readonly RenderFeatureId[]>;
  hitFeatures: RenderFeaturePatch;
  stats: RenderScenePatchStats;
}

interface CollectionDiff {
  add: RenderFeature[];
  remove: RenderFeatureId[];
  addedFeatureCount: number;
  changedFeatureCount: number;
  removedFeatureCount: number;
}

function recordsEqual(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  for (const [index, key] of leftKeys.entries()) {
    if (key !== rightKeys[index] || !valuesEqual(left[key], right[key])) return false;
  }
  return true;
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left)) {
    if (!Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => valuesEqual(value, right[index]));
  }
  if (Array.isArray(right)) return false;
  if (typeof left === 'object' && left !== null && typeof right === 'object' && right !== null) {
    return recordsEqual(left as Record<string, unknown>, right as Record<string, unknown>);
  }
  return false;
}

function featuresEqual(
  previous: RenderFeature<Geometry | null>,
  next: RenderFeature<Geometry | null>,
): boolean {
  if (previous === next) return true;
  return (
    previous.id === next.id &&
    valuesEqual(previous.geometry, next.geometry) &&
    valuesEqual(previous.properties, next.properties) &&
    valuesEqual(previous.bbox, next.bbox)
  );
}

function featuresById(
  collection: RenderFeatureCollection | undefined,
): Map<RenderFeatureId, RenderFeature> {
  return new Map(collection?.features.map((feature) => [feature.id, feature]) ?? []);
}

function diffCollections(
  previous: RenderFeatureCollection | undefined,
  next: RenderFeatureCollection | undefined,
): CollectionDiff {
  const previousById = featuresById(previous);
  const nextById = featuresById(next);
  const add: RenderFeature[] = [];
  const remove: RenderFeatureId[] = [];
  let addedFeatureCount = 0;
  let changedFeatureCount = 0;

  for (const feature of next?.features ?? []) {
    const previousFeature = previousById.get(feature.id);
    if (!previousFeature) {
      add.push(feature);
      addedFeatureCount += 1;
    } else if (!featuresEqual(previousFeature, feature)) {
      add.push(feature);
      changedFeatureCount += 1;
    }
  }
  for (const featureId of previousById.keys()) {
    if (!nextById.has(featureId)) remove.push(featureId);
  }

  add.sort(compareRenderPaintOrder);
  remove.sort();
  return {
    add,
    remove,
    addedFeatureCount,
    changedFeatureCount,
    removedFeatureCount: remove.length,
  };
}

function addCounts(stats: RenderScenePatchStats, diff: CollectionDiff): void {
  stats.addedFeatureCount += diff.addedFeatureCount;
  stats.changedFeatureCount += diff.changedFeatureCount;
  stats.removedFeatureCount += diff.removedFeatureCount;
}

export function diffRenderScenes(previous: RenderScene, next: RenderScene): RenderScenePatch {
  const add = new Map<SystemFeatureSourceId, readonly RenderFeature[]>();
  const remove = new Map<SystemFeatureSourceId, readonly RenderFeatureId[]>();
  const stats: RenderScenePatchStats = {
    addedFeatureCount: 0,
    changedFeatureCount: 0,
    removedFeatureCount: 0,
  };
  const sourceIds = new Set<SystemFeatureSourceId>([
    ...previous.featuresBySource.keys(),
    ...next.featuresBySource.keys(),
  ]);

  for (const sourceId of [...sourceIds].sort()) {
    const diff = diffCollections(
      previous.featuresBySource.get(sourceId),
      next.featuresBySource.get(sourceId),
    );
    if (diff.add.length > 0) add.set(sourceId, diff.add);
    if (diff.remove.length > 0) remove.set(sourceId, diff.remove);
    addCounts(stats, diff);
  }

  const hitDiff = diffCollections(previous.hitFeatures, next.hitFeatures);
  addCounts(stats, hitDiff);
  return {
    revision: next.revision,
    add,
    remove,
    hitFeatures: { add: hitDiff.add, remove: hitDiff.remove },
    stats,
  };
}
