/**
 * Coordinates source-local normalization and ownership replacement.
 *
 * Full requests replace the requested source collections. Scoped requests
 * merge only declared domains. The result is still a private draft; patching
 * and publication happen later.
 */
import type {
  RenderDomainIdentity,
  RenderFeatureId,
  SystemFeatureSourceId,
} from '@transitmapper/core/render/render-identity';
import {
  canonicalRequestedSources,
  initialSourceStates,
  renderSourceId,
  type IncrementalSourceState,
} from './sources/scene-source-state';
import { SourceNormalizer } from './scene-draft-normalization';
import { resolveScopedReplacementDomains } from './scene-draft-assembly';
import type { BuildSceneDraftInput, SceneDraftWorkUnit } from './scene-draft-types';
import { ScopedSourceUpdate } from './scene-draft-scoped-update';
import type { MapSystemFeatureSourceId } from './system-feature-sources';

export interface SourceStateUpdateResult {
  readonly requestedSourceIds: readonly SystemFeatureSourceId[];
  readonly previousStates: ReadonlyMap<SystemFeatureSourceId, IncrementalSourceState>;
  readonly normalized: ReadonlyMap<SystemFeatureSourceId, IncrementalSourceState>;
  readonly nextStates: ReadonlyMap<SystemFeatureSourceId, IncrementalSourceState>;
  readonly replacementDomains: ReadonlyMap<
    SystemFeatureSourceId,
    readonly RenderDomainIdentity[]
  > | null;
  readonly previousIncludedFeatureIds: ReadonlyMap<
    SystemFeatureSourceId,
    ReadonlySet<RenderFeatureId>
  >;
}

interface SourceStateUpdateOptions {
  readonly input: BuildSceneDraftInput;
  readonly batchSize: number;
}

type TransactionPhase = 'normalize' | 'merge' | 'validate' | 'complete';

export class SourceStateUpdate {
  private readonly requestedMapSources: readonly MapSystemFeatureSourceId[];
  private readonly requestedSourceIds: readonly SystemFeatureSourceId[];
  private readonly requestedSourceSet: ReadonlySet<SystemFeatureSourceId>;
  private readonly previousStates: ReadonlyMap<SystemFeatureSourceId, IncrementalSourceState>;
  private readonly replacementDomains: ReadonlyMap<
    SystemFeatureSourceId,
    readonly RenderDomainIdentity[]
  > | null;
  private readonly normalized = new Map<SystemFeatureSourceId, IncrementalSourceState>();
  private readonly requestedOwnerByFeature = new Map<RenderFeatureId, SystemFeatureSourceId>();
  private readonly previousIncludedFeatureIds = new Map<
    SystemFeatureSourceId,
    ReadonlySet<RenderFeatureId>
  >();
  private phase: TransactionPhase = 'normalize';
  private sourceIndex = 0;
  private currentNormalizer: SourceNormalizer | null = null;
  private nextStates: Map<SystemFeatureSourceId, IncrementalSourceState> | null = null;
  private currentScope: ScopedSourceUpdate | null = null;
  private validationSourceIndex = 0;
  private validationFeatureOffset = 0;

  constructor(private readonly options: SourceStateUpdateOptions) {
    const input = options.input;
    this.requestedMapSources = canonicalRequestedSources(input.sourceIds);
    this.requestedSourceIds = this.requestedMapSources.map(renderSourceId);
    this.requestedSourceSet = new Set(this.requestedSourceIds);
    this.previousStates = input.previous?.sourceStates ?? initialSourceStates();
    this.replacementDomains = input.replacementDomainsBySource
      ? resolveScopedReplacementDomains(this.requestedMapSources, input.replacementDomainsBySource)
      : null;
  }

  nextWork(): SceneDraftWorkUnit | undefined {
    switch (this.phase) {
      case 'normalize':
        return this.nextNormalization();
      case 'merge':
        return this.nextMerge();
      case 'validate':
        return this.nextValidation();
      case 'complete':
        return undefined;
    }
  }

  result(): SourceStateUpdateResult {
    if (this.phase !== 'complete' || !this.nextStates) {
      throw new Error('Staged renderer source transaction is incomplete.');
    }
    return {
      requestedSourceIds: this.requestedSourceIds,
      previousStates: this.previousStates,
      normalized: this.normalized,
      nextStates: this.nextStates,
      replacementDomains: this.replacementDomains,
      previousIncludedFeatureIds: this.previousIncludedFeatureIds,
    };
  }

  private advance(phase: TransactionPhase): SceneDraftWorkUnit | undefined {
    this.phase = phase;
    return this.nextWork();
  }

  private nextNormalization(): SceneDraftWorkUnit | undefined {
    const work = this.normalizeWork();
    return work ?? this.advance('merge');
  }

  private normalizeWork(): SceneDraftWorkUnit | undefined {
    if (this.sourceIndex >= this.requestedMapSources.length) {
      this.sourceIndex = 0;
      return undefined;
    }
    const mapSourceId = this.requestedMapSources[this.sourceIndex];
    const sourceId = this.requestedSourceIds[this.sourceIndex];
    this.currentNormalizer ??= new SourceNormalizer({
      revision: this.options.input.revision,
      features: this.options.input.features,
      mapSourceId,
      sourceId,
      batchSize: this.options.batchSize,
      ...(this.options.input.counts ? { counts: this.options.input.counts } : {}),
      validateFeatureId: (featureId, owner) => this.validateRequestedFeatureId(featureId, owner),
    });
    const work = this.currentNormalizer.nextWork();
    if (work) return work;
    this.normalized.set(sourceId, this.currentNormalizer.result());
    this.currentNormalizer = null;
    this.sourceIndex += 1;
    return this.normalizeWork();
  }

  private validateRequestedFeatureId(
    featureId: RenderFeatureId,
    sourceId: SystemFeatureSourceId,
  ): void {
    if (this.requestedOwnerByFeature.has(featureId)) {
      throw new Error(`Duplicate render feature ID across scene: ${featureId}`);
    }
    this.requestedOwnerByFeature.set(featureId, sourceId);
    for (const previous of this.previousStates.values()) {
      if (
        previous.sourceId !== sourceId &&
        !this.requestedSourceSet.has(previous.sourceId) &&
        previous.featureIdSet.has(featureId)
      ) {
        throw new Error(`Duplicate render feature ID across scene: ${featureId}`);
      }
    }
  }

  private nextMerge(): SceneDraftWorkUnit | undefined {
    const work = this.mergeWork();
    return work ?? this.advance('validate');
  }

  private mergeWork(): SceneDraftWorkUnit | undefined {
    if (!this.nextStates) return this.initializeMergeWork();
    if (this.sourceIndex >= this.requestedSourceIds.length) return undefined;
    return this.replacementDomains ? this.scopedMergeWork() : this.fullMergeWork();
  }

  private initializeMergeWork(): SceneDraftWorkUnit {
    return {
      id: 'scene-draft:merge:initialize',
      run: () => {
        this.nextStates = new Map(this.previousStates);
      },
    };
  }

  private fullMergeWork(): SceneDraftWorkUnit {
    const sourceId = this.requestedSourceIds[this.sourceIndex];
    return {
      id: `scene-draft:${sourceId}:merge:full`,
      run: () => {
        this.requireNextStates().set(sourceId, this.sourceState(this.normalized, sourceId));
        this.sourceIndex += 1;
      },
    };
  }

  private scopedMergeWork(): SceneDraftWorkUnit | undefined {
    const sourceId = this.requestedSourceIds[this.sourceIndex];
    this.currentScope ??= new ScopedSourceUpdate({
      previous: this.sourceState(this.previousStates, sourceId),
      partial: this.sourceState(this.normalized, sourceId),
      replacementDomains: this.replacementDomains?.get(sourceId) ?? [],
      batchSize: this.options.batchSize,
    });
    const work = this.currentScope.nextWork();
    if (work) return work;
    const merged = this.currentScope.result();
    this.requireNextStates().set(sourceId, merged.state);
    this.previousIncludedFeatureIds.set(sourceId, merged.replacedFeatureIds);
    this.currentScope = null;
    this.sourceIndex += 1;
    return this.mergeWork();
  }

  private nextValidation(): SceneDraftWorkUnit | undefined {
    const work = this.validateMergedWork();
    if (work) return work;
    this.phase = 'complete';
    return undefined;
  }

  private validateMergedWork(): SceneDraftWorkUnit | undefined {
    if (this.validationSourceIndex >= this.requestedSourceIds.length) return undefined;
    const sourceId = this.requestedSourceIds[this.validationSourceIndex];
    const state = this.sourceState(this.normalized, sourceId);
    if (this.validationFeatureOffset >= state.featureIds.length) {
      this.validationSourceIndex += 1;
      this.validationFeatureOffset = 0;
      return this.validateMergedWork();
    }
    const start = this.validationFeatureOffset;
    const end = Math.min(start + this.options.batchSize, state.featureIds.length);
    return {
      id: `scene-draft:${sourceId}:validate-merged:${start}`,
      run: () => {
        for (let index = start; index < end; index += 1) {
          this.assertSingleOwner(state.featureIds[index]);
        }
        this.validationFeatureOffset = end;
      },
    };
  }

  private assertSingleOwner(featureId: RenderFeatureId): void {
    let owner: SystemFeatureSourceId | null = null;
    for (const candidate of this.requireNextStates().values()) {
      if (!candidate.featureIdSet.has(featureId)) continue;
      if (owner) throw new Error(`Duplicate render feature ID across scene: ${featureId}`);
      owner = candidate.sourceId;
    }
  }

  private requireNextStates(): Map<SystemFeatureSourceId, IncrementalSourceState> {
    if (!this.nextStates) throw new Error('Renderer source merge has not started.');
    return this.nextStates;
  }

  private sourceState(
    states: ReadonlyMap<SystemFeatureSourceId, IncrementalSourceState>,
    sourceId: SystemFeatureSourceId,
  ): IncrementalSourceState {
    const state = states.get(sourceId);
    if (!state) throw new Error(`Renderer source state is unavailable: ${sourceId}`);
    return state;
  }
}
