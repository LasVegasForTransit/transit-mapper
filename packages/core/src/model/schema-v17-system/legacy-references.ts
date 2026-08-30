import type { TransitSystem as SchemaV16TransitSystem } from '../system';
import type { TransitEntityRef } from '../../transit/entity-ref';

type LegacyEntityReferenceKind = TransitEntityRef['kind'];

export type LegacyEntityReferenceMap = ReadonlyMap<string, readonly TransitEntityRef[]>;

interface LegacyEntityCollection {
  kind: LegacyEntityReferenceKind;
  records: ReadonlyArray<{ id: string }>;
}

/**
 * Schema v16 Groups used bare IDs. This table supplies the only valid target
 * meaning for each legacy record family before Group membership becomes typed.
 */
export function legacyEntityReferences(system: SchemaV16TransitSystem): LegacyEntityReferenceMap {
  const references = new Map<string, TransitEntityRef[]>();
  for (const collection of legacyEntityCollections(system)) {
    for (const record of collection.records) {
      const candidates = references.get(record.id) ?? [];
      candidates.push({ kind: collection.kind, id: record.id });
      references.set(record.id, candidates);
    }
  }
  return references;
}

function legacyEntityCollections(system: SchemaV16TransitSystem): LegacyEntityCollection[] {
  return [
    { kind: 'way', records: system.ways },
    { kind: 'line', records: system.lines },
    { kind: 'service-plan', records: system.services },
    { kind: 'stop', records: system.stops },
    { kind: 'station', records: system.stations },
    { kind: 'facility', records: system.facilities },
    { kind: 'group', records: system.groups },
    { kind: 'node', records: system.nodes },
    { kind: 'named-way', records: system.namedWays },
    { kind: 'vehicle-kind', records: system.vehicleKinds },
  ];
}
