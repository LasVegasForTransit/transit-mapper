import { MODE_ORDER, MODES, WAY_TYPE_ORDER, WAY_TYPES } from '@transitmapper/core/model/catalog';
import type { MapDefinition, MapDriver, SelectionController } from '@transitmapper/map';
import {
  createDocumentMapDriver,
  type DocumentMapDriverOptions,
  type DocumentMapPresentation,
  type DocumentMapSnapshotSource,
} from '@transitmapper/renderer/driver';
import type { MapPresentationStateV1 } from '@transitmapper/views';
import { DOCUMENT_VIEW_FILTER_IDS, type DocumentRepresentationId } from './document-view-adapter';
import { createDocumentMapSource } from './document-map-source';
import { createEditorSelectionController } from './editor-selection';
import type { EditorStore } from './store';

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

export interface CreateEditorDocumentMapOptions {
  readonly store: EditorStore;
  readonly layerSpecs: DocumentMapDriverOptions['layerSpecs'];
  readonly setupStaticSources?: DocumentMapDriverOptions['setupStaticSources'];
  readonly createFeatureProjectionWorker?: DocumentMapDriverOptions['createFeatureProjectionWorker'];
  readonly createDiagramLayoutWorker?: DocumentMapDriverOptions['createDiagramLayoutWorker'];
  readonly scheduler?: DocumentMapDriverOptions['scheduler'];
  readonly attachSession?: DocumentMapDriverOptions['attachSession'];
}

export interface EditorDocumentMap {
  readonly driver: MapDriver;
  readonly source: DocumentMapSnapshotSource;
  readonly selection: SelectionController;
}

export function createEditorDocumentMap(
  options: CreateEditorDocumentMapOptions,
): EditorDocumentMap {
  const source = createDocumentMapSource(options.store);
  const selection = createEditorSelectionController(options.store);
  const driver = createDocumentMapDriver({
    definition: DOCUMENT_MAP_DEFINITION,
    source,
    layerSpecs: options.layerSpecs,
    resolvePresentation: resolveDocumentMapPresentation,
    setupStaticSources: options.setupStaticSources,
    createFeatureProjectionWorker: options.createFeatureProjectionWorker,
    createDiagramLayoutWorker: options.createDiagramLayoutWorker,
    scheduler: options.scheduler,
    attachSession: options.attachSession,
  });
  return { driver, source, selection };
}
