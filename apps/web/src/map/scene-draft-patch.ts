/**
 * Builds the stable-ID patch between one accepted source and its draft.
 * Comparisons are resumable because a single large geographic feature must not
 * turn an otherwise incremental update into one long main-thread task.
 */
import type { RenderFeatureId } from '@transitmapper/core/render/render-identity';
import type {
  RenderFeature,
  RenderFeatureCollection,
} from '@transitmapper/core/render/render-scene';
import type { IncrementalSourceState } from './scene-source-state';
import type { IncrementalSceneOperationCounts } from './scene-source-state';
import type { SceneDraftWorkUnit } from './scene-draft-types';
import { ResumableRenderFeatureComparison } from './scene-feature-comparison';
import { SortedRunMerge } from './scene-draft-work';

export interface CollectionPatch {
  readonly add: readonly RenderFeature[];
  readonly remove: readonly RenderFeatureId[];
  readonly addedFeatureCount: number;
  readonly changedFeatureCount: number;
  readonly removedFeatureCount: number;
}

interface CollectionDiffBuilderOptions {
  readonly id: string;
  readonly previous: RenderFeatureCollection;
  readonly next: RenderFeatureCollection;
  readonly includedPreviousIds?: ReadonlySet<RenderFeatureId>;
  readonly previousById?: ReadonlyMap<RenderFeatureId, RenderFeature>;
  readonly previousCollectionIds?: ReadonlySet<RenderFeatureId>;
  readonly compareSameId: boolean;
  readonly counts?: IncrementalSceneOperationCounts;
  readonly batchSize: number;
}

type CollectionDiffPhase = 'previous' | 'next' | 'removals' | 'removal-merge' | 'complete';

class CollectionDiffBuilder {
  private readonly previousById = new Map<RenderFeatureId, RenderFeature>();
  private readonly nextIds = new Set<RenderFeatureId>();
  private readonly add: RenderFeature[] = [];
  private readonly removalRuns: RenderFeatureId[][] = [];
  private phase: CollectionDiffPhase = 'previous';
  private previousOffset = 0;
  private includedPreviousIterator: SetIterator<RenderFeatureId> | null = null;
  private includedPreviousComplete = false;
  private nextOffset = 0;
  private currentComparison: ResumableRenderFeatureComparison | null = null;
  private currentComparisonFeature: RenderFeature | null = null;
  private removalIterator: MapIterator<[RenderFeatureId, RenderFeature]> | null = null;
  private removalsComplete = false;
  private removalOffset = 0;
  private removalMerge: SortedRunMerge<RenderFeatureId> | null = null;
  private addedFeatureCount = 0;
  private changedFeatureCount = 0;
  private remove: readonly RenderFeatureId[] = [];

  constructor(private readonly options: CollectionDiffBuilderOptions) {}

  nextWork(): SceneDraftWorkUnit | undefined {
    switch (this.phase) {
      case 'previous':
        return this.nextPrevious();
      case 'next':
        return this.nextNext();
      case 'removals':
        return this.nextRemovals();
      case 'removal-merge':
        return this.nextRemovalMerge();
      case 'complete':
        return undefined;
    }
  }

  result(): CollectionPatch {
    if (this.phase !== 'complete') {
      throw new Error(`Renderer diff is incomplete: ${this.options.id}`);
    }
    return {
      add: this.add,
      remove: this.remove,
      addedFeatureCount: this.addedFeatureCount,
      changedFeatureCount: this.changedFeatureCount,
      removedFeatureCount: this.remove.length,
    };
  }

  private advance(phase: CollectionDiffPhase): SceneDraftWorkUnit | undefined {
    this.phase = phase;
    return this.nextWork();
  }

  private nextPrevious(): SceneDraftWorkUnit | undefined {
    if (this.options.includedPreviousIds && this.options.previousById) {
      if (this.includedPreviousComplete) return this.advance('next');
      return this.includedPreviousWork();
    }
    return this.previousOffset < this.options.previous.features.length
      ? this.previousWork()
      : this.advance('next');
  }

  private includedPreviousWork(): SceneDraftWorkUnit {
    this.includedPreviousIterator ??= this.options.includedPreviousIds?.values() ?? null;
    const start = this.previousOffset;
    return {
      id: `${this.options.id}:previous:${start}`,
      run: () => {
        for (let count = 0; count < this.options.batchSize; count += 1) {
          const entry = this.includedPreviousIterator?.next();
          if (!entry || entry.done) {
            this.includedPreviousComplete = true;
            return;
          }
          const featureId = entry.value;
          if (this.options.previousCollectionIds?.has(featureId) ?? true) {
            const feature = this.options.previousById?.get(featureId);
            if (!feature) throw new Error(`Renderer diff feature is unavailable: ${featureId}`);
            this.previousById.set(featureId, feature);
          }
          this.previousOffset += 1;
        }
      },
    };
  }

  private previousWork(): SceneDraftWorkUnit {
    const start = this.previousOffset;
    const end = Math.min(start + this.options.batchSize, this.options.previous.features.length);
    return {
      id: `${this.options.id}:previous:${start}`,
      run: () => {
        for (let index = start; index < end; index += 1) {
          const feature = this.options.previous.features[index];
          if (this.options.includedPreviousIds?.has(feature.id) ?? true) {
            this.previousById.set(feature.id, feature);
          }
        }
        this.previousOffset = end;
      },
    };
  }

  private nextNext(): SceneDraftWorkUnit | undefined {
    const comparisonWork = this.nextComparisonWork();
    if (comparisonWork) return comparisonWork;
    return this.nextOffset < this.options.next.features.length
      ? this.nextWorkUnit()
      : this.advance('removals');
  }

  private nextComparisonWork(): SceneDraftWorkUnit | undefined {
    if (!this.currentComparison) return undefined;
    const work = this.currentComparison.nextWork();
    if (work) return work;
    if (!this.currentComparison.result()) {
      const feature = this.currentComparisonFeature;
      if (!feature) throw new Error(`Renderer comparison lost its feature: ${this.options.id}`);
      this.add.push(feature);
      this.changedFeatureCount += 1;
    }
    this.currentComparison = null;
    this.currentComparisonFeature = null;
    this.nextOffset += 1;
    return this.nextNext();
  }

  private nextWorkUnit(): SceneDraftWorkUnit {
    const start = this.nextOffset;
    const end = Math.min(start + this.options.batchSize, this.options.next.features.length);
    return {
      id: `${this.options.id}:next:${start}`,
      run: () => {
        for (let index = start; index < end; index += 1) {
          if (!this.retainNextFeature(this.options.next.features[index], index)) return;
        }
      },
    };
  }

  private retainNextFeature(feature: RenderFeature, index: number): boolean {
    this.nextIds.add(feature.id);
    const previous = this.previousById.get(feature.id);
    if (!previous) {
      this.add.push(feature);
      this.addedFeatureCount += 1;
    } else if (previous === feature) {
      if (this.options.counts) this.options.counts.referenceEqualFeatureCount += 1;
    } else if (this.options.includedPreviousIds || !this.options.compareSameId) {
      this.add.push(feature);
      this.changedFeatureCount += 1;
      if (this.options.counts) this.options.counts.authoritativeChangedFeatureCount += 1;
    } else {
      this.startComparison(previous, feature, index);
      return false;
    }
    this.nextOffset = index + 1;
    return true;
  }

  private startComparison(previous: RenderFeature, feature: RenderFeature, index: number): void {
    const counts = this.options.counts;
    if (counts) counts.comparedFeatureCount += 1;
    this.currentComparison = new ResumableRenderFeatureComparison({
      id: `${this.options.id}:compare:${index}`,
      previous,
      next: feature,
      stepsPerUnit: 512 * this.options.batchSize,
      ...(counts
        ? {
            recordUnit: (stepCount: number) => {
              counts.comparisonUnitCount += 1;
              counts.comparisonStepCount += stepCount;
              counts.comparedValueCount += stepCount;
            },
          }
        : {}),
    });
    this.currentComparisonFeature = feature;
  }

  private nextRemovals(): SceneDraftWorkUnit | undefined {
    if (this.removalsComplete) return this.advance('removal-merge');
    this.removalIterator ??= this.previousById.entries();
    return {
      id: `${this.options.id}:removals:${this.removalOffset}`,
      run: () => {
        const removals: RenderFeatureId[] = [];
        for (let count = 0; count < this.options.batchSize; count += 1) {
          const entry = this.removalIterator?.next();
          if (!entry || entry.done) {
            this.removalsComplete = true;
            break;
          }
          if (!this.nextIds.has(entry.value[0])) removals.push(entry.value[0]);
          this.removalOffset += 1;
        }
        removals.sort();
        if (removals.length > 0) this.removalRuns.push(removals);
      },
    };
  }

  private nextRemovalMerge(): SceneDraftWorkUnit | undefined {
    this.removalMerge ??= new SortedRunMerge({
      id: `${this.options.id}:removal`,
      runs: this.removalRuns,
      compare: (left, right) => left.localeCompare(right),
      batchSize: this.options.batchSize,
    });
    const work = this.removalMerge.nextWork();
    if (work) return work;
    this.remove = this.removalMerge.result();
    this.phase = 'complete';
    return undefined;
  }
}

export interface SourcePatchBuilderOptions {
  readonly sourceId: string;
  readonly previous: IncrementalSourceState;
  readonly next: IncrementalSourceState;
  readonly includedPreviousIds?: ReadonlySet<RenderFeatureId>;
  readonly compareSameId?: boolean;
  readonly counts?: IncrementalSceneOperationCounts;
  readonly batchSize: number;
}

export interface SourceDiffResult {
  readonly visual: CollectionPatch;
  readonly hits: CollectionPatch;
}

export class SourcePatchBuilder {
  private readonly visual: CollectionDiffBuilder;
  private readonly hits: CollectionDiffBuilder;
  private phase: 'visual' | 'hits' | 'complete' = 'visual';

  constructor(options: SourcePatchBuilderOptions) {
    const included = options.includedPreviousIds
      ? {
          includedPreviousIds: options.includedPreviousIds,
          previousById: options.previous.featuresById,
        }
      : {};
    this.visual = new CollectionDiffBuilder({
      id: `scene-draft:${options.sourceId}:diff:visual`,
      previous: options.previous.visual,
      next: options.next.visual,
      ...included,
      ...(options.includedPreviousIds
        ? { previousCollectionIds: options.previous.visualFeatureIdSet }
        : {}),
      compareSameId: options.compareSameId ?? true,
      ...(options.counts ? { counts: options.counts } : {}),
      batchSize: options.batchSize,
    });
    this.hits = new CollectionDiffBuilder({
      id: `scene-draft:${options.sourceId}:diff:hits`,
      previous: options.previous.hits,
      next: options.next.hits,
      ...included,
      ...(options.includedPreviousIds
        ? { previousCollectionIds: options.previous.hitFeatureIdSet }
        : {}),
      compareSameId: options.compareSameId ?? true,
      ...(options.counts ? { counts: options.counts } : {}),
      batchSize: options.batchSize,
    });
  }

  nextWork(): SceneDraftWorkUnit | undefined {
    if (this.phase === 'visual') {
      const work = this.visual.nextWork();
      if (work) return work;
      this.phase = 'hits';
    }
    if (this.phase === 'hits') {
      const work = this.hits.nextWork();
      if (work) return work;
      this.phase = 'complete';
    }
    return undefined;
  }

  result(): SourceDiffResult {
    if (this.phase !== 'complete') throw new Error('Renderer source diff is incomplete.');
    return { visual: this.visual.result(), hits: this.hits.result() };
  }
}
