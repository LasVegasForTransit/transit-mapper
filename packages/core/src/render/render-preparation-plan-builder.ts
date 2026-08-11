import type {
  Facility,
  Group,
  NamedWay,
  Node,
  Service,
  Station,
  TransitSystem,
  Way,
} from '../model/system';
import type { PreparedDependencyState } from './render-preparation-dependencies';
import type {
  PlanRenderPreparationOptions,
  RenderPreparationKind,
  RenderPreparationOperationCounts,
  RenderPreparationUnit,
  RenderPreparationUnits,
  RenderPreparedSnapshot,
} from './render-preparation-types';
import type { PreparedViewportState } from './render-preparation-viewport';
import type { RenderProjectionFullReason } from './render-projection-scope';
import type { RenderViewportCategory } from './viewport-index';

export interface PreparedSnapshotInternals {
  readonly dependency: PreparedDependencyState;
  readonly viewport: PreparedViewportState;
  readonly wayRank: ReadonlyMap<string, number>;
  readonly nodeRank: ReadonlyMap<string, number>;
  readonly stationRank: ReadonlyMap<string, number>;
}

export interface RenderPreparationSnapshotDraft {
  readonly revision: string;
  readonly generation: number;
  readonly system: TransitSystem;
  readonly presentation: PlanRenderPreparationOptions['presentation'];
  readonly candidateEnvelope?: PlanRenderPreparationOptions['candidateEnvelope'];
  readonly categories: readonly RenderViewportCategory[];
  readonly candidates: RenderPreparedSnapshot['candidates'];
  readonly invalidation: RenderPreparedSnapshot['invalidation'];
  readonly fullProjectionReason?: RenderProjectionFullReason;
  readonly waysById: ReadonlyMap<string, Way>;
  readonly nodesById: ReadonlyMap<string, Node>;
  readonly servicesById: ReadonlyMap<string, Service>;
  readonly stationsById: ReadonlyMap<string, Station>;
  readonly namedWaysById: ReadonlyMap<string, NamedWay>;
  readonly facilitiesById: ReadonlyMap<string, Facility>;
  readonly groupsById: ReadonlyMap<string, Group>;
  readonly servicesByWay: ReadonlyMap<string, readonly Service[]>;
  readonly serviceBundleSlots: ReadonlyMap<string, number>;
  readonly wayIdsByStation: ReadonlyMap<string, readonly string[]>;
  readonly modeIds: ReadonlySet<string>;
  readonly wayTypeIds: ReadonlySet<string>;
  readonly internals: PreparedSnapshotInternals;
}

type MutableOperationCounts = {
  -readonly [Key in keyof RenderPreparationOperationCounts]: RenderPreparationOperationCounts[Key];
};

export interface RenderPreparationPlanRuntime {
  readonly generation: number;
  readonly kind: RenderPreparationKind;
  readonly operations: MutableOperationCounts;
  nextRunIndex: number;
  nextRecordIndex: number;
  totalDurationMs: number;
  maxDurationMs: number;
  budgetExceeded: { unitId: string; measuredMs: number } | null;
  snapshot: RenderPreparationSnapshotDraft | null;
  closed: boolean;
}

export interface RenderPreparationPlanBuilder {
  readonly runtime: RenderPreparationPlanRuntime;
  readonly units: RenderPreparationUnits;
  addUnit(
    stage: RenderPreparationUnit['stage'],
    operationCount: number,
    action: () => void,
    label?: string,
  ): void;
  addUnitRange(
    count: number,
    stage: RenderPreparationUnit['stage'],
    label: string,
    operationCountAt: (index: number) => number,
    actionAt: (index: number) => void,
  ): void;
  addDeferredUnitRange(
    count: () => number,
    stage: RenderPreparationUnit['stage'],
    label: string,
    operationCountAt: (index: number) => number,
    actionAt: (index: number) => void,
  ): void;
}

interface UnitRange {
  readonly count: () => number;
  readonly stage: RenderPreparationUnit['stage'];
  readonly label: string;
  readonly operationCountAt: (index: number) => number;
  readonly actionAt: (index: number) => void;
}

function emptyOperations(): MutableOperationCounts {
  return {
    domainEntityVisits: 0,
    dependencyEntityVisits: 0,
    viewportEntityBuilds: 0,
    viewportSegmentQueries: 0,
    overlayWrites: 0,
  };
}

function numericIndex(property: PropertyKey): number | null {
  if (typeof property !== 'string' || !/^(?:0|[1-9]\d*)$/.test(property)) return null;
  const index = Number(property);
  return Number.isSafeInteger(index) ? index : null;
}

interface UnitAtOptions {
  readonly target: RenderPreparationUnit[];
  readonly ranges: readonly UnitRange[];
  readonly cache: Map<number, RenderPreparationUnit>;
  readonly runtime: RenderPreparationPlanRuntime;
  readonly isCurrent: () => boolean;
}

function createUnitAt(
  options: UnitAtOptions,
): (index: number) => RenderPreparationUnit | undefined {
  return (unitIndex) => {
    if (!Number.isSafeInteger(unitIndex) || unitIndex < 0) return undefined;
    let range: UnitRange | undefined;
    let rangeStart = 0;
    let totalCount = 0;
    for (const candidate of options.ranges) {
      const count = candidate.count();
      if (!Number.isSafeInteger(count) || count < 0) {
        throw new RangeError('Deferred renderer preparation range count must be non-negative.');
      }
      if (!range && unitIndex >= totalCount && unitIndex < totalCount + count) {
        range = candidate;
        rangeStart = totalCount;
      }
      totalCount += count;
    }
    if (options.target.length !== totalCount) options.cache.clear();
    options.target.length = totalCount;
    if (!range) return undefined;
    const cached = options.cache.get(unitIndex);
    if (cached) return cached;
    const rangeIndex = unitIndex - rangeStart;
    const id = `${range.stage}:${range.label}:${unitIndex}`;
    const unit: RenderPreparationUnit = {
      id,
      stage: range.stage,
      label: range.label,
      operationCount: range.operationCountAt(rangeIndex),
      run: () => {
        if (
          !options.isCurrent() ||
          options.runtime.closed ||
          options.runtime.budgetExceeded ||
          options.runtime.nextRunIndex !== unitIndex
        ) {
          return { kind: 'stale' };
        }
        range.actionAt(rangeIndex);
        options.runtime.nextRunIndex++;
        return { kind: 'completed', generation: options.runtime.generation, unitId: id };
      },
    };
    // The scheduler consumes units sequentially and retains the descriptor it
    // is about to run. Keeping every materialized descriptor would turn a lazy
    // RTC plan back into tens of thousands of live closures and invite a GC
    // pause inside an unrelated measured unit.
    options.cache.clear();
    options.cache.set(unitIndex, unit);
    return unit;
  };
}

function createLazyUnits(
  target: RenderPreparationUnit[],
  ranges: readonly UnitRange[],
  unitAt: (index: number) => RenderPreparationUnit | undefined,
  cache: ReadonlyMap<number, RenderPreparationUnit>,
): RenderPreparationUnits {
  return new Proxy(target, {
    get(array, property, receiver) {
      if (property === 'unitAt') return unitAt;
      if (property === 'rangeCount') return ranges.length;
      if (property === 'materializedCount') return () => cache.size;
      const index = numericIndex(property);
      if (index !== null) return unitAt(index);
      const reflected: unknown = Reflect.get(array, property, receiver);
      return reflected;
    },
    has(array, property) {
      const index = numericIndex(property);
      if (index !== null) return index >= 0 && index < array.length;
      return Reflect.has(array, property);
    },
  });
}

export function createRenderPreparationPlanBuilder(
  generation: number,
  kind: RenderPreparationKind,
  isCurrent: () => boolean,
): RenderPreparationPlanBuilder {
  const runtime: RenderPreparationPlanRuntime = {
    generation,
    kind,
    operations: emptyOperations(),
    nextRunIndex: 0,
    nextRecordIndex: 0,
    totalDurationMs: 0,
    maxDurationMs: 0,
    budgetExceeded: null,
    snapshot: null,
    closed: false,
  };
  const ranges: UnitRange[] = [];
  const cache = new Map<number, RenderPreparationUnit>();
  const target: RenderPreparationUnit[] = [];
  const unitAt = createUnitAt({ target, ranges, cache, runtime, isCurrent });
  const units = createLazyUnits(target, ranges, unitAt, cache);
  const addRange = (...args: Parameters<RenderPreparationPlanBuilder['addUnitRange']>): void => {
    const [count, stage, label, operationCountAt, actionAt] = args;
    if (count <= 0) return;
    ranges.push({ count: () => count, stage, label, operationCountAt, actionAt });
    target.length += count;
  };
  const addDeferredRange = (
    ...args: Parameters<RenderPreparationPlanBuilder['addDeferredUnitRange']>
  ): void => {
    const [count, stage, label, operationCountAt, actionAt] = args;
    ranges.push({ count, stage, label, operationCountAt, actionAt });
    target.length += Math.max(1, count());
  };
  return {
    runtime,
    units,
    addUnit(stage, operationCount, action, label = 'unit') {
      addRange(1, stage, label, () => operationCount, action);
    },
    addUnitRange: addRange,
    addDeferredUnitRange: addDeferredRange,
  };
}
