import type {
  Alignment,
  LaneConnector,
  NamedWay,
  Node,
  PatternLeg,
  Station,
  Stop,
  TransitSystem,
  VehicleKind,
  Way,
} from '../../transit/authored-system';

interface IdentifiedRecord {
  readonly id: string;
}

function indexById<Record extends IdentifiedRecord>(
  label: string,
  records: readonly Record[],
): ReadonlyMap<string, Record> {
  const indexed = new Map<string, Record>();
  for (const record of records) {
    if (indexed.has(record.id)) throw new Error(`Duplicate ${label} ID: ${record.id}.`);
    indexed.set(record.id, record);
  }
  return indexed;
}

interface InfrastructureContext {
  readonly alignments: ReadonlyMap<string, Alignment>;
  readonly ways: ReadonlyMap<string, Way>;
  readonly stations: ReadonlyMap<string, IdentifiedRecord>;
  readonly vehicleKinds: ReadonlyMap<string, VehicleKind>;
  readonly namedWays: ReadonlyMap<string, NamedWay>;
  readonly wayIdByAlignmentId: ReadonlyMap<string, string>;
}

function infrastructureContext(system: TransitSystem): InfrastructureContext {
  const alignments = indexById('Alignment', system.alignments);
  const ways = indexById('Way', system.ways);
  const wayIdByAlignmentId = new Map<string, string>();
  for (const way of ways.values()) {
    if (!alignments.has(way.alignmentId)) {
      throw new Error(`Way ${way.id} references missing Alignment ${way.alignmentId}.`);
    }
    const owner = wayIdByAlignmentId.get(way.alignmentId);
    if (owner !== undefined) {
      throw new Error(`Alignment ${way.alignmentId} is owned by two Ways: ${owner} and ${way.id}.`);
    }
    wayIdByAlignmentId.set(way.alignmentId, way.id);
  }
  return {
    alignments,
    ways,
    stations: indexById('Station', system.stations),
    vehicleKinds: indexById('VehicleKind', system.vehicleKinds),
    namedWays: indexById('NamedWay', system.namedWays),
    wayIdByAlignmentId,
  };
}

function requireLane(way: Way, laneId: string, label: string): void {
  if (!way.profile.lanes.some((lane) => lane.id === laneId)) {
    throw new Error(`${label} references missing lane ${laneId} on Way ${way.id}.`);
  }
}

function validatePatternLeg(label: string, leg: PatternLeg, context: InfrastructureContext): void {
  if (leg.kind === 'alignment') {
    if (!context.alignments.has(leg.alignmentId)) {
      throw new Error(`${label} references missing Alignment ${leg.alignmentId}.`);
    }
    if (context.wayIdByAlignmentId.has(leg.alignmentId)) {
      throw new Error(`${label} uses a bare Alignment that is owned by a Way.`);
    }
    return;
  }
  const way = context.ways.get(leg.wayId);
  if (!way) throw new Error(`${label} references missing Way ${leg.wayId}.`);
  if (leg.lane.kind === 'pinned') requireLane(way, leg.lane.laneId, label);
}

function validatePatternCarriers(system: TransitSystem, context: InfrastructureContext): void {
  for (const pattern of system.patterns) {
    if (pattern.path.kind === 'unknown') continue;
    if (pattern.path.legs.length === 0) throw new Error(`Pattern ${pattern.id} has an empty path.`);
    for (const [index, leg] of pattern.path.legs.entries()) {
      validatePatternLeg(`Pattern ${pattern.id} leg ${index}`, leg, context);
    }
  }
}

function validateStop(stop: Stop, context: InfrastructureContext): void {
  if (stop.stationId !== undefined && !context.stations.has(stop.stationId)) {
    throw new Error(`Stop ${stop.id} references missing Station ${stop.stationId}.`);
  }
  for (const anchor of stop.anchors) {
    if (!context.alignments.has(anchor.alignmentId)) {
      throw new Error(`Stop ${stop.id} references missing Alignment ${anchor.alignmentId}.`);
    }
    if (!Number.isFinite(anchor.t) || anchor.t < 0 || anchor.t > 1) {
      throw new Error(`Stop ${stop.id} has an invalid Alignment position.`);
    }
  }
}

function validateStationPlatforms(station: Station): void {
  const platformIds = new Set<string>();
  for (const platform of station.platforms ?? []) {
    if (platformIds.has(platform.id)) {
      throw new Error(`Station ${station.id} repeats Platform ${platform.id}.`);
    }
    platformIds.add(platform.id);
  }
}

function validateStopsAndStations(system: TransitSystem, context: InfrastructureContext): void {
  indexById('Stop', system.stops);
  for (const stop of system.stops) validateStop(stop, context);
  for (const station of system.stations) validateStationPlatforms(station);
}

function validateNodeReference(
  node: Node,
  ref: Node['refs'][number],
  context: InfrastructureContext,
): string {
  const way = context.ways.get(ref.wayId);
  if (!way) throw new Error(`Node ${node.id} references missing Way ${ref.wayId}.`);
  const alignment = context.alignments.get(way.alignmentId);
  if (
    !alignment ||
    !Number.isSafeInteger(ref.pointIndex) ||
    ref.pointIndex < 0 ||
    ref.pointIndex >= alignment.points.length
  ) {
    throw new Error(`Node ${node.id} references an invalid point on Way ${ref.wayId}.`);
  }
  return `${ref.wayId}\u0000${ref.pointIndex}`;
}

function validateConnectorEndpoint(
  nodeId: string,
  endpoint: LaneConnector['from'],
  context: InfrastructureContext,
): void {
  const way = context.ways.get(endpoint.wayId);
  if (!way) throw new Error(`Node ${nodeId} references missing Way ${endpoint.wayId}.`);
  requireLane(way, endpoint.laneId, `Node ${nodeId} connector`);
}

function validateNode(node: Node, context: InfrastructureContext): void {
  const refs = new Set<string>();
  for (const ref of node.refs) {
    const key = validateNodeReference(node, ref, context);
    if (refs.has(key)) throw new Error(`Node ${node.id} repeats a Way point reference.`);
    refs.add(key);
  }
  for (const connector of node.connectors ?? []) {
    validateConnectorEndpoint(node.id, connector.from, context);
    validateConnectorEndpoint(node.id, connector.to, context);
  }
}

function validateNodes(system: TransitSystem, context: InfrastructureContext): void {
  indexById('Node', system.nodes);
  for (const node of system.nodes) validateNode(node, context);
}

function validateNamedWays(system: TransitSystem, context: InfrastructureContext): void {
  for (const namedWay of context.namedWays.values()) {
    const members = new Set<string>();
    for (const wayId of namedWay.wayIds) {
      if (members.has(wayId)) throw new Error(`NamedWay ${namedWay.id} repeats Way ${wayId}.`);
      if (!context.ways.has(wayId)) {
        throw new Error(`NamedWay ${namedWay.id} references missing Way ${wayId}.`);
      }
      members.add(wayId);
    }
  }
  for (const namedWayId of Object.keys(system.medians)) {
    if (!context.namedWays.has(namedWayId)) {
      throw new Error(`Median references missing NamedWay ${namedWayId}.`);
    }
  }
}

function validateVehicleKinds(system: TransitSystem, context: InfrastructureContext): void {
  for (const plan of system.servicePlans) {
    if (plan.vehicleKindId === undefined) continue;
    const vehicleKind = context.vehicleKinds.get(plan.vehicleKindId);
    if (!vehicleKind) {
      throw new Error(
        `ServicePlan ${plan.id} references missing VehicleKind ${plan.vehicleKindId}.`,
      );
    }
    if (vehicleKind.modeId !== plan.modeId) {
      throw new Error(`ServicePlan ${plan.id} uses a VehicleKind from another mode.`);
    }
  }
}

/** Validates physical ownership and authored references without interpreting
 * opaque Group membership or provider evidence. */
export function validateAuthoredInfrastructureRelationships(system: TransitSystem): void {
  const context = infrastructureContext(system);
  validatePatternCarriers(system, context);
  validateStopsAndStations(system, context);
  validateNodes(system, context);
  validateNamedWays(system, context);
  validateVehicleKinds(system, context);
}
