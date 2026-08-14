import type { SystemFeatures } from '@transitmapper/core/render/buildFeatures';
import { createProjectionPlanningContext } from './resumable-feature-projection-planning';
import type {
  GeographicFeatureProjectionBatchSizes,
  GeographicFeatureProjectionPrimaryKind,
  GeographicFeatureProjectionUnit,
  PlanResumableGeographicFeatureProjectionOptions,
  ResumableGeographicFeatureProjectionPlan,
} from './resumable-feature-projection-planning';
import { appendProjectionUnits } from './resumable-feature-projection-stages';
import {
  emptySystemFeatures,
  SYSTEM_FEATURE_NAME_BY_SOURCE,
  type MapSystemFeatureSourceId,
} from './system-feature-sources';

export type {
  GeographicFeatureProjectionBatchSizes,
  GeographicFeatureProjectionPrimaryKind,
  GeographicFeatureProjectionUnit,
  PlanResumableGeographicFeatureProjectionOptions,
  ReadyResumableGeographicFeatureProjectionPlan,
  ResumableGeographicFeatureProjectionPlan,
} from './resumable-feature-projection-planning';

type BatchSizeName = keyof Required<GeographicFeatureProjectionBatchSizes>;

function batchSizeForPrimaryKind(
  kind: GeographicFeatureProjectionPrimaryKind,
): BatchSizeName | null {
  switch (kind) {
    case 'corridor':
      return 'corridors';
    case 'junction':
      return 'junctions';
    case 'stop':
      return 'stops';
    case 'station':
      return 'stations';
    case 'label':
      return 'labels';
    case 'service':
      return 'services';
    default:
      return null;
  }
}

function aggregateProjectionParts(
  units: readonly GeographicFeatureProjectionUnit[],
  parts: readonly SystemFeatures[],
): SystemFeatures {
  if (parts.length !== units.length) {
    throw new RangeError(
      `Expected ${units.length} projection unit results, received ${parts.length}.`,
    );
  }
  const aggregated = emptySystemFeatures();
  const idsBySource = new Map<MapSystemFeatureSourceId, Set<string>>();
  for (let index = 0; index < units.length; index++) {
    const part = parts[index];
    for (const sourceId of units[index].sourceIds) {
      const name = SYSTEM_FEATURE_NAME_BY_SOURCE[sourceId];
      const target = aggregated[name].features;
      const ids = idsBySource.get(sourceId) ?? new Set<string>();
      idsBySource.set(sourceId, ids);
      for (const feature of part[name].features) {
        if (feature.id === undefined) {
          throw new Error(
            `Projection unit ${units[index].id} returned a feature without a stable ID.`,
          );
        }
        const id = String(feature.id);
        if (ids.has(id)) {
          throw new Error(
            `Projection unit ${units[index].id} returned duplicate ${sourceId} ID ${id}.`,
          );
        }
        ids.add(id);
        // Each SystemFeatures member owns one concrete GeoJSON geometry type;
        // this source/name lookup preserves that relationship at runtime.
        target.push(feature as never);
      }
    }
  }
  // The synchronous topology pass merges every paint fragment before
  // appending its per-occurrence hit surfaces. Per-corridor units naturally
  // interleave those two roles, so restore the same stable partition here.
  aggregated.services.features = [
    ...aggregated.services.features.filter((feature) => feature.properties?.hitTarget !== true),
    ...aggregated.services.features.filter((feature) => feature.properties?.hitTarget === true),
  ];
  return aggregated;
}

/** Plan bounded, resumable work without projecting any feature. Candidate IDs
 * first pass through the same viewport query and entity dependency scope as
 * the synchronous renderer; unit scopes can only narrow those results. */
export function planResumableGeographicFeatureProjection(
  options: PlanResumableGeographicFeatureProjectionOptions,
): ResumableGeographicFeatureProjectionPlan {
  if (options.view.viewMode === 'diagram') {
    return { kind: 'deferred', reason: 'diagram-layout-phase-6' };
  }
  const context = createProjectionPlanningContext(options);
  appendProjectionUnits(context);
  return {
    kind: 'ready',
    sourceIds: context.sourceIds,
    units: context.units,
    aggregate: (parts) => aggregateProjectionParts(context.units, parts),
    refineAfterUnitBudgetExceeded: (unitId) => {
      const unit = context.units.find((candidate) => candidate.id === unitId);
      if (!unit) return null;
      const batchSizeName = batchSizeForPrimaryKind(unit.primary.kind);
      if (!batchSizeName) return null;
      const currentSize = context.batchSizes[batchSizeName];
      if (currentSize <= 1) return null;
      const refined = planResumableGeographicFeatureProjection({
        ...options,
        batchSizes: {
          ...context.batchSizes,
          [batchSizeName]: Math.max(1, Math.floor(currentSize / 2)),
        },
      });
      return refined.kind === 'ready' ? refined : null;
    },
  };
}

export interface GeographicFeatureProjectionPreparationStats {
  readonly preparationCount: number;
  readonly preparationDurationMs: number;
  readonly maxPreparationDurationMs: number;
  readonly overBudgetPreparationCount: number;
  /** The duration is already represented in cooperative scheduler totals. */
  readonly includedInScheduling?: boolean;
}

export interface PrepareResumableGeographicFeatureProjectionTiming {
  readonly budgetMs?: number;
  /** Start captured before dependency-scope planning when that setup must be
   * included in the preparation measurement. */
  readonly startedAtMs?: number;
  now(): number;
}

export interface PreparedResumableGeographicFeatureProjection {
  readonly plan: ResumableGeographicFeatureProjectionPlan;
  readonly stats: GeographicFeatureProjectionPreparationStats;
}

/**
 * Measures the synchronous planning boundary before resumable projection.
 * Keeping this time explicit prevents cold index work from masquerading as
 * cooperative work; it never changes the previously accepted scene.
 */
export function prepareResumableGeographicFeatureProjection(
  options: PlanResumableGeographicFeatureProjectionOptions,
  timing: PrepareResumableGeographicFeatureProjectionTiming,
): PreparedResumableGeographicFeatureProjection {
  const budgetMs = timing.budgetMs ?? 4;
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) {
    throw new RangeError('The render preparation budget must be a finite positive number.');
  }
  const startedAt = timing.startedAtMs ?? timing.now();
  const plan = planResumableGeographicFeatureProjection(options);
  const durationMs = timing.now() - startedAt;
  return {
    plan,
    stats: {
      preparationCount: 1,
      preparationDurationMs: durationMs,
      maxPreparationDurationMs: durationMs,
      overBudgetPreparationCount: durationMs > budgetMs ? 1 : 0,
    },
  };
}
