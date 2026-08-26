import type { MapFeatureReferenceV1 } from '@transitmapper/views';
import { LYR_FACILITIES, LYR_STATIONS } from '@transitmapper/renderer/layers';

type RenderedProperties = Readonly<Record<string, unknown>>;

function stringProperty(properties: RenderedProperties, key: string): string | undefined {
  const value = properties[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function reference(kind: string, id: string | undefined): MapFeatureReferenceV1 | undefined {
  return id === undefined ? undefined : { source: 'document', kind, id };
}

export function viewerFeatureReference(
  properties: RenderedProperties,
  logicalLayerId: string,
): MapFeatureReferenceV1 | undefined {
  const service = reference('service', stringProperty(properties, 'serviceId'));
  if (service) return service;
  const station = reference('station', stringProperty(properties, 'stationId'));
  if (station) return station;
  const group = reference('group', stringProperty(properties, 'groupId'));
  if (group) return group;
  const node = reference('node', stringProperty(properties, 'nodeId'));
  if (node) return node;
  const way = reference('way', stringProperty(properties, 'wayId'));
  if (way) return way;
  const id = stringProperty(properties, 'id');
  if (logicalLayerId === LYR_FACILITIES) return reference('facility', id);
  if (logicalLayerId === LYR_STATIONS) return reference('stop', id);
  return undefined;
}
