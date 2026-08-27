/**
 * Applies a domain-scoped edit to a retained source draft.
 *
 * Replacing a domain removes every feature it owned, including features with
 * several owners, before adding the freshly projected subset. Unrelated
 * features retain their existing objects and indexes.
 */
import type {
  RenderDomainIdentity,
  RenderFeatureId,
} from '@transitmapper/core/render/render-identity';
import type { RenderFeature } from '@transitmapper/core/render/render-scene';
import type { IncrementalSourceState, SourceFeatureStats } from './sources/scene-source-state';
import {
  overlayReadonlyMap,
  overlayReadonlySet,
  RenderFeatureCollectionOverlayBuilder,
} from './sources/persistent-render-source-state';
import { ScopedIndexBuilder } from './scene-draft-scope-indexes';
import type { SceneDraftWorkUnit } from './scene-draft-types';

export interface ScopedSourceUpdateOptions {
  readonly previous: IncrementalSourceState;
  readonly partial: IncrementalSourceState;
  readonly replacementDomains: readonly RenderDomainIdentity[];
  readonly batchSize: number;
}

export interface ScopedSourceUpdateResult {
  readonly state: IncrementalSourceState;
  readonly replacedFeatureIds: ReadonlySet<RenderFeatureId>;
}

type ScopedPhase =
  | 'replacement-domains'
  | 'replacement-ids'
  | 'partial-domains'
  | 'validate'
  | 'removed-stats'
  | 'additions'
  | 'indexes'
  | 'finish'
  | 'complete';

/** Replaces a source-local domain closure without copying the complete visible
 * source. Persistent overlays make preparation proportional to changed IDs;
 * exact sorted collections materialize only for a full-scene consumer. */
export class ScopedSourceUpdate {
  private readonly replacementDomainSet = new Set<RenderDomainIdentity>();
  private readonly replacedFeatureIds = new Set<RenderFeatureId>();
  private readonly affectedDomains = new Set<RenderDomainIdentity>();
  private readonly removedVisualStats = { featureCount: 0, vertexCount: 0 };
  private readonly removedHitStats = { featureCount: 0, vertexCount: 0 };
  private phase: ScopedPhase = 'replacement-domains';
  private replacementDomainValidationOffset = 0;
  private replacementDomainOffset = 0;
  private replacementFeatureOffset = 0;
  private partialDomainIterator: MapIterator<RenderDomainIdentity> | null = null;
  private partialDomainsComplete = false;
  private partialDomainOffset = 0;
  private validationOffset = 0;
  private removedIterator: SetIterator<RenderFeatureId> | null = null;
  private removedComplete = false;
  private removedOffset = 0;
  private additionOffset = 0;
  private indexes: ScopedIndexBuilder | null = null;
  private readonly visualCollection: RenderFeatureCollectionOverlayBuilder;
  private readonly hitCollection: RenderFeatureCollectionOverlayBuilder;
  private featureIdSet: ReadonlySet<RenderFeatureId>;
  private featuresById: ReadonlyMap<RenderFeatureId, RenderFeature>;
  private vertexCountByFeatureId: ReadonlyMap<RenderFeatureId, number>;
  private visualFeatureIdSet: ReadonlySet<RenderFeatureId>;
  private hitFeatureIdSet: ReadonlySet<RenderFeatureId>;
  private state: IncrementalSourceState | null = null;

  constructor(private readonly options: ScopedSourceUpdateOptions) {
    this.visualCollection = new RenderFeatureCollectionOverlayBuilder(
      options.previous.visual,
      options.previous.visualFeatureIdSet,
    );
    this.hitCollection = new RenderFeatureCollectionOverlayBuilder(
      options.previous.hits,
      options.previous.hitFeatureIdSet,
    );
    this.featureIdSet = options.previous.featureIdSet;
    this.featuresById = options.previous.featuresById;
    this.vertexCountByFeatureId = options.previous.vertexCountByFeatureId ?? new Map();
    this.visualFeatureIdSet = options.previous.visualFeatureIdSet;
    this.hitFeatureIdSet = options.previous.hitFeatureIdSet;
  }

  nextWork(): SceneDraftWorkUnit | undefined {
    switch (this.phase) {
      case 'replacement-domains':
        return this.nextReplacementDomains();
      case 'replacement-ids':
        return this.nextReplacementIds();
      case 'partial-domains':
        return this.nextPartialDomains();
      case 'validate':
        return this.nextValidation();
      case 'removed-stats':
        return this.nextRemovedStats();
      case 'additions':
        return this.nextAdditions();
      case 'indexes':
        return this.nextIndexes();
      case 'finish':
        return this.finishWork();
      case 'complete':
        return undefined;
    }
  }

  result(): ScopedSourceUpdateResult {
    if (!this.state) {
      throw new Error(`Scoped renderer merge is incomplete: ${this.options.previous.sourceId}`);
    }
    return { state: this.state, replacedFeatureIds: this.replacedFeatureIds };
  }

  private advance(phase: ScopedPhase): SceneDraftWorkUnit | undefined {
    this.phase = phase;
    return this.nextWork();
  }

  private nextReplacementDomains(): SceneDraftWorkUnit | undefined {
    if (this.replacementDomainValidationOffset >= this.options.replacementDomains.length) {
      return this.advance('replacement-ids');
    }
    const start = this.replacementDomainValidationOffset;
    const end = Math.min(start + this.options.batchSize, this.options.replacementDomains.length);
    return {
      id: `scene-draft:${this.options.previous.sourceId}:scope:replacement-domains:${start}`,
      run: () => {
        for (let index = start; index < end; index += 1) {
          this.replacementDomainSet.add(this.options.replacementDomains[index]);
        }
        this.replacementDomainValidationOffset = end;
      },
    };
  }

  private nextReplacementIds(): SceneDraftWorkUnit | undefined {
    if (this.replacementDomainOffset >= this.options.replacementDomains.length) {
      return this.advance('partial-domains');
    }
    const domain = this.options.replacementDomains[this.replacementDomainOffset];
    const domainFeatureIds = this.options.previous.domains.get(domain) ?? [];
    if (this.replacementFeatureOffset >= domainFeatureIds.length) {
      this.affectedDomains.add(domain);
      this.replacementDomainOffset += 1;
      this.replacementFeatureOffset = 0;
      return this.nextReplacementIds();
    }
    const start = this.replacementFeatureOffset;
    const end = Math.min(start + this.options.batchSize, domainFeatureIds.length);
    return {
      id: `scene-draft:${this.options.previous.sourceId}:scope:replacement-ids:${this.replacementDomainOffset}:${start}`,
      run: () => {
        for (let index = start; index < end; index += 1) {
          const featureId = domainFeatureIds[index];
          this.replacedFeatureIds.add(featureId);
          for (const ownedDomain of this.options.previous.domainsByFeature.get(featureId) ?? []) {
            this.affectedDomains.add(ownedDomain);
          }
        }
        this.replacementFeatureOffset = end;
      },
    };
  }

  private nextPartialDomains(): SceneDraftWorkUnit | undefined {
    if (this.partialDomainsComplete) return this.advance('validate');
    this.partialDomainIterator ??= this.options.partial.domains.keys();
    return {
      id: `scene-draft:${this.options.previous.sourceId}:scope:partial-domains:${this.partialDomainOffset}`,
      run: () => {
        for (let count = 0; count < this.options.batchSize; count += 1) {
          const entry = this.partialDomainIterator?.next();
          if (!entry || entry.done) {
            this.partialDomainsComplete = true;
            return;
          }
          this.affectedDomains.add(entry.value);
          this.partialDomainOffset += 1;
        }
      },
    };
  }

  private nextValidation(): SceneDraftWorkUnit | undefined {
    if (this.validationOffset >= this.options.partial.featureIds.length) {
      return this.replacedFeatureIds.size === 0 && this.options.partial.featureIds.length === 0
        ? this.advance('finish')
        : this.advance('removed-stats');
    }
    const start = this.validationOffset;
    const end = Math.min(start + this.options.batchSize, this.options.partial.featureIds.length);
    return {
      id: `scene-draft:${this.options.previous.sourceId}:scope:validate:${start}`,
      run: () => {
        for (let index = start; index < end; index += 1) {
          const featureId = this.options.partial.featureIds[index];
          const domains = this.options.partial.domainsByFeature.get(featureId) ?? [];
          if (!domains.some((domain) => this.replacementDomainSet.has(domain))) {
            throw new Error(
              `Scoped render feature is outside its replacement domain scope: ${featureId}`,
            );
          }
          if (
            this.options.previous.featureIdSet.has(featureId) &&
            !this.replacedFeatureIds.has(featureId)
          ) {
            throw new Error(
              `Scoped render feature conflicts with retained source ownership: ${featureId}`,
            );
          }
        }
        this.validationOffset = end;
      },
    };
  }

  private nextRemovedStats(): SceneDraftWorkUnit | undefined {
    if (this.removedComplete) return this.advance('additions');
    this.removedIterator ??= this.replacedFeatureIds.values();
    return {
      id: `scene-draft:${this.options.previous.sourceId}:scope:removed-stats:${this.removedOffset}`,
      run: () => this.collectRemovedStats(),
    };
  }

  private collectRemovedStats(): void {
    const visualIds = new Set<RenderFeatureId>();
    const hitIds = new Set<RenderFeatureId>();
    const removedIds = new Set<RenderFeatureId>();
    for (let count = 0; count < this.options.batchSize; count += 1) {
      const entry = this.removedIterator?.next();
      if (!entry || entry.done) {
        this.removedComplete = true;
        break;
      }
      const featureId = entry.value;
      removedIds.add(featureId);
      const vertexCount = this.options.previous.vertexCountByFeatureId?.get(featureId);
      if (vertexCount === undefined) {
        throw new Error(`Scoped renderer feature stats are unavailable: ${featureId}`);
      }
      if (this.options.previous.visualFeatureIdSet.has(featureId)) {
        visualIds.add(featureId);
        this.removedVisualStats.featureCount += 1;
        this.removedVisualStats.vertexCount += vertexCount;
      } else {
        hitIds.add(featureId);
        this.removedHitStats.featureCount += 1;
        this.removedHitStats.vertexCount += vertexCount;
      }
      this.removedOffset += 1;
    }
    this.visualCollection.remove(visualIds);
    this.hitCollection.remove(hitIds);
    this.featureIdSet = overlayReadonlySet(
      this.featureIdSet,
      new Set(),
      removedIds,
      this.featureIdSet.size - removedIds.size,
    );
    this.featuresById = overlayReadonlyMap(
      this.featuresById,
      new Map<RenderFeatureId, RenderFeature>(),
      removedIds,
    );
    this.vertexCountByFeatureId = overlayReadonlyMap(
      this.vertexCountByFeatureId,
      new Map<RenderFeatureId, number>(),
      removedIds,
    );
    this.visualFeatureIdSet = overlayReadonlySet(
      this.visualFeatureIdSet,
      new Set(),
      visualIds,
      this.visualFeatureIdSet.size - visualIds.size,
    );
    this.hitFeatureIdSet = overlayReadonlySet(
      this.hitFeatureIdSet,
      new Set(),
      hitIds,
      this.hitFeatureIdSet.size - hitIds.size,
    );
  }

  private nextAdditions(): SceneDraftWorkUnit | undefined {
    if (this.additionOffset >= this.options.partial.featureIds.length) {
      return this.advance('indexes');
    }
    const start = this.additionOffset;
    const end = Math.min(start + this.options.batchSize, this.options.partial.featureIds.length);
    return {
      id: `scene-draft:${this.options.previous.sourceId}:scope:additions:${start}`,
      run: () => this.additionsWork(start, end),
    };
  }

  private additionsWork(start: number, end: number): void {
    const visual: RenderFeature[] = [];
    const hits: RenderFeature[] = [];
    const featureIds = new Set<RenderFeatureId>();
    const visualIds = new Set<RenderFeatureId>();
    const hitIds = new Set<RenderFeatureId>();
    const featuresById = new Map<RenderFeatureId, RenderFeature>();
    const vertexCountByFeatureId = new Map<RenderFeatureId, number>();
    for (let index = start; index < end; index += 1) {
      const featureId = this.options.partial.featureIds[index];
      const feature = this.options.partial.featuresById.get(featureId);
      if (!feature) throw new Error(`Scoped renderer addition is unavailable: ${featureId}`);
      featureIds.add(featureId);
      featuresById.set(featureId, feature);
      const vertexCount = this.options.partial.vertexCountByFeatureId?.get(featureId);
      if (vertexCount === undefined) {
        throw new Error(`Scoped renderer addition stats are unavailable: ${featureId}`);
      }
      vertexCountByFeatureId.set(featureId, vertexCount);
      if (this.options.partial.visualFeatureIdSet.has(featureId)) {
        visual.push(feature);
        visualIds.add(featureId);
      } else {
        hits.push(feature);
        hitIds.add(featureId);
      }
    }
    this.visualCollection.add(visual);
    this.hitCollection.add(hits);
    this.featureIdSet = overlayReadonlySet(
      this.featureIdSet,
      featureIds,
      new Set(),
      this.featureIdSet.size + featureIds.size,
    );
    this.featuresById = overlayReadonlyMap(this.featuresById, featuresById, new Set());
    this.vertexCountByFeatureId = overlayReadonlyMap(
      this.vertexCountByFeatureId,
      vertexCountByFeatureId,
      new Set(),
    );
    this.visualFeatureIdSet = overlayReadonlySet(
      this.visualFeatureIdSet,
      visualIds,
      new Set(),
      this.visualFeatureIdSet.size + visualIds.size,
    );
    this.hitFeatureIdSet = overlayReadonlySet(
      this.hitFeatureIdSet,
      hitIds,
      new Set(),
      this.hitFeatureIdSet.size + hitIds.size,
    );
    this.additionOffset = end;
  }

  private nextIndexes(): SceneDraftWorkUnit | undefined {
    this.indexes ??= new ScopedIndexBuilder({
      previous: this.options.previous,
      partial: this.options.partial,
      replacedFeatureIds: this.replacedFeatureIds,
      affectedDomains: this.affectedDomains,
      batchSize: this.options.batchSize,
    });
    const work = this.indexes.nextWork();
    return work ?? this.advance('finish');
  }

  private finishWork(): SceneDraftWorkUnit {
    return {
      id: `scene-draft:${this.options.previous.sourceId}:scope:finish`,
      run: () => {
        this.state = this.unchanged() ? this.options.previous : this.mergedState();
        this.phase = 'complete';
      },
    };
  }

  private unchanged(): boolean {
    return this.replacedFeatureIds.size === 0 && this.options.partial.featureIds.length === 0;
  }

  private mergedState(): IncrementalSourceState {
    const indexes = this.indexes?.result();
    if (!indexes) throw new Error('Scoped renderer indexes are unavailable.');
    const visual = this.visualCollection.result();
    const hits = this.hitCollection.result();
    let featureIds: readonly RenderFeatureId[] | null = null;
    return {
      sourceId: this.options.previous.sourceId,
      visual,
      hits,
      ...indexes,
      get featureIds() {
        featureIds ??= [...visual.features, ...hits.features].map((feature) => feature.id);
        return featureIds;
      },
      featureIdSet: this.featureIdSet,
      featuresById: this.featuresById,
      vertexCountByFeatureId: this.vertexCountByFeatureId,
      visualFeatureIdSet: this.visualFeatureIdSet,
      hitFeatureIdSet: this.hitFeatureIdSet,
      stats: this.mergedStats(),
    };
  }

  private mergedStats(): SourceFeatureStats {
    const previous = this.options.previous.stats;
    const added = this.options.partial.stats;
    return {
      visualFeatureCount:
        previous.visualFeatureCount -
        this.removedVisualStats.featureCount +
        added.visualFeatureCount,
      visualVertexCount:
        previous.visualVertexCount - this.removedVisualStats.vertexCount + added.visualVertexCount,
      hitFeatureCount:
        previous.hitFeatureCount - this.removedHitStats.featureCount + added.hitFeatureCount,
      hitVertexCount:
        previous.hitVertexCount - this.removedHitStats.vertexCount + added.hitVertexCount,
    };
  }
}
