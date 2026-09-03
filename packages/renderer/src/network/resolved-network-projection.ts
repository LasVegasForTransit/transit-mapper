import {
  transitEntityKey,
  type TransitEntityKey,
} from '@transitmapper/core/model/transit-entity-ref';
import { canonicalValueBytes } from '@transitmapper/core/encoding/canonical-value';
import type { NetworkQueryResult } from '@transitmapper/core/network/result';
import type {
  LineServicePlanLink,
  ResolvedAdvisory,
  ResolvedAlignment,
  ResolvedCarrierFragment,
  ResolvedLine,
  ResolvedNetworkChunk,
  ResolvedPattern,
  ResolvedPatternLegFragment,
  ResolvedPatternStopCall,
  ResolvedServicePlan,
  ResolvedStation,
  ResolvedStop,
  ResolvedTopologyWindow,
  ResolvedWay,
  ServicePlanPatternLink,
} from '@transitmapper/core/network/resolved-network-chunk';
import type { RenderPresentation } from '@transitmapper/core/render/render-presentation';

export interface ResolvedLinePatternMembership {
  readonly lineId: string;
  readonly servicePlanId: string;
  readonly patternId: string;
}

export interface ResolvedNetworkProjectionIndex {
  readonly linesById: ReadonlyMap<string, ResolvedLine>;
  readonly servicePlansById: ReadonlyMap<string, ResolvedServicePlan>;
  readonly patternsById: ReadonlyMap<string, ResolvedPattern>;
  readonly stopsById: ReadonlyMap<string, ResolvedStop>;
  readonly stationsById: ReadonlyMap<string, ResolvedStation>;
  readonly alignmentsById: ReadonlyMap<string, ResolvedAlignment>;
  readonly waysById: ReadonlyMap<string, ResolvedWay>;
  readonly linePatternsByLineId: ReadonlyMap<string, readonly ResolvedLinePatternMembership[]>;
  readonly linePatternsByPatternId: ReadonlyMap<string, readonly ResolvedLinePatternMembership[]>;
  readonly stopCallsById: ReadonlyMap<string, ResolvedPatternStopCall>;
  readonly stopCallsByPatternId: ReadonlyMap<string, readonly ResolvedPatternStopCall[]>;
  readonly topologyWindowsById: ReadonlyMap<string, ResolvedTopologyWindow>;
  readonly topologyWindowsByPatternId: ReadonlyMap<string, readonly ResolvedTopologyWindow[]>;
  readonly carrierFragmentsById: ReadonlyMap<string, ResolvedCarrierFragment>;
  readonly patternLegFragmentsById: ReadonlyMap<string, ResolvedPatternLegFragment>;
  readonly visiblePatternLegFragmentsByPatternId: ReadonlyMap<
    string,
    readonly ResolvedPatternLegFragment[]
  >;
  readonly advisoriesById: ReadonlyMap<string, ResolvedAdvisory>;
  readonly advisoriesByAffectedEntity: ReadonlyMap<TransitEntityKey, readonly ResolvedAdvisory[]>;
}

export interface ResolvedNetworkProjection {
  readonly result: NetworkQueryResult;
  readonly presentation: RenderPresentation;
  readonly index: ResolvedNetworkProjectionIndex;
}

interface IdentifiedRecord {
  readonly id: string;
}

interface CanonicalConflict {
  readonly label: string;
  readonly recordId: string;
}

const textEncoder = new TextEncoder();

function compareBytes(left: Uint8Array, right: Uint8Array): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

function compareText(left: string, right: string): number {
  return compareBytes(textEncoder.encode(left), textEncoder.encode(right));
}

function compareConflicts(left: CanonicalConflict, right: CanonicalConflict): number {
  return compareText(left.label, right.label) || compareText(left.recordId, right.recordId);
}

function canonicalBytes(records: ProjectionRecords, record: IdentifiedRecord): Uint8Array {
  const existing = records.canonicalBytesByRecord.get(record);
  if (existing !== undefined) return existing;
  const encoded = canonicalValueBytes(record);
  records.canonicalBytesByRecord.set(record, encoded);
  return encoded;
}

function putCanonical<RecordType extends IdentifiedRecord>(
  records: ProjectionRecords,
  recordsById: Map<string, RecordType>,
  record: RecordType,
  label: string,
): void {
  const existing = recordsById.get(record.id);
  if (existing === undefined) {
    recordsById.set(record.id, record);
    return;
  }
  const incomingBytes = canonicalBytes(records, record);
  if (compareBytes(canonicalBytes(records, existing), incomingBytes) !== 0) {
    const conflict = { label, recordId: record.id };
    if (records.conflict === undefined || compareConflicts(conflict, records.conflict) < 0) {
      records.conflict = conflict;
    }
  }
}

function rejectCanonicalConflicts(records: ProjectionRecords): void {
  const conflict = records.conflict;
  if (conflict === undefined) return;
  throw new Error(`Conflicting ${conflict.label} ID "${conflict.recordId}".`);
}

function append<Value>(valuesByKey: Map<string, Value[]>, key: string, value: Value): void {
  const values = valuesByKey.get(key);
  if (values === undefined) valuesByKey.set(key, [value]);
  else values.push(value);
}

interface ProjectionRecords {
  readonly canonicalBytesByRecord: WeakMap<object, Uint8Array>;
  conflict: CanonicalConflict | undefined;
  readonly linesById: Map<string, ResolvedLine>;
  readonly servicePlansById: Map<string, ResolvedServicePlan>;
  readonly patternsById: Map<string, ResolvedPattern>;
  readonly stopsById: Map<string, ResolvedStop>;
  readonly stationsById: Map<string, ResolvedStation>;
  readonly alignmentsById: Map<string, ResolvedAlignment>;
  readonly waysById: Map<string, ResolvedWay>;
  readonly lineServicePlansById: Map<string, LineServicePlanLink>;
  readonly servicePlanPatternsById: Map<string, ServicePlanPatternLink>;
  readonly stopCallsById: Map<string, ResolvedPatternStopCall>;
  readonly topologyWindowsById: Map<string, ResolvedTopologyWindow>;
  readonly carrierFragmentsById: Map<string, ResolvedCarrierFragment>;
  readonly patternLegFragmentsById: Map<string, ResolvedPatternLegFragment>;
  readonly visiblePatternLegFragmentIds: Set<string>;
  readonly advisoriesById: Map<string, ResolvedAdvisory>;
}

function emptyProjectionRecords(): ProjectionRecords {
  return {
    canonicalBytesByRecord: new WeakMap(),
    conflict: undefined,
    linesById: new Map(),
    servicePlansById: new Map(),
    patternsById: new Map(),
    stopsById: new Map(),
    stationsById: new Map(),
    alignmentsById: new Map(),
    waysById: new Map(),
    lineServicePlansById: new Map(),
    servicePlanPatternsById: new Map(),
    stopCallsById: new Map(),
    topologyWindowsById: new Map(),
    carrierFragmentsById: new Map(),
    patternLegFragmentsById: new Map(),
    visiblePatternLegFragmentIds: new Set(),
    advisoriesById: new Map(),
  };
}

function indexChunkEntities(records: ProjectionRecords, chunk: ResolvedNetworkChunk): void {
  for (const record of chunk.entities.lines) {
    putCanonical(records, records.linesById, record, 'Line');
  }
  for (const record of chunk.entities.servicePlans) {
    putCanonical(records, records.servicePlansById, record, 'ServicePlan');
  }
  for (const record of chunk.entities.patterns) {
    putCanonical(records, records.patternsById, record, 'Pattern');
  }
  for (const record of chunk.entities.stops) {
    putCanonical(records, records.stopsById, record, 'Stop');
  }
  for (const record of chunk.entities.stations) {
    putCanonical(records, records.stationsById, record, 'Station');
  }
  for (const record of chunk.entities.alignments) {
    putCanonical(records, records.alignmentsById, record, 'Alignment');
  }
  for (const record of chunk.entities.ways) {
    putCanonical(records, records.waysById, record, 'Way');
  }
}

function indexChunkRelationships(records: ProjectionRecords, chunk: ResolvedNetworkChunk): void {
  for (const record of chunk.relationships.lineServicePlans) {
    putCanonical(records, records.lineServicePlansById, record, 'Line ServicePlan link');
  }
  for (const record of chunk.relationships.servicePlanPatterns) {
    putCanonical(records, records.servicePlanPatternsById, record, 'ServicePlan Pattern link');
  }
  for (const record of chunk.relationships.patternStopCalls) {
    putCanonical(records, records.stopCallsById, record, 'Pattern stop call');
  }
  for (const record of chunk.relationships.topologyWindows) {
    putCanonical(records, records.topologyWindowsById, record, 'topology window');
  }
}

function indexChunkGeometry(records: ProjectionRecords, chunk: ResolvedNetworkChunk): void {
  for (const record of chunk.geometry.carriers) {
    putCanonical(records, records.carrierFragmentsById, record, 'carrier fragment');
  }
  for (const record of chunk.geometry.patternLegs) {
    putCanonical(records, records.patternLegFragmentsById, record, 'Pattern leg fragment');
  }
  for (const id of chunk.geometry.visiblePatternLegFragmentIds) {
    records.visiblePatternLegFragmentIds.add(id);
  }
}

function indexChunk(records: ProjectionRecords, chunk: ResolvedNetworkChunk): void {
  indexChunkEntities(records, chunk);
  indexChunkRelationships(records, chunk);
  indexChunkGeometry(records, chunk);
  for (const record of chunk.advisories) {
    putCanonical(records, records.advisoriesById, record, 'Advisory');
  }
}

function linePatternMemberships(records: ProjectionRecords): {
  readonly byLineId: ReadonlyMap<string, readonly ResolvedLinePatternMembership[]>;
  readonly byPatternId: ReadonlyMap<string, readonly ResolvedLinePatternMembership[]>;
} {
  const servicePlanPatterns = new Map<string, ServicePlanPatternLink[]>();
  for (const link of records.servicePlanPatternsById.values()) {
    append(servicePlanPatterns, link.servicePlanId, link);
  }
  const byLineId = new Map<string, ResolvedLinePatternMembership[]>();
  const byPatternId = new Map<string, ResolvedLinePatternMembership[]>();
  for (const lineServicePlan of records.lineServicePlansById.values()) {
    for (const servicePlanPattern of servicePlanPatterns.get(lineServicePlan.servicePlanId) ?? []) {
      const membership = {
        lineId: lineServicePlan.lineId,
        servicePlanId: lineServicePlan.servicePlanId,
        patternId: servicePlanPattern.patternId,
      };
      append(byLineId, membership.lineId, membership);
      append(byPatternId, membership.patternId, membership);
    }
  }
  return { byLineId, byPatternId };
}

function groupByPattern<RecordType extends { readonly patternId: string }>(
  records: Iterable<RecordType>,
): ReadonlyMap<string, readonly RecordType[]> {
  const recordsByPatternId = new Map<string, RecordType[]>();
  for (const record of records) append(recordsByPatternId, record.patternId, record);
  return recordsByPatternId;
}

function visiblePatternLegs(
  records: ProjectionRecords,
): ReadonlyMap<string, readonly ResolvedPatternLegFragment[]> {
  const visible = new Map<string, ResolvedPatternLegFragment[]>();
  for (const id of records.visiblePatternLegFragmentIds) {
    const fragment = records.patternLegFragmentsById.get(id);
    if (fragment === undefined) {
      throw new Error(`Visible Pattern leg fragment "${id}" is missing.`);
    }
    if (!records.carrierFragmentsById.has(fragment.carrierFragmentId)) {
      throw new Error(`Visible Pattern leg fragment "${id}" has no carrier fragment.`);
    }
    const pattern = records.patternsById.get(fragment.patternId);
    if (pattern?.path !== 'known') {
      throw new Error(`Visible Pattern leg fragment "${id}" has no known Pattern path.`);
    }
    append(visible, fragment.patternId, fragment);
  }
  return visible;
}

function advisoryIndex(
  advisories: Iterable<ResolvedAdvisory>,
): ReadonlyMap<TransitEntityKey, readonly ResolvedAdvisory[]> {
  const advisoriesByAffectedEntity = new Map<TransitEntityKey, ResolvedAdvisory[]>();
  for (const advisory of advisories) {
    for (const affected of advisory.affected) {
      const key = transitEntityKey(affected);
      const existing = advisoriesByAffectedEntity.get(key);
      if (existing === undefined) advisoriesByAffectedEntity.set(key, [advisory]);
      else existing.push(advisory);
    }
  }
  return advisoriesByAffectedEntity;
}

function projectionIndex(chunks: readonly ResolvedNetworkChunk[]): ResolvedNetworkProjectionIndex {
  const records = emptyProjectionRecords();
  for (const chunk of chunks) indexChunk(records, chunk);
  rejectCanonicalConflicts(records);
  const memberships = linePatternMemberships(records);
  return {
    linesById: records.linesById,
    servicePlansById: records.servicePlansById,
    patternsById: records.patternsById,
    stopsById: records.stopsById,
    stationsById: records.stationsById,
    alignmentsById: records.alignmentsById,
    waysById: records.waysById,
    linePatternsByLineId: memberships.byLineId,
    linePatternsByPatternId: memberships.byPatternId,
    stopCallsById: records.stopCallsById,
    stopCallsByPatternId: groupByPattern(records.stopCallsById.values()),
    topologyWindowsById: records.topologyWindowsById,
    topologyWindowsByPatternId: groupByPattern(records.topologyWindowsById.values()),
    carrierFragmentsById: records.carrierFragmentsById,
    patternLegFragmentsById: records.patternLegFragmentsById,
    visiblePatternLegFragmentsByPatternId: visiblePatternLegs(records),
    advisoriesById: records.advisoriesById,
    advisoriesByAffectedEntity: advisoryIndex(records.advisoriesById.values()),
  };
}

export function projectResolvedNetwork(
  result: NetworkQueryResult,
  presentation: RenderPresentation,
): ResolvedNetworkProjection {
  return {
    result,
    presentation,
    index: projectionIndex(result.chunks),
  };
}
