import { resolveWayPath } from '../model/geo';
import type { NamedWay } from '../model/system';
import {
  addPreparedNamedWays,
  addPreparedNodes,
  addPreparedServices,
  addPreparedStationWayIds,
  createMutablePreparedDependencyState,
  emptyPreparedClosure,
  type PreparedDependencyState,
} from './render-preparation-dependencies';
import {
  addPreparedServiceBundle,
  createPreparedServiceBundleDraft,
} from './render-preparation-bundles';
import type {
  AddColdPreparationPlanOptions,
  ColdDomainDraft,
  ColdPlanContext,
} from './render-preparation-cold-types';
import { addColdCorridorViewportPlan } from './render-preparation-corridor-viewport-plan';
import {
  appendColdViewportGeometry,
  createColdPreparedViewportCategory,
  createPreparedViewportDraft,
  emptyPreparedViewportState,
  finalizeColdPreparedViewportCategory,
  indexColdPreparedViewportEntry,
  recordColdViewportEntryMetadata,
  reserveColdPreparedViewportEntries,
  reservePreparedViewportCandidates,
} from './render-preparation-viewport';
import { exactNearWayIds, nearWayCandidateIds } from './render-preparation-station-proximity';
import {
  finalizePreparedViewportState,
  preparedViewportCandidates,
  preparedViewportFinalizeOperationCount,
} from './render-preparation-viewport-state';
import {
  facilityViewportEntry,
  groupViewportEntry,
  junctionViewportEntry,
  stationViewportEntry,
  type ViewportSpatialEntry,
} from './viewport-index-entries';
import type { RenderViewportCategory } from './viewport-index';

function createColdDomainDraft(): ColdDomainDraft {
  return {
    waysById: new Map(),
    nodesById: new Map(),
    servicesById: new Map(),
    stationsById: new Map(),
    namedWaysById: new Map(),
    facilitiesById: new Map(),
    groupsById: new Map(),
    wayRank: new Map(),
    nodeRank: new Map(),
    stationRank: new Map(),
    modeIds: new Set(),
    wayTypeIds: new Set(),
  };
}

function createColdPlanContext(input: AddColdPreparationPlanOptions): ColdPlanContext {
  return {
    ...input,
    categorySet: new Set(input.categories),
    domain: createColdDomainDraft(),
    dependency: createMutablePreparedDependencyState(),
    viewport: createPreparedViewportDraft(emptyPreparedViewportState()),
    coldViewport: new Map(
      input.categories.map((category) => [category, createColdPreparedViewportCategory()]),
    ),
    bundles: createPreparedServiceBundleDraft(),
  };
}

function addDomainBatch<T extends { id: string }>(
  target: Map<string, T>,
  rank: Map<string, number> | null,
  values: readonly T[],
  offset: number,
): void {
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    target.set(value.id, value);
    if (rank) rank.set(value.id, offset + index);
  }
}

function addViewport<T extends { id: string }>(
  context: ColdPlanContext,
  category: RenderViewportCategory,
  values: readonly T[],
  entryFor: (value: T) => ViewportSpatialEntry,
): void {
  if (!context.categorySet.has(category)) return;
  const cold = context.coldViewport.get(category);
  if (!cold) return;
  reserveColdPreparedViewportEntries(cold, values.length);
  reservePreparedViewportCandidates(context.viewport, category, values.length);
  context.builder.runtime.operations.viewportEntityBuilds += values.length;
  context.builder.runtime.operations.viewportSegmentQueries += values.length * 2;
  context.builder.addUnitRange(
    values.length,
    'viewport-build',
    `entity:${category}`,
    () => 1,
    (index) => {
      const entry = entryFor(values[index]);
      appendColdViewportGeometry(cold, entry);
      recordColdViewportEntryMetadata({
        draft: context.viewport,
        category,
        ownerId: values[index].id,
        entry,
        generation: context.generation,
        presentation: context.options.presentation,
        candidateEnvelope: context.options.candidateEnvelope,
        cold,
      });
      indexColdPreparedViewportEntry(cold, index);
    },
  );
}

function addWays(context: ColdPlanContext): void {
  const { ways } = context.options.system;
  context.builder.runtime.operations.domainEntityVisits += ways.length;
  context.builder.runtime.operations.dependencyEntityVisits += ways.length;
  context.builder.addUnitRange(
    Math.ceil(ways.length / context.chunkSize),
    'dependency',
    'way-domain',
    (index) => Math.min(context.chunkSize, ways.length - index * context.chunkSize),
    (index) => {
      const start = index * context.chunkSize;
      const batch = ways.slice(start, start + context.chunkSize);
      addDomainBatch(context.domain.waysById, context.domain.wayRank, batch, start);
      for (const way of batch) context.domain.wayTypeIds.add(way.typeId);
    },
  );
  addColdCorridorViewportPlan(context, ways);
}

function addNodes(context: ColdPlanContext): void {
  const { nodes } = context.options.system;
  context.builder.runtime.operations.domainEntityVisits += nodes.length;
  context.builder.runtime.operations.dependencyEntityVisits += nodes.length;
  context.builder.addUnitRange(
    Math.ceil(nodes.length / context.chunkSize),
    'dependency',
    'node-dependencies',
    (index) => Math.min(context.chunkSize, nodes.length - index * context.chunkSize),
    (index) => {
      const start = index * context.chunkSize;
      const batch = nodes.slice(start, start + context.chunkSize);
      addDomainBatch(context.domain.nodesById, context.domain.nodeRank, batch, start);
      addPreparedNodes(context.dependency, batch);
    },
  );
  addViewport(context, 'junction', nodes, junctionViewportEntry);
}

function addServices(context: ColdPlanContext): void {
  const { services } = context.options.system;
  context.builder.runtime.operations.domainEntityVisits += services.length;
  context.builder.runtime.operations.dependencyEntityVisits += services.length;
  context.builder.addUnitRange(
    services.length,
    'dependency',
    'service-dependencies-and-bundle',
    () => 1,
    (index) => {
      const service = services[index];
      context.domain.servicesById.set(service.id, service);
      context.domain.modeIds.add(service.modeId);
      addPreparedServices(context.dependency, [service]);
      addPreparedServiceBundle(context.bundles, service);
    },
  );
}

function addStations(context: ColdPlanContext): void {
  const { stations } = context.options.system;
  const stationViewport = context.categorySet.has('station')
    ? context.coldViewport.get('station')
    : undefined;
  if (stationViewport) {
    reserveColdPreparedViewportEntries(stationViewport, stations.length);
    reservePreparedViewportCandidates(context.viewport, 'station', stations.length);
    context.builder.runtime.operations.viewportEntityBuilds += stations.length;
    context.builder.runtime.operations.viewportSegmentQueries += stations.length * 2;
  }
  let candidateIds: readonly string[] = [];
  context.builder.runtime.operations.domainEntityVisits += stations.length;
  context.builder.runtime.operations.dependencyEntityVisits += stations.length;
  context.builder.addUnitRange(
    stations.length * 2,
    'dependency',
    'station-proximity',
    () => 1,
    (index) => {
      const stationIndex = Math.floor(index / 2);
      const station = stations[stationIndex];
      if (index % 2 === 0) {
        candidateIds = nearWayCandidateIds(context, station);
        return;
      }
      const wayIds = exactNearWayIds(context, station, candidateIds);
      addDomainBatch(
        context.domain.stationsById,
        context.domain.stationRank,
        [station],
        stationIndex,
      );
      addPreparedStationWayIds(context.dependency, station, wayIds);
      if (stationViewport) {
        const entry = stationViewportEntry(station);
        appendColdViewportGeometry(stationViewport, entry);
        recordColdViewportEntryMetadata({
          draft: context.viewport,
          category: 'station',
          ownerId: station.id,
          entry,
          generation: context.generation,
          presentation: context.options.presentation,
          candidateEnvelope: context.options.candidateEnvelope,
          cold: stationViewport,
        });
        indexColdPreparedViewportEntry(stationViewport, stationIndex);
      }
    },
  );
}

function labelEntry(context: ColdPlanContext, namedWay: NamedWay): ViewportSpatialEntry {
  return {
    id: namedWay.id,
    paths: namedWay.wayIds.flatMap((wayId) => {
      const way = context.domain.waysById.get(wayId);
      return way ? [resolveWayPath(way)] : [];
    }),
  };
}

function addNamedWays(context: ColdPlanContext): void {
  const { namedWays } = context.options.system;
  context.builder.runtime.operations.domainEntityVisits += namedWays.length;
  context.builder.runtime.operations.dependencyEntityVisits += namedWays.length;
  context.builder.addUnitRange(
    Math.ceil(namedWays.length / context.chunkSize),
    'dependency',
    'named-way-dependencies',
    (index) => Math.min(context.chunkSize, namedWays.length - index * context.chunkSize),
    (index) => {
      const start = index * context.chunkSize;
      const batch = namedWays.slice(start, start + context.chunkSize);
      addDomainBatch(context.domain.namedWaysById, null, batch, start);
      addPreparedNamedWays(context.dependency, batch);
    },
  );
  addViewport(context, 'label', namedWays, (namedWay) => labelEntry(context, namedWay));
}

interface DomainCollectionOptions<T extends { id: string }> {
  readonly context: ColdPlanContext;
  readonly values: readonly T[];
  readonly target: Map<string, T>;
  readonly label: string;
}

function addDomainCollection<T extends { id: string }>(options: DomainCollectionOptions<T>): void {
  const { context, values } = options;
  context.builder.runtime.operations.domainEntityVisits += values.length;
  context.builder.addUnitRange(
    Math.ceil(values.length / context.chunkSize),
    'domain',
    `index:${options.label}`,
    (index) => Math.min(context.chunkSize, values.length - index * context.chunkSize),
    (index) => {
      const start = index * context.chunkSize;
      addDomainBatch(options.target, null, values.slice(start, start + context.chunkSize), start);
    },
  );
}

function addFacilitiesAndGroups(context: ColdPlanContext): void {
  const { facilities, groups } = context.options.system;
  addDomainCollection({
    context,
    values: facilities,
    target: context.domain.facilitiesById,
    label: 'facilities',
  });
  addViewport(context, 'facility', facilities, facilityViewportEntry);
  addDomainCollection({
    context,
    values: groups,
    target: context.domain.groupsById,
    label: 'groups',
  });
  addViewport(context, 'group', groups, groupViewportEntry);
}

function addFinalization(context: ColdPlanContext): void {
  context.builder.addUnitRange(
    context.categories.length,
    'finalize',
    'viewport-grid',
    () => 1,
    (index) => {
      const category = context.categories[index];
      const cold = context.coldViewport.get(category);
      if (cold) {
        finalizeColdPreparedViewportCategory(context.viewport, category, context.generation, cold);
      }
    },
  );
  let viewportState = emptyPreparedViewportState();
  context.builder.addUnit(
    'finalize',
    preparedViewportFinalizeOperationCount(context.viewport),
    () => {
      viewportState = finalizePreparedViewportState(context.viewport, 'cold');
    },
    'viewport-state',
  );
  context.builder.addUnit(
    'finalize',
    1,
    () => {
      const dependency: PreparedDependencyState = context.dependency;
      context.builder.runtime.snapshot = {
        revision: context.options.revision,
        generation: context.generation,
        system: context.options.system,
        presentation: context.options.presentation,
        ...(context.options.candidateEnvelope
          ? { candidateEnvelope: context.options.candidateEnvelope }
          : {}),
        categories: context.categories,
        candidates: preparedViewportCandidates(context.viewport, context.categorySet),
        invalidation: emptyPreparedClosure(),
        ...(context.fullProjectionReason
          ? { fullProjectionReason: context.fullProjectionReason }
          : {}),
        waysById: context.domain.waysById,
        nodesById: context.domain.nodesById,
        servicesById: context.domain.servicesById,
        stationsById: context.domain.stationsById,
        namedWaysById: context.domain.namedWaysById,
        facilitiesById: context.domain.facilitiesById,
        groupsById: context.domain.groupsById,
        servicesByWay: context.bundles.servicesByWay,
        serviceBundleSlots: context.bundles.slots,
        wayIdsByStation: dependency.wayIdsByStation,
        modeIds: context.domain.modeIds,
        wayTypeIds: context.domain.wayTypeIds,
        internals: {
          dependency,
          viewport: viewportState,
          wayRank: context.domain.wayRank,
          nodeRank: context.domain.nodeRank,
          stationRank: context.domain.stationRank,
        },
      };
    },
    'snapshot-draft',
  );
}

export function addColdPreparationPlan(input: AddColdPreparationPlanOptions): void {
  const context = createColdPlanContext(input);
  addWays(context);
  addNodes(context);
  addServices(context);
  addStations(context);
  addNamedWays(context);
  addFacilitiesAndGroups(context);
  addFinalization(context);
}
