import { namedWayLabelDependencyId } from '@transitmapper/core/render/dependency-index';
import { wayById } from '@transitmapper/core/model/geo';
import {
  renderGroupsById,
  renderNamedWaysById,
  renderServicesById,
  renderStationsById,
} from '@transitmapper/core/render/render-domain-indexes';
import {
  groupFootprintPointRenderId,
  serviceTerminusDescriptors,
  stationFootprintPointRenderId,
  stationPlatformPointRenderId,
  wayControlPointRenderId,
} from '@transitmapper/core/render/viewport-feature-identities';
import {
  SRC_CONNECTORS,
  SRC_FACILITIES,
  SRC_FOOTPRINTS,
  SRC_HANDLES,
  SRC_JUNCTIONS,
  SRC_PHYSICAL_HANDLES,
  SRC_SERVICE_TERMINI,
  SRC_WAY_LABELS,
} from './layers';
import {
  CORRIDOR_SOURCES,
  JUNCTION_SOURCES,
  PHYSICAL_CORRIDOR_SOURCES,
  PHYSICAL_STATION_SOURCES,
  SERVICE_CORRIDOR_SOURCES,
  STOP_SOURCES,
  addProjectionUnit,
  chunks,
  intersectIds,
  orderedUnion,
  sourceSubset,
  type ProjectionPlanningContext,
} from './resumable-feature-projection-planning';

function orderedAdjacencyUnion(
  primaryIds: readonly string[],
  adjacency: ReadonlyMap<string, readonly string[]>,
  orderById: ReadonlyMap<string, number>,
  allowed?: ReadonlySet<string>,
): readonly string[] {
  const ids = new Set<string>();
  for (const primaryId of primaryIds) {
    for (const id of adjacency.get(primaryId) ?? []) {
      if (!allowed || allowed.has(id)) ids.add(id);
    }
  }
  return [...ids].sort(
    (left, right) =>
      (orderById.get(left) ?? Number.MAX_SAFE_INTEGER) -
      (orderById.get(right) ?? Number.MAX_SAFE_INTEGER),
  );
}

function planCorridorUnits(context: ProjectionPlanningContext): void {
  const corridorSources = sourceSubset(context.sourceIds, CORRIDOR_SOURCES);
  if (corridorSources.length === 0) return;
  const physicalSources = sourceSubset(corridorSources, PHYSICAL_CORRIDOR_SOURCES);
  const serviceSources = sourceSubset(corridorSources, SERVICE_CORRIDOR_SOURCES);
  const physicalWayIds = physicalSources.length
    ? intersectIds(context.visibleWayIds, context.scope?.candidates.physicalWayIds)
    : [];
  const serviceWayIds = serviceSources.length
    ? intersectIds(context.visibleWayIds, context.scope?.candidates.serviceWayIds)
    : [];
  const primaryWayIds = orderedUnion(context.visibleWayIds, physicalWayIds, serviceWayIds);
  const physicalSet = new Set(physicalWayIds);
  const serviceSet = new Set(serviceWayIds);
  const geometryNodeIds = intersectIds(
    context.visibleJunctionIds,
    context.scope?.candidates.geometryNodeIds,
  );
  const geometryNodeSet = new Set(geometryNodeIds);
  for (const wayBatch of chunks(primaryWayIds, context.batchSizes.corridors)) {
    const incidentNodeIds = orderedAdjacencyUnion(
      wayBatch,
      context.incidentJunctionIdsByWay,
      context.visibleJunctionOrderById,
      geometryNodeSet,
    );
    addProjectionUnit(context, {
      kind: 'corridor',
      primaryIds: wayBatch,
      sourceIds: corridorSources,
      unitScope: {
        topologyWayIds: wayBatch,
        physicalWayIds: wayBatch.filter((id) => physicalSet.has(id)),
        serviceWayIds: wayBatch.filter((id) => serviceSet.has(id)),
        geometryNodeIds: incidentNodeIds,
        junctionOutputNodeIds: [],
        connectorOutputNodeIds: [],
        serviceIds: context.scope?.candidates.affectedServiceIds,
      },
      viewportCandidates: {
        wayIds: wayBatch,
        wayIdSet: new Set(wayBatch),
        junctionIds: incidentNodeIds,
      },
    });
  }
}

function planJunctionUnits(context: ProjectionPlanningContext): void {
  const junctionSources = sourceSubset(context.sourceIds, JUNCTION_SOURCES);
  if (junctionSources.length === 0) return;
  const geometryNodeIds = intersectIds(
    context.visibleJunctionIds,
    context.scope?.candidates.geometryNodeIds,
  );
  const junctionNodeIds = context.sourceIds.includes(SRC_JUNCTIONS)
    ? intersectIds(geometryNodeIds, context.scope?.candidates.junctionNodeIds)
    : [];
  const connectorNodeIds = context.sourceIds.includes(SRC_CONNECTORS)
    ? intersectIds(geometryNodeIds, context.scope?.candidates.connectorNodeIds)
    : [];
  const primaryNodeIds = orderedUnion(geometryNodeIds, junctionNodeIds, connectorNodeIds);
  const junctionSet = new Set(junctionNodeIds);
  const connectorSet = new Set(connectorNodeIds);
  for (const nodeBatch of chunks(primaryNodeIds, context.batchSizes.junctions)) {
    const incidentWayIds = orderedAdjacencyUnion(
      nodeBatch,
      context.incidentWayIdsByJunction,
      context.visibleWayOrderById,
    );
    addProjectionUnit(context, {
      kind: 'junction',
      primaryIds: nodeBatch,
      sourceIds: junctionSources,
      unitScope: {
        topologyWayIds: incidentWayIds,
        physicalWayIds: [],
        serviceWayIds: [],
        geometryNodeIds: nodeBatch,
        junctionOutputNodeIds: nodeBatch.filter((id) => junctionSet.has(id)),
        connectorOutputNodeIds: nodeBatch.filter((id) => connectorSet.has(id)),
        serviceIds: context.scope?.candidates.affectedServiceIds,
      },
      viewportCandidates: {
        wayIds: incidentWayIds,
        wayIdSet: new Set(incidentWayIds),
        junctionIds: nodeBatch,
      },
    });
  }
}

function planStopUnits(context: ProjectionPlanningContext): void {
  const stopSources = sourceSubset(context.sourceIds, STOP_SOURCES);
  if (stopSources.length === 0) return;
  const requestedStopIds = intersectIds(context.visibleStopIds, context.options.stopIds);
  const stopIds = context.scope
    ? intersectIds(context.scope.candidates.stopIds, requestedStopIds)
    : requestedStopIds;
  for (const stopBatch of chunks(stopIds, context.batchSizes.stops)) {
    addProjectionUnit(context, {
      kind: 'stop',
      primaryIds: stopBatch,
      sourceIds: stopSources,
      unitScope: { stopIds: stopBatch },
      viewportCandidates: { stopIds: stopBatch },
    });
  }
}

function planPhysicalStationUnits(context: ProjectionPlanningContext): void {
  const stationSources = sourceSubset(context.sourceIds, PHYSICAL_STATION_SOURCES);
  if (stationSources.length === 0) return;
  const requestedStationIds = intersectIds(context.visibleStationIds, context.options.stationIds);
  const stationIds = context.scope
    ? intersectIds(context.scope.candidates.stationIds, requestedStationIds)
    : requestedStationIds;
  for (const stationBatch of chunks(stationIds, context.batchSizes.stations)) {
    addProjectionUnit(context, {
      kind: 'station',
      primaryIds: stationBatch,
      sourceIds: stationSources,
      unitScope: { stationIds: stationBatch, groupIds: [] },
      viewportCandidates: { stationIds: stationBatch, groupIds: [] },
    });
  }
  if (!context.sourceIds.includes(SRC_FOOTPRINTS) || context.scope) return;
  for (const groupId of context.visibleGroupIds) {
    addProjectionUnit(context, {
      kind: 'group',
      primaryIds: [groupId],
      sourceIds: [SRC_FOOTPRINTS],
      unitScope: { stationIds: [], groupIds: [groupId] },
      viewportCandidates: { stationIds: [], groupIds: [groupId] },
    });
  }
}

function stationPhysicalHandleIds(
  context: ProjectionPlanningContext,
  stationId: string,
): readonly string[] {
  const station = (
    context.options.preparedSnapshot?.stationsById ??
    renderStationsById(context.options.system.stations)
  ).get(stationId);
  if (!station) return [];
  return [
    ...(station.footprint ?? []).map((_, index) => stationFootprintPointRenderId(stationId, index)),
    ...(station.platforms ?? []).flatMap((platform) =>
      platform.points.map((_, index) =>
        stationPlatformPointRenderId(stationId, platform.id, index),
      ),
    ),
  ];
}

function groupPhysicalHandleIds(
  context: ProjectionPlanningContext,
  groupId: string,
): readonly string[] {
  const group = (
    context.options.preparedSnapshot?.groupsById ?? renderGroupsById(context.options.system.groups)
  ).get(groupId);
  return (group?.footprint ?? []).map((_, index) => groupFootprintPointRenderId(groupId, index));
}

function planPhysicalHandleUnits(context: ProjectionPlanningContext): void {
  if (!context.sourceIds.includes(SRC_PHYSICAL_HANDLES)) return;
  const visibleHandleIds = new Set(context.visiblePhysicalHandleIds);
  const stationId = context.options.physicalHandleStationId;
  const scopedStationIds = context.scope?.candidates.stationIds;
  if (
    stationId &&
    context.visibleStationIds.includes(stationId) &&
    (!scopedStationIds || scopedStationIds.includes(stationId))
  ) {
    const handleIds = stationPhysicalHandleIds(context, stationId).filter((id) =>
      visibleHandleIds.has(id),
    );
    for (const handleId of handleIds) {
      addProjectionUnit(context, {
        kind: 'physical-station-handle',
        primaryIds: [handleId],
        sourceIds: [SRC_PHYSICAL_HANDLES],
        unitScope: {
          stationIds: [stationId],
          groupIds: [],
          physicalHandleIds: [handleId],
        },
        viewportCandidates: {
          stationIds: [stationId],
          groupIds: [],
          physicalHandleIds: [handleId],
        },
      });
    }
  }
  const groupId = context.options.physicalHandleGroupId;
  if (!groupId || context.scope || !context.visibleGroupIds.includes(groupId)) return;
  const groupHandleIds = groupPhysicalHandleIds(context, groupId).filter((id) =>
    visibleHandleIds.has(id),
  );
  for (const handleId of groupHandleIds) {
    addProjectionUnit(context, {
      kind: 'physical-group-handle',
      primaryIds: [handleId],
      sourceIds: [SRC_PHYSICAL_HANDLES],
      unitScope: { stationIds: [], groupIds: [groupId], physicalHandleIds: [handleId] },
      viewportCandidates: {
        stationIds: [],
        groupIds: [groupId],
        physicalHandleIds: [handleId],
      },
    });
  }
}

interface LabelBatchMembersOptions {
  context: ProjectionPlanningContext;
  namedWayId: string;
  labelWayIds: ReadonlySet<string>;
  dependencyIds: ReadonlySet<string> | null;
}

function labelBatchMembers({
  context,
  namedWayId,
  labelWayIds,
  dependencyIds,
}: LabelBatchMembersOptions): { wayIds: string[]; dependencyIds: string[] } {
  const wayIds: string[] = [];
  const acceptedDependencyIds: string[] = [];
  const namedWaysById =
    context.options.preparedSnapshot?.namedWaysById ??
    renderNamedWaysById(context.options.system.namedWays);
  for (const wayId of namedWaysById.get(namedWayId)?.wayIds ?? []) {
    const dependencyId = namedWayLabelDependencyId(namedWayId, wayId);
    if (!labelWayIds.has(wayId) || (dependencyIds && !dependencyIds.has(dependencyId))) continue;
    wayIds.push(wayId);
    acceptedDependencyIds.push(dependencyId);
  }
  return { wayIds, dependencyIds: acceptedDependencyIds };
}

function planLabelUnits(context: ProjectionPlanningContext): void {
  if (!context.sourceIds.includes(SRC_WAY_LABELS)) return;
  const namedWayIds = context.scope
    ? intersectIds(context.scope.candidates.namedWayIds, context.visibleLabelIds)
    : context.visibleLabelIds;
  const labelWayIds = new Set(
    context.scope
      ? intersectIds(context.visibleWayIds, context.scope.candidates.labelWayIds)
      : context.visibleWayIds,
  );
  const dependencyIds = context.scope ? new Set(context.scope.candidates.labelDependencyIds) : null;
  for (const namedWayId of namedWayIds) {
    const members = labelBatchMembers({ context, namedWayId, labelWayIds, dependencyIds });
    for (let index = 0; index < members.wayIds.length; index += context.batchSizes.labels) {
      addProjectionUnit(context, {
        kind: 'label',
        primaryIds: [namedWayId],
        sourceIds: [SRC_WAY_LABELS],
        unitScope: {
          namedWayIds: [namedWayId],
          labelWayIds: members.wayIds.slice(index, index + context.batchSizes.labels),
          labelDependencyIds: members.dependencyIds.slice(index, index + context.batchSizes.labels),
        },
        viewportCandidates: {
          wayIds: members.wayIds.slice(index, index + context.batchSizes.labels),
          wayIdSet: new Set(members.wayIds.slice(index, index + context.batchSizes.labels)),
          labelIds: [namedWayId],
        },
      });
    }
  }
}

function planServiceTerminusUnits(context: ProjectionPlanningContext): void {
  if (!context.sourceIds.includes(SRC_SERVICE_TERMINI)) return;
  if (context.options.selection?.kind !== 'service') return;
  const selectedServiceId = context.options.selection.id;
  const serviceIds = context.scope?.candidates.affectedServiceIds;
  if (serviceIds && !serviceIds.includes(selectedServiceId)) return;
  const selectedService = (
    context.options.preparedSnapshot?.servicesById ??
    renderServicesById(context.options.system.services)
  ).get(selectedServiceId);
  if (!selectedService) return;
  const visibleTerminusIds = new Set(context.visibleServiceTerminusIds);
  const selectedTerminusIds = serviceTerminusDescriptors(selectedService)
    .map(({ id }) => id)
    .filter((id) => visibleTerminusIds.has(id));
  if (selectedTerminusIds.length === 0) return;
  const selectedIds = [selectedServiceId];
  for (const serviceBatch of chunks(selectedIds, context.batchSizes.services)) {
    addProjectionUnit(context, {
      kind: 'service',
      primaryIds: serviceBatch,
      sourceIds: [SRC_SERVICE_TERMINI],
      unitScope: { serviceIds: serviceBatch, serviceTerminusIds: selectedTerminusIds },
      viewportCandidates: { serviceTerminusIds: selectedTerminusIds },
    });
  }
}

function planSingletonUnits(context: ProjectionPlanningContext): void {
  if (context.sourceIds.includes(SRC_HANDLES)) {
    const visibleHandleIds = new Set(context.visibleWayHandleIds);
    const waysById =
      context.options.preparedSnapshot?.waysById ?? wayById(context.options.system.ways);
    for (const wayId of context.options.handleWayIds) {
      const way = waysById.get(wayId);
      for (let pointIndex = 0; pointIndex < (way?.points.length ?? 0); pointIndex++) {
        const handleId = wayControlPointRenderId(wayId, pointIndex);
        if (!visibleHandleIds.has(handleId)) continue;
        addProjectionUnit(context, {
          kind: 'handle',
          primaryIds: [handleId],
          sourceIds: [SRC_HANDLES],
          unitScope: { wayHandleIds: [handleId] },
          viewportCandidates: { wayHandleIds: [handleId] },
          handleWayIds: [wayId],
        });
      }
    }
  }
  if (!context.sourceIds.includes(SRC_FACILITIES)) return;
  for (const facilityId of context.visibleFacilityIds) {
    addProjectionUnit(context, {
      kind: 'facility',
      primaryIds: [facilityId],
      sourceIds: [SRC_FACILITIES],
      unitScope: { facilityIds: [facilityId] },
      viewportCandidates: { facilityIds: [facilityId] },
    });
  }
}

export function appendProjectionUnits(context: ProjectionPlanningContext): void {
  planCorridorUnits(context);
  planJunctionUnits(context);
  planStopUnits(context);
  planPhysicalStationUnits(context);
  planPhysicalHandleUnits(context);
  planLabelUnits(context);
  planServiceTerminusUnits(context);
  planSingletonUnits(context);
}
