import type { FeatureCollection } from 'geojson';
import type { RenderFeatureId } from '@transitmapper/core/render/render-identity';
import {
  compareRenderPaintOrder,
  type RenderFeature,
  type RenderFeatureCollection,
} from '@transitmapper/core/render/render-scene';
import {
  isPersistentReadonlyOverlay,
  overlayReadonlyMap,
  persistentReadonlyOverlayEntryCount,
  streamingReadonlyMapEntries,
} from './persistent-readonly-overlay';
import type { SceneDraftWorkUnit } from './scene-draft-types';
import { SortedRunMerge } from './scene-draft-work';

export { overlayReadonlyMap, overlayReadonlySet } from './persistent-readonly-overlay';

interface FeatureCollectionOverlay {
  readonly stableBase: RenderFeatureCollection;
  readonly stableFeatureIds: ReadonlySet<RenderFeatureId>;
  readonly changes: ReadonlyMap<RenderFeatureId, RenderFeature | null>;
}

const featureCollectionOverlays = new WeakMap<RenderFeatureCollection, FeatureCollectionOverlay>();

interface LazyRenderFeatureCollectionState {
  features: RenderFeature[] | null;
  readonly materialize: () => RenderFeature[];
}

const lazyFeatureCollections = new WeakMap<
  RenderFeatureCollection,
  LazyRenderFeatureCollectionState
>();

function lazyRenderFeatureCollection(materialize: () => RenderFeature[]): RenderFeatureCollection {
  const state: LazyRenderFeatureCollectionState = { features: null, materialize };
  const collection: RenderFeatureCollection = {
    type: 'FeatureCollection',
    get features() {
      state.features ??= state.materialize();
      return state.features;
    },
  };
  lazyFeatureCollections.set(collection, state);
  return collection;
}

export interface RenderFeatureCollectionMaterializationOptions {
  readonly id: string;
  readonly collection: FeatureCollection;
  readonly batchSize: number;
}

export interface RenderFeatureCollectionMaterialization {
  nextWork(): SceneDraftWorkUnit | undefined;
  result(): FeatureCollection;
}

type MaterializationPhase = 'base' | 'changes' | 'merge' | 'complete';

const MATERIALIZATION_SORT_RUN_SIZE = 64;

class OverlayFeatureCollectionMaterialization implements RenderFeatureCollectionMaterialization {
  private phase: MaterializationPhase = 'base';
  private baseFeatures: readonly RenderFeature[] | null = null;
  private baseOffset = 0;
  private changes: Iterator<readonly [RenderFeatureId, RenderFeature | null]> | null = null;
  private changeOffset = 0;
  private currentRun: RenderFeature[] = [];
  private readonly runs: RenderFeature[][] = [];
  private merge: SortedRunMerge<RenderFeature> | null = null;

  constructor(
    private readonly options: RenderFeatureCollectionMaterializationOptions,
    private readonly overlay: FeatureCollectionOverlay,
    private readonly lazy: LazyRenderFeatureCollectionState,
  ) {}

  nextWork(): SceneDraftWorkUnit | undefined {
    switch (this.phase) {
      case 'base':
        return this.nextBaseWork();
      case 'changes':
        return this.nextChangeWork();
      case 'merge':
        return this.nextMergeWork();
      case 'complete':
        return undefined;
    }
  }

  result(): FeatureCollection {
    if (this.phase !== 'complete') {
      throw new Error(
        `Render feature collection materialization is incomplete: ${this.options.id}`,
      );
    }
    return this.options.collection;
  }

  private nextBaseWork(): SceneDraftWorkUnit | undefined {
    if (this.baseFeatures && this.baseOffset >= this.baseFeatures.length) {
      this.finishRun();
      this.phase = 'changes';
      return this.nextWork();
    }
    const start = this.baseOffset;
    return {
      id: `${this.options.id}:materialize:base:${start}`,
      run: () => {
        this.baseFeatures ??= this.overlay.stableBase.features;
        const end = Math.min(
          start + this.options.batchSize,
          start + (MATERIALIZATION_SORT_RUN_SIZE - this.currentRun.length),
          this.baseFeatures.length,
        );
        for (let index = start; index < end; index += 1) {
          const feature = this.baseFeatures[index];
          const changed = this.overlay.changes.get(feature.id);
          if (changed !== null) this.currentRun.push(changed ?? feature);
        }
        this.baseOffset = end;
        if (this.currentRun.length === MATERIALIZATION_SORT_RUN_SIZE) this.finishRun();
      },
    };
  }

  private nextChangeWork(): SceneDraftWorkUnit {
    const start = this.changeOffset;
    return {
      id: `${this.options.id}:materialize:changes:${start}`,
      run: () => {
        this.changes ??= streamingReadonlyMapEntries(this.overlay.changes);
        for (let count = 0; count < this.options.batchSize; count += 1) {
          const entry = this.changes.next();
          if (entry.done) {
            this.finishRun();
            this.phase = 'merge';
            return;
          }
          const [featureId, feature] = entry.value;
          if (!this.overlay.stableFeatureIds.has(featureId) && feature) {
            this.currentRun.push(feature);
            if (this.currentRun.length === MATERIALIZATION_SORT_RUN_SIZE) this.finishRun();
          }
          this.changeOffset += 1;
        }
      },
    };
  }

  private nextMergeWork(): SceneDraftWorkUnit | undefined {
    this.merge ??= new SortedRunMerge({
      id: `${this.options.id}:materialize`,
      runs: this.runs,
      compare: compareRenderPaintOrder,
      batchSize: this.options.batchSize,
    });
    const work = this.merge.nextWork();
    if (work) return work;
    this.lazy.features = this.merge.result();
    this.phase = 'complete';
    return undefined;
  }

  private finishRun(): void {
    if (this.currentRun.length === 0) return;
    this.currentRun.sort(compareRenderPaintOrder);
    this.runs.push(this.currentRun);
    this.currentRun = [];
  }
}

/** Returns resumable work only for an unmaterialized persistent collection.
 * Consumers that may call MapLibre setData can prepend these units and then
 * pass result() without triggering hidden full-collection work in the source call. */
export function createRenderFeatureCollectionMaterialization(
  options: RenderFeatureCollectionMaterializationOptions,
): RenderFeatureCollectionMaterialization | null {
  if (!Number.isInteger(options.batchSize) || options.batchSize <= 0) {
    throw new RangeError('Render feature collection batch size must be a positive integer.');
  }
  const renderCollection = options.collection as RenderFeatureCollection;
  const overlay = featureCollectionOverlays.get(renderCollection);
  const lazy = lazyFeatureCollections.get(renderCollection);
  if (!overlay || !lazy || lazy.features) return null;
  return new OverlayFeatureCollectionMaterialization(options, overlay, lazy);
}

export function mergedRenderFeatureCollection(
  previous: RenderFeatureCollection,
  partial: RenderFeatureCollection,
  removed: ReadonlySet<RenderFeatureId>,
  previousFeatureIds: ReadonlySet<RenderFeatureId>,
): RenderFeatureCollection {
  if (removed.size === 0 && partial.features.length === 0) return previous;
  const builder = new RenderFeatureCollectionOverlayBuilder(previous, previousFeatureIds);
  builder.remove(removed);
  builder.add(partial.features);
  return builder.result();
}

export class RenderFeatureCollectionOverlayBuilder {
  private readonly stableBase: RenderFeatureCollection;
  private readonly stableFeatureIds: ReadonlySet<RenderFeatureId>;
  private changes: ReadonlyMap<RenderFeatureId, RenderFeature | null>;

  constructor(previous: RenderFeatureCollection, previousFeatureIds: ReadonlySet<RenderFeatureId>) {
    const prior = featureCollectionOverlays.get(previous);
    this.stableBase = prior?.stableBase ?? previous;
    this.stableFeatureIds = prior?.stableFeatureIds ?? previousFeatureIds;
    this.changes = prior?.changes ?? new Map();
  }

  remove(featureIds: ReadonlySet<RenderFeatureId>): void {
    const updates = new Map<RenderFeatureId, RenderFeature | null>();
    const removals = new Set<RenderFeatureId>();
    for (const featureId of featureIds) {
      if (this.stableFeatureIds.has(featureId)) updates.set(featureId, null);
      else removals.add(featureId);
    }
    this.changes = overlayReadonlyMap(this.changes, updates, removals);
  }

  add(features: readonly RenderFeature[]): void {
    this.changes = overlayReadonlyMap(
      this.changes,
      new Map(features.map((feature) => [feature.id, feature])),
      new Set(),
    );
  }

  result(): RenderFeatureCollection {
    const stableBase = this.stableBase;
    const stableFeatureIds = this.stableFeatureIds;
    const changes = this.changes;
    const collection = lazyRenderFeatureCollection(() => {
      const seen = new Set<RenderFeatureId>();
      const features: RenderFeature[] = [];
      for (const feature of stableBase.features) {
        seen.add(feature.id);
        const changed = changes.get(feature.id);
        if (changed === null) continue;
        features.push(changed ?? feature);
      }
      for (const [featureId, changed] of changes) {
        if (!seen.has(featureId) && changed) features.push(changed);
      }
      return features.sort(compareRenderPaintOrder);
    });
    featureCollectionOverlays.set(collection, { stableBase, stableFeatureIds, changes });
    return collection;
  }
}

export interface PersistentRenderOverlayDiagnostics {
  readonly depth: number;
  readonly deltaEntryCount: number;
  readonly lazy: boolean;
}

export function persistentRenderOverlayDiagnostics(
  value: object,
): PersistentRenderOverlayDiagnostics {
  if (isPersistentReadonlyOverlay(value)) {
    return {
      depth: 1,
      deltaEntryCount: persistentReadonlyOverlayEntryCount(value),
      lazy: false,
    };
  }
  const collection = featureCollectionOverlays.get(value as RenderFeatureCollection);
  if (collection) {
    return {
      depth: 1,
      deltaEntryCount: persistentReadonlyOverlayEntryCount(collection.changes),
      lazy: true,
    };
  }
  return { depth: 0, deltaEntryCount: 0, lazy: false };
}
