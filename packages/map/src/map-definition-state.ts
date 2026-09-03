import type {
  MapFilterValue,
  MapPresentationStateV1,
} from '@transitmapper/core/presentation/map-presentation-state';
import type { MapDefinition, MapFilterDefinition } from './map-driver';

function resolvedFilterValue(
  definition: MapFilterDefinition,
  incoming: MapFilterValue | undefined,
): MapFilterValue {
  if (definition.kind === 'toggle') {
    return typeof incoming === 'boolean' ? incoming : definition.defaultValue;
  }
  if (incoming === undefined || typeof incoming === 'boolean' || typeof incoming === 'string') {
    return [...definition.defaultValue];
  }
  const allowed = new Set(definition.options.map((option) => option.id));
  return incoming.filter((value) => allowed.has(value));
}

export function resolveMapPresentationState(
  definition: MapDefinition,
  incoming: MapPresentationStateV1,
): MapPresentationStateV1 {
  const defaultRepresentation = definition.representations.at(0)?.id;
  if (defaultRepresentation === undefined) {
    throw new Error(`Map definition "${definition.id}" has no representations.`);
  }
  const representationId = definition.representations.some(
    (candidate) => candidate.id === incoming.representationId,
  )
    ? incoming.representationId
    : defaultRepresentation;
  return {
    schemaVersion: 1,
    camera: incoming.camera,
    representationId,
    filters: Object.fromEntries(
      definition.filters.map((filter) => [
        filter.id,
        resolvedFilterValue(filter, incoming.filters[filter.id]),
      ]),
    ),
  };
}
