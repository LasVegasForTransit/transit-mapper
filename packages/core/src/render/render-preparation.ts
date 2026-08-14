import type { TransitSystem } from '../model/system';
import { addColdPreparationPlan } from './render-preparation-cold-plan';
import {
  ALL_RENDER_PREPARATION_CATEGORIES,
  MAX_PREPARED_VIEWPORT_SEGMENTS_PER_CATEGORY,
} from './render-preparation-constants';
import {
  createRenderPreparationPlanBuilder,
  type RenderPreparationPlanRuntime,
} from './render-preparation-plan-builder';
import {
  preparedSnapshotInternals,
  publishRenderPreparedSnapshot,
} from './render-preparation-snapshot';
import type {
  PlanRenderPreparationOptions,
  RenderPreparationCommitResult,
  RenderPreparationCoordinator,
  RenderPreparationCoordinatorOptions,
  RenderPreparationDiagnostics,
  RenderPreparationKind,
  RenderPreparationPlan,
  RenderPreparationRecordOptions,
  RenderPreparationUnitMeasurement,
  RenderPreparedSnapshot,
} from './render-preparation-types';
import {
  addCameraPreparationPlan,
  addIncrementalPreparationPlan,
} from './render-preparation-update-plan';
import type { RenderProjectionFullReason } from './render-projection-scope';
import type { RenderViewportCategory } from './viewport-index';

export type {
  PlanRenderPreparationOptions,
  RenderPreparationCommitResult,
  RenderPreparationCoordinator,
  RenderPreparationCoordinatorOptions,
  RenderPreparationDiagnostics,
  RenderPreparationEntityPatch,
  RenderPreparationKind,
  RenderPreparationOperationCounts,
  RenderPreparationPatch,
  RenderPreparationPlan,
  RenderPreparationRecordOptions,
  RenderPreparationUnit,
  RenderPreparationUnitMeasurement,
  RenderPreparationUnitRunResult,
  RenderPreparationUnits,
  RenderPreparedSnapshot,
} from './render-preparation-types';
export {
  ALL_RENDER_PREPARATION_CATEGORIES,
  MAX_PREPARED_VIEWPORT_SEGMENTS_PER_CATEGORY,
} from './render-preparation-constants';
export { preparedSnapshotInternals } from './render-preparation-snapshot';

function positiveChunkSize(value: number | undefined): number {
  const resolved = value ?? 4;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new RangeError('Renderer preparation entity chunk size must be a positive integer.');
  }
  return resolved;
}

function sameCategories(
  left: readonly RenderViewportCategory[],
  right: readonly RenderViewportCategory[],
): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function retainedCollections(previous: TransitSystem, next: TransitSystem): boolean {
  return (
    previous.nodes === next.nodes &&
    previous.services === next.services &&
    previous.stops === next.stops &&
    previous.stations === next.stations &&
    previous.namedWays === next.namedWays &&
    previous.facilities === next.facilities &&
    previous.groups === next.groups
  );
}

function preparationKind(
  current: RenderPreparedSnapshot | null,
  options: PlanRenderPreparationOptions,
): RenderPreparationKind {
  if (current?.system.id !== options.system.id) return 'cold';
  if (!sameCategories(current.categories, ALL_RENDER_PREPARATION_CATEGORIES)) return 'cold';
  if (
    current.system.ways === options.system.ways &&
    retainedCollections(current.system, options.system)
  ) {
    return 'camera';
  }
  if (options.patch?.ways && retainedCollections(current.system, options.system)) {
    const unsupported = Object.entries(options.patch).some(
      ([kind, patch]) => kind !== 'ways' && patch !== undefined,
    );
    const needsCompaction =
      preparedSnapshotInternals(current).viewport.incrementalLayerCount >=
      MAX_PREPARED_VIEWPORT_SEGMENTS_PER_CATEGORY;
    if (!unsupported && !needsCompaction) return 'incremental';
  }
  return 'cold';
}

function coldFullProjectionReason(
  current: RenderPreparedSnapshot | null,
  next: TransitSystem,
): RenderProjectionFullReason | undefined {
  if (!current) return undefined;
  if (current.system.id !== next.id) return 'document-change';
  if (current.system.services !== next.services) return 'service-bundle-allocation';
  return 'unsupported-prepared-delta';
}

class PreparationCoordinator implements RenderPreparationCoordinator {
  private generation = 0;
  private active: RenderPreparedSnapshot | null = null;
  private activeGeneration = 0;
  private readonly runtimes = new WeakMap<RenderPreparationPlan, RenderPreparationPlanRuntime>();
  private readonly maxUnitDurationMs: number;

  constructor(options: RenderPreparationCoordinatorOptions) {
    this.maxUnitDurationMs = options.maxUnitDurationMs ?? 4;
    if (!Number.isFinite(this.maxUnitDurationMs) || this.maxUnitDurationMs <= 0) {
      throw new RangeError('Renderer preparation unit budget must be positive.');
    }
  }

  plan(options: PlanRenderPreparationOptions): RenderPreparationPlan {
    const generation = ++this.generation;
    this.activeGeneration = generation;
    const kind = preparationKind(this.active, options);
    const builder = createRenderPreparationPlanBuilder(
      generation,
      kind,
      () => this.activeGeneration === generation,
    );
    const shared = {
      builder,
      options,
      categories: ALL_RENDER_PREPARATION_CATEGORIES,
      generation,
    };
    if (kind === 'cold') {
      addColdPreparationPlan({
        ...shared,
        chunkSize: positiveChunkSize(options.entityChunkSize),
        fullProjectionReason: coldFullProjectionReason(this.active, options.system),
      });
    } else if (kind === 'incremental' && this.active) {
      addIncrementalPreparationPlan({ ...shared, current: this.active });
    } else if (this.active) {
      addCameraPreparationPlan({ ...shared, current: this.active });
    }
    const plan: RenderPreparationPlan = {
      generation,
      kind,
      units: builder.units,
      plannedOperations: { ...builder.runtime.operations },
    };
    this.runtimes.set(plan, builder.runtime);
    return plan;
  }

  record(
    plan: RenderPreparationPlan,
    measurement: RenderPreparationUnitMeasurement,
    options: RenderPreparationRecordOptions = {},
  ): void {
    const runtime = this.runtimes.get(plan);
    if (!runtime || runtime.closed || plan.generation !== this.activeGeneration) return;
    if (runtime.budgetExceeded) return;
    if (runtime.nextRecordIndex >= plan.units.length) {
      throw new Error('Renderer preparation received an extra unit measurement.');
    }
    const expected = plan.units[runtime.nextRecordIndex];
    if (measurement.unitId !== expected.id) {
      throw new Error('Renderer preparation measurements must follow unit order.');
    }
    if (
      measurement.result.kind !== 'completed' ||
      measurement.result.generation !== plan.generation ||
      measurement.result.unitId !== expected.id
    ) {
      return;
    }
    if (!Number.isFinite(measurement.durationMs) || measurement.durationMs < 0) {
      throw new RangeError('Renderer preparation duration must be a finite non-negative number.');
    }
    runtime.nextRecordIndex++;
    runtime.totalDurationMs += measurement.durationMs;
    runtime.maxDurationMs = Math.max(runtime.maxDurationMs, measurement.durationMs);
    if (measurement.durationMs > this.maxUnitDurationMs && options.tolerateBudgetOverrun !== true) {
      runtime.budgetExceeded = {
        unitId: measurement.unitId,
        measuredMs: measurement.durationMs,
      };
    }
  }

  commit(plan: RenderPreparationPlan): RenderPreparationCommitResult {
    const runtime = this.runtimes.get(plan);
    if (!runtime || plan.generation !== this.activeGeneration) {
      return { kind: 'stale', generation: plan.generation };
    }
    if (runtime.budgetExceeded) {
      runtime.closed = true;
      return {
        kind: 'budget-exceeded',
        unitId: runtime.budgetExceeded.unitId,
        limitMs: this.maxUnitDurationMs,
        measuredMs: runtime.budgetExceeded.measuredMs,
        previous: this.active,
      };
    }
    if (runtime.nextRecordIndex !== plan.units.length || !runtime.snapshot) {
      return {
        kind: 'incomplete',
        completedUnits: runtime.nextRecordIndex,
        unitCount: plan.units.length,
      };
    }
    const diagnostics: RenderPreparationDiagnostics = {
      kind: runtime.kind,
      ...runtime.operations,
      unitCount: plan.units.length,
      totalMeasuredDurationMs: runtime.totalDurationMs,
      maxMeasuredUnitDurationMs: runtime.maxDurationMs,
      atomicPublishOperations: 1,
    };
    const snapshot = publishRenderPreparedSnapshot(runtime.snapshot, diagnostics);
    this.active = snapshot;
    runtime.closed = true;
    return { kind: 'committed', snapshot };
  }

  current(): RenderPreparedSnapshot | null {
    return this.active;
  }
}

export function createRenderPreparationCoordinator(
  options: RenderPreparationCoordinatorOptions = {},
): RenderPreparationCoordinator {
  return new PreparationCoordinator(options);
}
