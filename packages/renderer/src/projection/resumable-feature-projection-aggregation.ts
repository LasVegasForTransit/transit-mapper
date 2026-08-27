import type { Feature } from 'geojson';
import type { SystemFeatureName, SystemFeatures } from '@transitmapper/core/render/buildFeatures';
import type { RenderPresentation } from '@transitmapper/core/render/render-presentation';
import {
  createScreenDensitySelector,
  screenDensityPolicy,
  type ScreenDensityPolicy,
  type ScreenDensitySelector,
} from '@transitmapper/core/render/screen-density';
import type {
  CooperativeRenderJobUnit,
  CooperativeRenderJobUnitSequence,
} from './cooperative-render-job-scheduler';
import type { GeographicFeatureProjectionUnit } from './resumable-feature-projection';
import {
  emptySystemFeatures,
  SYSTEM_FEATURE_NAME_BY_SOURCE,
  type MapSystemFeatureSourceId,
} from '../system-feature-sources';

export interface ProjectionAggregationWorkUnit extends CooperativeRenderJobUnit<void> {
  /** Upper bound on features visited or appended by this unit. */
  readonly featureCount: number;
}

interface ProjectionAggregationUnitSequence extends CooperativeRenderJobUnitSequence<void> {
  unitAt(index: number): ProjectionAggregationWorkUnit | undefined;
}

export interface ProjectionAggregationPlan {
  readonly units: ProjectionAggregationUnitSequence;
  /** Available only after every private aggregation unit has completed. */
  result(): SystemFeatures;
}

export interface PlanProjectionAggregationOptions {
  readonly units: readonly GeographicFeatureProjectionUnit[];
  readonly parts: readonly SystemFeatures[];
  readonly batchSize?: number;
  /** Omitted only by compatibility callers that already supplied complete
   * source collections. Live fragment aggregation provides it. */
  readonly presentation?: RenderPresentation;
}

interface DeferredServiceHits {
  readonly id: string;
  readonly features: Feature[];
  readonly featureCount: number;
}

interface AggregationSourceContext {
  readonly projectionUnit: GeographicFeatureProjectionUnit;
  readonly sourceId: MapSystemFeatureSourceId;
  readonly sourceFeatures: readonly Feature[];
  readonly target: Feature[];
  readonly ids: Set<string>;
}

interface DensitySourceContext {
  readonly sourceId: MapSystemFeatureSourceId;
  readonly sourceName: SystemFeatureName;
  readonly policy: ScreenDensityPolicy;
  readonly features: Feature[];
}

function featureTarget(features: SystemFeatures, sourceId: MapSystemFeatureSourceId): Feature[] {
  return features[SYSTEM_FEATURE_NAME_BY_SOURCE[sourceId]].features;
}

class ProjectionAggregationBuilder implements ProjectionAggregationUnitSequence {
  private readonly aggregated = emptySystemFeatures();
  private readonly idsBySource = new Map<MapSystemFeatureSourceId, Set<string>>();
  private readonly deferredServiceHits: DeferredServiceHits[] = [];
  private completedUnitCount = 0;
  private issuedUnitCount = 0;
  private failed = false;
  private complete = false;
  private partIndex = 0;
  private sourceIndex = 0;
  private currentSource: AggregationSourceContext | null = null;
  private sourceOffset = 0;
  private serviceHitIndex = 0;
  private lastIndex = -1;
  private lastUnit: ProjectionAggregationWorkUnit | undefined;
  private densitySources: readonly DensitySourceContext[] | null = null;
  private densitySourceIndex = 0;
  private densityOffset = 0;
  private densityCompacting = false;
  private densitySelector: ScreenDensitySelector | null = null;
  private densityFeatures: Feature[] = [];

  constructor(
    private readonly options: PlanProjectionAggregationOptions,
    private readonly batchSize: number,
  ) {}

  plan(): ProjectionAggregationPlan {
    return {
      units: this,
      result: () => this.result(),
    };
  }

  unitAt(index: number): ProjectionAggregationWorkUnit | undefined {
    if (index === this.lastIndex) return this.lastUnit;
    if (index !== this.lastIndex + 1) {
      throw new RangeError('Projection aggregation units must be requested in order.');
    }
    this.lastIndex = index;
    this.lastUnit = this.nextUnit();
    if (this.lastUnit) this.issuedUnitCount += 1;
    else this.complete = true;
    return this.lastUnit;
  }

  private nextUnit(): ProjectionAggregationWorkUnit | undefined {
    if (this.currentSource && this.sourceOffset < this.currentSource.sourceFeatures.length) {
      return this.featureChunkUnit(this.currentSource, this.sourceOffset);
    }
    this.currentSource = null;
    if (this.partIndex < this.options.units.length) return this.sourceDescriptorUnit();
    if (this.serviceHitIndex < this.deferredServiceHits.length) return this.serviceHitUnit();
    return this.densityUnit();
  }

  private sourceDescriptorUnit(): ProjectionAggregationWorkUnit {
    const projectionUnit = this.options.units[this.partIndex];
    const part = this.options.parts[this.partIndex];
    if (projectionUnit.sourceIds.length === 0) {
      return this.work(`aggregate:describe:${projectionUnit.id}:empty`, 0, () => {
        this.advanceSource(0);
      });
    }
    const sourceId = projectionUnit.sourceIds[this.sourceIndex];
    return this.work(`aggregate:describe:${projectionUnit.id}:${sourceId}`, 0, () => {
      const ids = this.idsBySource.get(sourceId) ?? new Set<string>();
      this.idsBySource.set(sourceId, ids);
      this.currentSource = {
        projectionUnit,
        sourceId,
        sourceFeatures: featureTarget(part, sourceId),
        target: featureTarget(this.aggregated, sourceId),
        ids,
      };
      this.sourceOffset = 0;
      this.advanceSource(projectionUnit.sourceIds.length);
    });
  }

  private advanceSource(sourceCount: number): void {
    this.sourceIndex += 1;
    if (sourceCount > 0 && this.sourceIndex < sourceCount) return;
    this.partIndex += 1;
    this.sourceIndex = 0;
  }

  private featureChunkUnit(
    context: AggregationSourceContext,
    start: number,
  ): ProjectionAggregationWorkUnit {
    const end = Math.min(start + this.batchSize, context.sourceFeatures.length);
    const serviceHits: Feature[] = [];
    const unitId = `aggregate:${context.projectionUnit.id}:${context.sourceId}:${start}`;
    return this.work(unitId, end - start, () => {
      try {
        for (let index = start; index < end; index++) {
          this.appendFeature(context, context.sourceFeatures[index], serviceHits);
        }
        if (context.sourceId === 'tm-services') {
          this.deferredServiceHits.push({
            id: unitId,
            features: serviceHits,
            featureCount: end - start,
          });
        }
      } finally {
        this.sourceOffset = end;
      }
    });
  }

  private appendFeature(
    context: AggregationSourceContext,
    feature: Feature,
    serviceHits: Feature[],
  ): void {
    if (feature.id === undefined) {
      throw new Error(
        `Projection unit ${context.projectionUnit.id} returned a feature without a stable ID.`,
      );
    }
    const id = String(feature.id);
    if (context.ids.has(id)) {
      throw new Error(
        `Projection unit ${context.projectionUnit.id} returned duplicate ${context.sourceId} ID ${id}.`,
      );
    }
    context.ids.add(id);
    if (context.sourceId === 'tm-services' && feature.properties?.hitTarget === true) {
      serviceHits.push(feature);
    } else {
      context.target.push(feature);
    }
  }

  private serviceHitUnit(): ProjectionAggregationWorkUnit {
    const services = featureTarget(this.aggregated, 'tm-services');
    const hits = this.deferredServiceHits[this.serviceHitIndex];
    return this.work(`finalize:${hits.id}:hits`, hits.featureCount, () => {
      services.push(...hits.features);
      this.serviceHitIndex += 1;
    });
  }

  private densityUnit(): ProjectionAggregationWorkUnit | undefined {
    const sources = this.densitySourcesForAggregation();
    while (this.densitySourceIndex < sources.length) {
      const source = sources[this.densitySourceIndex];
      if (!this.densityCompacting && this.densityOffset < source.features.length) {
        return this.densityScanUnit(source);
      }
      if (!this.densityCompacting) {
        this.densityCompacting = true;
        this.densityOffset = 0;
        continue;
      }
      if (this.densityOffset < source.features.length) return this.densityCompactUnit(source);
      this.replaceDensitySource(source);
      this.densitySourceIndex += 1;
      this.densityOffset = 0;
      this.densityCompacting = false;
      this.densitySelector = null;
      this.densityFeatures = [];
    }
    return undefined;
  }

  private densitySourcesForAggregation(): readonly DensitySourceContext[] {
    if (this.densitySources) return this.densitySources;
    const presentation = this.options.presentation;
    if (!presentation) return (this.densitySources = []);
    this.densitySources = [...this.idsBySource.keys()].flatMap((sourceId) => {
      const sourceName = SYSTEM_FEATURE_NAME_BY_SOURCE[sourceId];
      const policy = screenDensityPolicy(sourceName);
      if (!policy) return [];
      return [{ sourceId, sourceName, policy, features: featureTarget(this.aggregated, sourceId) }];
    });
    return this.densitySources;
  }

  private densityScanUnit(source: DensitySourceContext): ProjectionAggregationWorkUnit {
    const presentation = this.options.presentation;
    if (!presentation) throw new Error('Density aggregation requires a presentation.');
    const start = this.densityOffset;
    const end = Math.min(start + this.batchSize, source.features.length);
    return this.work(`density:scan:${source.sourceId}:${start}`, end - start, () => {
      this.densitySelector ??= createScreenDensitySelector(presentation, source.policy.cellSizePx);
      for (let index = start; index < end; index++) {
        const candidate = source.policy.candidate(source.features[index]);
        if (candidate) this.densitySelector.consider(candidate);
      }
      this.densityOffset = end;
    });
  }

  private densityCompactUnit(source: DensitySourceContext): ProjectionAggregationWorkUnit {
    const start = this.densityOffset;
    const end = Math.min(start + this.batchSize, source.features.length);
    return this.work(`density:compact:${source.sourceId}:${start}`, end - start, () => {
      const selector = this.densitySelector;
      if (!selector) throw new Error('Density aggregation cannot compact before scanning.');
      for (let index = start; index < end; index++) {
        const feature = source.features[index];
        const candidate = source.policy.candidate(feature);
        if (!candidate || selector.keeps(candidate.id)) this.densityFeatures.push(feature);
      }
      this.densityOffset = end;
    });
  }

  private replaceDensitySource(source: DensitySourceContext): void {
    // Replacing the collection after all scan and compact units avoids one
    // terminal filter pass and means an interrupted draft cannot leak a half-
    // culled source through result().
    this.aggregated[source.sourceName].features = this.densityFeatures as never;
  }

  private work(id: string, featureCount: number, run: () => void): ProjectionAggregationWorkUnit {
    return {
      id,
      featureCount,
      run: () => {
        if (this.failed) throw new Error('Projection aggregation already failed.');
        try {
          run();
          this.completedUnitCount += 1;
        } catch (error) {
          this.failed = true;
          throw error;
        }
      },
    };
  }

  private result(): SystemFeatures {
    if (this.failed || !this.complete || this.completedUnitCount !== this.issuedUnitCount) {
      throw new Error('Aggregation is incomplete and cannot be published.');
    }
    return this.aggregated;
  }
}

/** Restores exact synchronous traversal order without one terminal flatten or
 * filter pass. Service hit surfaces are retained in chunk-local buckets, then
 * appended after every visual chunk so the established visual-before-hit
 * contract remains byte-for-byte stable. The accumulator is plan-private and
 * cannot be observed until every unit succeeds. */
export function planResumableFeatureProjectionAggregation(
  options: PlanProjectionAggregationOptions,
): ProjectionAggregationPlan {
  if (options.parts.length !== options.units.length) {
    throw new RangeError(
      `Expected ${options.units.length} projection unit results, received ${options.parts.length}.`,
    );
  }
  const batchSize = options.batchSize ?? 64;
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new RangeError('Projection aggregation batch size must be a positive integer.');
  }

  return new ProjectionAggregationBuilder(options, batchSize).plan();
}
