/**
 * Normalizes projected GeoJSON into one source-local scene draft.
 *
 * This is where raw projection output gains stable paint order, hit/visual
 * separation, semantic ownership, and cheap summary statistics. It does not
 * compare against the accepted scene or mutate MapLibre.
 */
import type { Feature } from 'geojson';
import type { SystemFeatureName, SystemFeatures } from '@transitmapper/core/render/buildFeatures';
import { renderFeatureDomainIdentities } from '@transitmapper/core/render/system-render-scene';
import type {
  RenderDomainIdentity,
  RenderFeatureId,
  SystemFeatureSourceId,
} from '@transitmapper/core/render/render-identity';
import {
  compareRenderPaintOrder,
  type RenderFeature,
} from '@transitmapper/core/render/render-scene';
import {
  addDomainFeature,
  EMPTY_RENDER_COLLECTION,
  requireRenderFeature,
  type IncrementalSourceState,
} from './sources/scene-source-state';
import type { IncrementalSceneOperationCounts } from './sources/scene-source-state';
import type { SceneDraftWorkUnit } from './scene-draft-types';
import { SortedRunMerge } from './scene-draft-work';
import { SceneFeatureStats, type SceneFeatureStatsResult } from './scene-feature-stats';
import {
  SYSTEM_FEATURE_NAME_BY_SOURCE,
  type MapSystemFeatureSourceId,
} from './system-feature-sources';

export interface SourceNormalizerOptions {
  readonly revision: string;
  readonly features: SystemFeatures;
  readonly mapSourceId: MapSystemFeatureSourceId;
  readonly sourceId: SystemFeatureSourceId;
  readonly batchSize: number;
  readonly counts?: IncrementalSceneOperationCounts;
  validateFeatureId(featureId: RenderFeatureId, sourceId: SystemFeatureSourceId): void;
}

type NormalizePhase =
  | 'normalize'
  | 'visual-merge'
  | 'hit-merge'
  | 'feature-ids'
  | 'feature-stats'
  | 'domain-keys'
  | 'domain-values'
  | 'visual-domain-keys'
  | 'visual-domain-values'
  | 'domains-by-feature'
  | 'finish'
  | 'complete';

const NORMALIZED_SORT_RUN_SIZE = 64;

export class SourceNormalizer {
  private readonly sourceName: SystemFeatureName;
  private readonly rawFeatures: readonly Feature[];
  private readonly visualRuns: RenderFeature[][] = [];
  private readonly hitRuns: RenderFeature[][] = [];
  private readonly domainKeyRuns: RenderDomainIdentity[][] = [];
  private readonly visualDomainKeyRuns: RenderDomainIdentity[][] = [];
  private readonly stagedDomains = new Map<RenderDomainIdentity, RenderFeatureId[]>();
  private readonly stagedVisualDomains = new Map<RenderDomainIdentity, RenderFeatureId[]>();
  private readonly stagedDomainsByFeature = new Map<
    RenderFeatureId,
    readonly RenderDomainIdentity[]
  >();
  private readonly domains = new Map<RenderDomainIdentity, readonly RenderFeatureId[]>();
  private readonly visualDomains = new Map<RenderDomainIdentity, readonly RenderFeatureId[]>();
  private readonly domainsByFeature = new Map<RenderFeatureId, readonly RenderDomainIdentity[]>();
  private readonly featureIdSet = new Set<RenderFeatureId>();
  private readonly featuresById = new Map<RenderFeatureId, RenderFeature>();
  private readonly visualFeatureIdSet = new Set<RenderFeatureId>();
  private readonly hitFeatureIdSet = new Set<RenderFeatureId>();
  private readonly featureIds: RenderFeatureId[] = [];
  private currentVisualRun: RenderFeature[] = [];
  private currentHitRun: RenderFeature[] = [];
  private currentDomainKeyRun: RenderDomainIdentity[] = [];
  private currentVisualDomainKeyRun: RenderDomainIdentity[] = [];
  private normalizedRunFeatureCount = 0;
  private phase: NormalizePhase = 'normalize';
  private offset = 0;
  private visualMerge: SortedRunMerge<RenderFeature> | null = null;
  private hitMerge: SortedRunMerge<RenderFeature> | null = null;
  private domainKeyMerge: SortedRunMerge<RenderDomainIdentity> | null = null;
  private visualDomainKeyMerge: SortedRunMerge<RenderDomainIdentity> | null = null;
  private domainKeys: readonly RenderDomainIdentity[] = [];
  private visualDomainKeys: readonly RenderDomainIdentity[] = [];
  private domainOffset = 0;
  private visualDomainOffset = 0;
  private featureOffset = 0;
  private featureStats: SceneFeatureStats | null = null;
  private featureStatsResult: SceneFeatureStatsResult | null = null;
  private featureDomainOffset = 0;
  private visual: RenderFeature[] = [];
  private hits: RenderFeature[] = [];
  private state: IncrementalSourceState | null = null;

  constructor(private readonly options: SourceNormalizerOptions) {
    this.sourceName = SYSTEM_FEATURE_NAME_BY_SOURCE[options.mapSourceId];
    this.rawFeatures = options.features[this.sourceName].features;
  }

  nextWork(): SceneDraftWorkUnit | undefined {
    switch (this.phase) {
      case 'normalize':
        return this.nextNormalization();
      case 'visual-merge':
        return this.nextVisualMerge();
      case 'hit-merge':
        return this.nextHitMerge();
      case 'feature-ids':
        return this.nextFeatureIds();
      case 'feature-stats':
        return this.nextFeatureStats();
      case 'domain-keys':
        return this.nextDomainKeys();
      case 'domain-values':
        return this.nextDomainValues();
      case 'visual-domain-keys':
        return this.nextVisualDomainKeys();
      case 'visual-domain-values':
        return this.nextVisualDomainValues();
      case 'domains-by-feature':
        return this.nextDomainsByFeature();
      case 'finish':
        return this.finishWork();
      case 'complete':
        return undefined;
    }
  }

  result(): IncrementalSourceState {
    if (!this.state) {
      throw new Error(`Renderer source normalization is incomplete: ${this.options.sourceId}`);
    }
    return this.state;
  }

  private advance(phase: NormalizePhase): SceneDraftWorkUnit | undefined {
    this.phase = phase;
    return this.nextWork();
  }

  private nextNormalization(): SceneDraftWorkUnit | undefined {
    return this.offset < this.rawFeatures.length
      ? this.normalizeWork()
      : this.advance('visual-merge');
  }

  private nextVisualMerge(): SceneDraftWorkUnit | undefined {
    this.visualMerge ??= new SortedRunMerge({
      id: `scene-draft:${this.options.sourceId}:visual`,
      runs: this.visualRuns,
      compare: compareRenderPaintOrder,
      batchSize: this.options.batchSize,
    });
    const work = this.visualMerge.nextWork();
    if (work) return work;
    this.visual = this.visualMerge.result();
    return this.advance('hit-merge');
  }

  private nextHitMerge(): SceneDraftWorkUnit | undefined {
    this.hitMerge ??= new SortedRunMerge({
      id: `scene-draft:${this.options.sourceId}:hits`,
      runs: this.hitRuns,
      compare: compareRenderPaintOrder,
      batchSize: this.options.batchSize,
    });
    const work = this.hitMerge.nextWork();
    if (work) return work;
    this.hits = this.hitMerge.result();
    return this.advance('feature-ids');
  }

  private nextFeatureIds(): SceneDraftWorkUnit | undefined {
    return this.featureOffset < this.visual.length + this.hits.length
      ? this.featureIdsWork()
      : this.advance('feature-stats');
  }

  private nextFeatureStats(): SceneDraftWorkUnit | undefined {
    this.featureStats ??= new SceneFeatureStats({
      sourceId: String(this.options.sourceId),
      visual: this.visual,
      hits: this.hits,
      batchSize: this.options.batchSize,
    });
    const work = this.featureStats.nextWork();
    if (work) return work;
    this.featureStatsResult = this.featureStats.result();
    return this.advance('domain-keys');
  }

  private nextDomainKeys(): SceneDraftWorkUnit | undefined {
    this.domainKeyMerge ??= new SortedRunMerge({
      id: `scene-draft:${this.options.sourceId}:domain-keys`,
      runs: this.domainKeyRuns,
      compare: (left, right) => left.localeCompare(right),
      batchSize: this.options.batchSize,
      unique: true,
    });
    const work = this.domainKeyMerge.nextWork();
    if (work) return work;
    this.domainKeys = this.domainKeyMerge.result();
    return this.advance('domain-values');
  }

  private nextDomainValues(): SceneDraftWorkUnit | undefined {
    return this.domainOffset < this.domainKeys.length
      ? this.domainValuesWork()
      : this.advance('visual-domain-keys');
  }

  private nextVisualDomainKeys(): SceneDraftWorkUnit | undefined {
    this.visualDomainKeyMerge ??= new SortedRunMerge({
      id: `scene-draft:${this.options.sourceId}:visual-domain-keys`,
      runs: this.visualDomainKeyRuns,
      compare: (left, right) => left.localeCompare(right),
      batchSize: this.options.batchSize,
      unique: true,
    });
    const work = this.visualDomainKeyMerge.nextWork();
    if (work) return work;
    this.visualDomainKeys = this.visualDomainKeyMerge.result();
    return this.advance('visual-domain-values');
  }

  private nextVisualDomainValues(): SceneDraftWorkUnit | undefined {
    return this.visualDomainOffset < this.visualDomainKeys.length
      ? this.visualDomainValuesWork()
      : this.advance('domains-by-feature');
  }

  private nextDomainsByFeature(): SceneDraftWorkUnit | undefined {
    return this.featureDomainOffset < this.featureIds.length
      ? this.domainsByFeatureWork()
      : this.advance('finish');
  }

  private normalizeWork(): SceneDraftWorkUnit {
    const start = this.offset;
    const runCapacity = NORMALIZED_SORT_RUN_SIZE - this.normalizedRunFeatureCount;
    const end = Math.min(
      start + this.options.batchSize,
      start + runCapacity,
      this.rawFeatures.length,
    );
    return {
      id: `scene-draft:${this.options.sourceId}:normalize:${start}`,
      run: () => {
        for (let index = start; index < end; index += 1) {
          this.retainFeature(this.rawFeatures[index]);
        }
        this.offset = end;
        if (
          this.normalizedRunFeatureCount === NORMALIZED_SORT_RUN_SIZE ||
          end === this.rawFeatures.length
        ) {
          this.finishNormalizedRun();
        }
      },
    };
  }

  private retainFeature(rawFeature: Feature): void {
    const feature = requireRenderFeature(rawFeature, `source ${this.options.sourceId}`);
    this.options.validateFeatureId(feature.id, this.options.sourceId);
    this.featureIdSet.add(feature.id);
    const featureDomains = renderFeatureDomainIdentities(this.sourceName, feature).sort();
    this.stagedDomainsByFeature.set(feature.id, featureDomains);
    for (const domain of featureDomains) {
      if (!this.stagedDomains.has(domain)) this.currentDomainKeyRun.push(domain);
      addDomainFeature(this.stagedDomains, domain, feature.id);
    }
    if (feature.properties?.hitTarget === true) {
      this.currentHitRun.push({
        ...feature,
        properties: { ...feature.properties, renderSourceId: this.options.sourceId },
      });
    } else {
      this.currentVisualRun.push(feature);
      for (const domain of featureDomains) {
        if (!this.stagedVisualDomains.has(domain)) this.currentVisualDomainKeyRun.push(domain);
        addDomainFeature(this.stagedVisualDomains, domain, feature.id);
      }
    }
    this.normalizedRunFeatureCount += 1;
  }

  private finishNormalizedRun(): void {
    this.currentVisualRun.sort(compareRenderPaintOrder);
    this.currentHitRun.sort(compareRenderPaintOrder);
    this.currentDomainKeyRun.sort();
    this.currentVisualDomainKeyRun.sort();
    if (this.currentVisualRun.length > 0) this.visualRuns.push(this.currentVisualRun);
    if (this.currentHitRun.length > 0) this.hitRuns.push(this.currentHitRun);
    if (this.currentDomainKeyRun.length > 0) this.domainKeyRuns.push(this.currentDomainKeyRun);
    if (this.currentVisualDomainKeyRun.length > 0) {
      this.visualDomainKeyRuns.push(this.currentVisualDomainKeyRun);
    }
    this.currentVisualRun = [];
    this.currentHitRun = [];
    this.currentDomainKeyRun = [];
    this.currentVisualDomainKeyRun = [];
    this.normalizedRunFeatureCount = 0;
  }

  private featureIdsWork(): SceneDraftWorkUnit {
    const start = this.featureOffset;
    const end = Math.min(start + this.options.batchSize, this.visual.length + this.hits.length);
    return {
      id: `scene-draft:${this.options.sourceId}:feature-ids:${start}`,
      run: () => {
        for (let index = start; index < end; index += 1) {
          const feature =
            index < this.visual.length ? this.visual[index] : this.hits[index - this.visual.length];
          this.featureIds.push(feature.id);
          this.featuresById.set(feature.id, feature);
          if (index < this.visual.length) this.visualFeatureIdSet.add(feature.id);
          else this.hitFeatureIdSet.add(feature.id);
        }
        this.featureOffset = end;
      },
    };
  }

  private domainValuesWork(): SceneDraftWorkUnit {
    const start = this.domainOffset;
    const end = Math.min(start + this.options.batchSize, this.domainKeys.length);
    return {
      id: `scene-draft:${this.options.sourceId}:domain-values:${start}`,
      run: () => {
        for (let index = start; index < end; index += 1) {
          const domain = this.domainKeys[index];
          this.domains.set(domain, [...(this.stagedDomains.get(domain) ?? [])].sort());
        }
        this.domainOffset = end;
      },
    };
  }

  private visualDomainValuesWork(): SceneDraftWorkUnit {
    const start = this.visualDomainOffset;
    const end = Math.min(start + this.options.batchSize, this.visualDomainKeys.length);
    return {
      id: `scene-draft:${this.options.sourceId}:visual-domain-values:${start}`,
      run: () => {
        for (let index = start; index < end; index += 1) {
          const domain = this.visualDomainKeys[index];
          this.visualDomains.set(domain, [...(this.stagedVisualDomains.get(domain) ?? [])].sort());
        }
        this.visualDomainOffset = end;
      },
    };
  }

  private domainsByFeatureWork(): SceneDraftWorkUnit {
    const start = this.featureDomainOffset;
    const end = Math.min(start + this.options.batchSize, this.featureIds.length);
    return {
      id: `scene-draft:${this.options.sourceId}:feature-domains:${start}`,
      run: () => {
        for (let index = start; index < end; index += 1) {
          const featureId = this.featureIds[index];
          this.domainsByFeature.set(featureId, this.stagedDomainsByFeature.get(featureId) ?? []);
        }
        this.featureDomainOffset = end;
      },
    };
  }

  private finishWork(): SceneDraftWorkUnit {
    return {
      id: `scene-draft:${this.options.sourceId}:finish`,
      run: () => {
        if (!this.featureStatsResult) {
          throw new Error('Source feature statistics are unavailable.');
        }
        this.state = {
          sourceId: this.options.sourceId,
          visual:
            this.visual.length === 0
              ? EMPTY_RENDER_COLLECTION
              : { type: 'FeatureCollection', features: this.visual },
          hits:
            this.hits.length === 0
              ? EMPTY_RENDER_COLLECTION
              : { type: 'FeatureCollection', features: this.hits },
          domains: this.domains,
          visualDomains: this.visualDomains,
          domainsByFeature: this.domainsByFeature,
          featureIds: this.featureIds,
          featureIdSet: this.featureIdSet,
          featuresById: this.featuresById,
          vertexCountByFeatureId: this.featureStatsResult.vertexCountByFeatureId,
          visualFeatureIdSet: this.visualFeatureIdSet,
          hitFeatureIdSet: this.hitFeatureIdSet,
          stats: this.featureStatsResult.stats,
        };
        this.recordCounts();
        this.phase = 'complete';
      },
    };
  }

  private recordCounts(): void {
    if (!this.options.counts) return;
    this.options.counts.normalizedSourceCount += 1;
    this.options.counts.normalizedFeatureCount += this.featureIds.length;
    this.options.counts.indexedFeatureCount += this.featureIds.length;
  }
}
