export const TRANSIT_ENTITY_KINDS = [
  'publisher',
  'agency',
  'operator',
  'alignment',
  'way',
  'line',
  'service-plan',
  'pattern',
  'schedule',
  'calendar',
  'trip',
  'frequency-rule',
  'operational-change',
  'advisory',
  'stop',
  'station',
  'facility',
  'group',
  'node',
  'named-way',
  'median',
  'lane-connector',
  'turn-restriction',
  'approach-control',
] as const;

type TransitEntityKind = (typeof TRANSIT_ENTITY_KINDS)[number];

/** A portable core reference to a transit record. Compatibility aliases are not entities. */
export type TransitEntityRef = {
  [Kind in TransitEntityKind]: { kind: Kind; id: string };
}[TransitEntityKind];

const TRANSIT_ENTITY_KIND_SET: ReadonlySet<string> = new Set(TRANSIT_ENTITY_KINDS);

export function parseTransitEntityRef(value: unknown): TransitEntityRef {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Transit entity reference must be an object.');
  }
  const record = value as Record<string, unknown>;
  if (typeof record.kind !== 'string' || !TRANSIT_ENTITY_KIND_SET.has(record.kind)) {
    throw new Error('Transit entity reference kind is invalid.');
  }
  if (typeof record.id !== 'string' || record.id.trim().length === 0) {
    throw new Error('Transit entity ID must not be empty.');
  }
  return { kind: record.kind, id: record.id } as TransitEntityRef;
}
