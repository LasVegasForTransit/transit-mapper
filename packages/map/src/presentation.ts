import { MODE_ORDER, MODES, WAY_TYPE_ORDER, WAY_TYPES } from '@transitmapper/core/model/catalog';
import { DEFAULT_VIEWPORT } from '@transitmapper/core/model/system';
import type { MapDefinition } from './map-driver';
import type {
  MapCameraStateV1,
  MapPresentationStateV1,
} from '@transitmapper/core/presentation/map-presentation-state';
import type { DocumentMapPresentation } from './document-map-driver-types';

export * from '@transitmapper/renderer/presentation';

export type DocumentRepresentationId = 'network' | 'infrastructure' | 'diagram';

export const DOCUMENT_VIEW_FILTER_IDS = {
  modes: 'modes',
  wayTypes: 'way-types',
  landmarks: 'landmarks',
} as const;

const DOCUMENT_REPRESENTATIONS = Object.freeze([
  Object.freeze({ id: 'network', label: 'Network' }),
  Object.freeze({ id: 'infrastructure', label: 'Infrastructure' }),
  Object.freeze({ id: 'diagram', label: 'Diagram' }),
]);

const MODE_FILTER_OPTIONS = Object.freeze(
  MODE_ORDER.map((id) => Object.freeze({ id, label: MODES[id].label })),
);
const WAY_TYPE_FILTER_OPTIONS = Object.freeze(
  WAY_TYPE_ORDER.map((id) => Object.freeze({ id, label: WAY_TYPES[id].label })),
);

export const DOCUMENT_MAP_DEFINITION: MapDefinition = Object.freeze({
  id: 'document',
  title: 'Transit system',
  representations: DOCUMENT_REPRESENTATIONS,
  filters: Object.freeze([
    Object.freeze({
      kind: 'multi-select' as const,
      id: DOCUMENT_VIEW_FILTER_IDS.modes,
      label: 'Services',
      options: MODE_FILTER_OPTIONS,
      defaultValue: Object.freeze([...MODE_ORDER]),
    }),
    Object.freeze({
      kind: 'multi-select' as const,
      id: DOCUMENT_VIEW_FILTER_IDS.wayTypes,
      label: 'Infrastructure',
      options: WAY_TYPE_FILTER_OPTIONS,
      defaultValue: Object.freeze([...WAY_TYPE_ORDER]),
    }),
    Object.freeze({
      kind: 'toggle' as const,
      id: DOCUMENT_VIEW_FILTER_IDS.landmarks,
      label: 'Landmarks',
      defaultValue: true,
    }),
  ]),
  attribution: Object.freeze([]),
});

export interface CreateDocumentPresentationStateOptions {
  camera?: MapCameraStateV1;
  representationId?: DocumentRepresentationId;
}

export function createDocumentPresentationState(
  options: CreateDocumentPresentationStateOptions = {},
): MapPresentationStateV1 {
  const camera = options.camera ?? DEFAULT_VIEWPORT;
  return {
    schemaVersion: 1,
    camera: { center: [camera.center[0], camera.center[1]], zoom: camera.zoom },
    representationId: options.representationId ?? 'network',
    filters: {
      [DOCUMENT_VIEW_FILTER_IDS.modes]: [...MODE_ORDER],
      [DOCUMENT_VIEW_FILTER_IDS.wayTypes]: [...WAY_TYPE_ORDER],
      [DOCUMENT_VIEW_FILTER_IDS.landmarks]: true,
    },
  };
}

function documentRepresentation(value: string): DocumentRepresentationId {
  switch (value) {
    case 'network':
    case 'infrastructure':
    case 'diagram':
      return value;
    default:
      return 'network';
  }
}

function boundedValues(
  value: unknown,
  allowedValues: readonly string[],
  fallback: readonly string[],
): Set<string> {
  const allowed = new Set(allowedValues);
  if (!Array.isArray(value)) return new Set(fallback);
  const selected: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !allowed.has(item)) return new Set(fallback);
    selected.push(item);
  }
  return new Set(selected);
}

export function resolveDocumentMapPresentation(
  state: MapPresentationStateV1,
): DocumentMapPresentation {
  return {
    viewMode: documentRepresentation(state.representationId),
    visibleModes: boundedValues(
      state.filters[DOCUMENT_VIEW_FILTER_IDS.modes],
      MODE_ORDER,
      MODE_ORDER,
    ),
    visibleWayTypes: boundedValues(
      state.filters[DOCUMENT_VIEW_FILTER_IDS.wayTypes],
      WAY_TYPE_ORDER,
      WAY_TYPE_ORDER,
    ),
  };
}
