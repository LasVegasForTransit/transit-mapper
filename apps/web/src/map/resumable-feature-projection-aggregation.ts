import type { Feature } from 'geojson';
import type { SystemFeatures } from '@transitmapper/core/render/buildFeatures';
import type {
  CooperativeRenderJobUnit,
  CooperativeRenderJobUnitSequence,
} from './cooperative-render-job-scheduler';
import type { GeographicFeatureProjectionUnit } from './resumable-feature-projection';
import {
  emptySystemFeatures,
  SYSTEM_FEATURE_NAME_BY_SOURCE,
  type MapSystemFeatureSourceId,
} from './system-feature-sources';

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
    return undefined;
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
