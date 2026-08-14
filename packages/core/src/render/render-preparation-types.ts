import type {
  Facility,
  Group,
  NamedWay,
  Node,
  Service,
  Station,
  Stop,
  TransitSystem,
  Way,
} from '../model/system';
import type { RenderDependencyClosure } from './dependency-index';
import type { RenderCandidateEnvelope } from './render-candidate-envelope';
import type { RenderPresentation } from './render-presentation';
import type { RenderProjectionFullReason } from './render-projection-scope';
import type { RenderViewportCandidateSets } from './render-viewport-candidates';
import type { RenderViewportCategory } from './viewport-index';

export interface RenderPreparationEntityPatch<T> {
  readonly upsert?: readonly T[];
  readonly removeIds?: readonly string[];
}

/** Exact immutable entity delta produced by editor mutations. Bulk imports,
 * undo, and document replacement deliberately omit this and take the cold,
 * cooperatively chunked path. */
export interface RenderPreparationPatch {
  readonly ways?: RenderPreparationEntityPatch<Way>;
  readonly nodes?: RenderPreparationEntityPatch<Node>;
  readonly services?: RenderPreparationEntityPatch<Service>;
  readonly stops?: RenderPreparationEntityPatch<Stop>;
  readonly stations?: RenderPreparationEntityPatch<Station>;
  readonly namedWays?: RenderPreparationEntityPatch<NamedWay>;
  readonly facilities?: RenderPreparationEntityPatch<Facility>;
  readonly groups?: RenderPreparationEntityPatch<Group>;
}

export interface PlanRenderPreparationOptions {
  readonly revision: string;
  readonly system: TransitSystem;
  readonly presentation: RenderPresentation;
  readonly candidateEnvelope?: RenderCandidateEnvelope;
  readonly categories: readonly RenderViewportCategory[];
  readonly patch?: RenderPreparationPatch;
  readonly entityChunkSize?: number;
}

export type RenderPreparationKind = 'cold' | 'incremental' | 'camera';

export interface RenderPreparationOperationCounts {
  readonly domainEntityVisits: number;
  readonly dependencyEntityVisits: number;
  readonly viewportEntityBuilds: number;
  readonly viewportSegmentQueries: number;
  readonly overlayWrites: number;
}

export interface RenderPreparationDiagnostics extends RenderPreparationOperationCounts {
  readonly kind: RenderPreparationKind;
  readonly unitCount: number;
  readonly totalMeasuredDurationMs: number;
  readonly maxMeasuredUnitDurationMs: number;
  /** Publication swaps one already-resolved object reference. */
  readonly atomicPublishOperations: 1;
}

export interface RenderPreparedSnapshot {
  readonly kind: 'render-prepared-snapshot';
  readonly revision: string;
  readonly generation: number;
  readonly system: TransitSystem;
  readonly presentation: RenderPresentation;
  /** Live-only spatial query policy used to resolve `candidates`. */
  readonly candidateEnvelope?: RenderCandidateEnvelope;
  readonly categories: readonly RenderViewportCategory[];
  readonly candidates: RenderViewportCandidateSets;
  readonly invalidation: RenderDependencyClosure;
  /** Explicit full-projection requirement for this prepared transition. */
  readonly fullProjectionReason?: RenderProjectionFullReason;
  readonly waysById: ReadonlyMap<string, Way>;
  readonly nodesById: ReadonlyMap<string, Node>;
  readonly servicesById: ReadonlyMap<string, Service>;
  readonly stopsById: ReadonlyMap<string, Stop>;
  readonly stationsById: ReadonlyMap<string, Station>;
  readonly namedWaysById: ReadonlyMap<string, NamedWay>;
  readonly facilitiesById: ReadonlyMap<string, Facility>;
  readonly groupsById: ReadonlyMap<string, Group>;
  readonly servicesByWay: ReadonlyMap<string, readonly Service[]>;
  readonly serviceBundleSlots: ReadonlyMap<string, number>;
  readonly wayIdsByStop: ReadonlyMap<string, readonly string[]>;
  readonly modeIds: ReadonlySet<string>;
  readonly wayTypeIds: ReadonlySet<string>;
  readonly diagnostics: RenderPreparationDiagnostics;
}

export type RenderPreparationUnitRunResult =
  | { readonly kind: 'completed'; readonly generation: number; readonly unitId: string }
  | { readonly kind: 'stale' };

export interface RenderPreparationUnit {
  readonly id: string;
  readonly stage: 'domain' | 'dependency' | 'viewport-build' | 'viewport-query' | 'finalize';
  /** Stable semantic work name included in budget diagnostics. */
  readonly label: string;
  readonly operationCount: number;
  run(): RenderPreparationUnitRunResult;
}

export interface RenderPreparationUnitMeasurement {
  readonly unitId: string;
  readonly result: RenderPreparationUnitRunResult;
  readonly durationMs: number;
}

export interface RenderPreparationPlan {
  readonly generation: number;
  readonly kind: RenderPreparationKind;
  readonly units: RenderPreparationUnits;
  readonly plannedOperations: RenderPreparationOperationCounts;
}

/** Range-backed production plans expose `unitAt` without requiring eager unit
 * allocation. Plain arrays remain valid for small test and adapter plans. */
export interface RenderPreparationUnits extends ReadonlyArray<RenderPreparationUnit> {
  unitAt?(index: number): RenderPreparationUnit | undefined;
  readonly rangeCount?: number;
  materializedCount?(): number;
}

export type RenderPreparationCommitResult =
  | { readonly kind: 'committed'; readonly snapshot: RenderPreparedSnapshot }
  | {
      readonly kind: 'budget-exceeded';
      readonly unitId: string;
      readonly limitMs: number;
      readonly measuredMs: number;
      readonly previous: RenderPreparedSnapshot | null;
    }
  | { readonly kind: 'incomplete'; readonly completedUnits: number; readonly unitCount: number }
  | { readonly kind: 'stale'; readonly generation: number };

export interface RenderPreparationCoordinatorOptions {
  readonly maxUnitDurationMs?: number;
}

export interface RenderPreparationRecordOptions {
  /** Preserve elapsed-time diagnostics while allowing a structurally minimal
   * private plan to finish after GC/JIT was charged to an indivisible unit. */
  readonly tolerateBudgetOverrun?: boolean;
}

export interface RenderPreparationCoordinator {
  plan(options: PlanRenderPreparationOptions): RenderPreparationPlan;
  record(
    plan: RenderPreparationPlan,
    measurement: RenderPreparationUnitMeasurement,
    options?: RenderPreparationRecordOptions,
  ): void;
  commit(plan: RenderPreparationPlan): RenderPreparationCommitResult;
  current(): RenderPreparedSnapshot | null;
}
