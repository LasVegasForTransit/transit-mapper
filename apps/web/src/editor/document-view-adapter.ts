import { MODE_ORDER, WAY_TYPE_ORDER } from '@transitmapper/core/model/catalog';
import {
  DEFAULT_VIEWPORT,
  type TransitSystem,
  type Viewport,
} from '@transitmapper/core/model/system';
import type { MapViewStore } from '@transitmapper/map';
import {
  DOCUMENT_VIEW_FILTER_IDS,
  type DocumentRepresentationId,
} from '@transitmapper/renderer/presentation';
import type { MapFeatureReferenceV1, MapPresentationStateV1 } from '@transitmapper/views';
import type { Selection } from './store';

interface CreateDocumentPresentationStateOptions {
  camera?: Viewport;
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

export function currentDocumentCamera(store: MapViewStore): Viewport {
  const camera = store.getSnapshot().camera;
  return { center: [camera.center[0], camera.center[1]], zoom: camera.zoom };
}

export function initializeDocumentCamera(store: MapViewStore, camera: Viewport): void {
  store.setCamera(camera);
}

export function withDocumentCamera(system: TransitSystem, store: MapViewStore): TransitSystem {
  return { ...system, viewport: currentDocumentCamera(store) };
}

export function editorSelectionReference(selection: Selection): MapFeatureReferenceV1 | undefined {
  if (!selection) return undefined;
  return { source: 'document', kind: selection.kind, id: selection.id };
}

function documentHasFeature(
  system: TransitSystem,
  kind: NonNullable<Selection>['kind'],
  id: string,
): boolean {
  const includesId = (records: readonly { id: string }[]) =>
    records.some((record) => record.id === id);
  switch (kind) {
    case 'way':
      return includesId(system.ways);
    case 'line':
      return includesId(system.lines);
    case 'service':
      return includesId(system.services);
    case 'stop':
      return includesId(system.stops);
    case 'station':
      return includesId(system.stations);
    case 'facility':
      return includesId(system.facilities);
    case 'group':
      return includesId(system.groups);
    case 'node':
      return includesId(system.nodes);
  }
}

export function restoreEditorSelection(
  reference: MapFeatureReferenceV1 | undefined,
  system: TransitSystem,
): Selection {
  if (reference?.source !== 'document') return null;
  switch (reference.kind) {
    case 'way':
    case 'line':
    case 'service':
    case 'stop':
    case 'station':
    case 'facility':
    case 'group':
    case 'node':
      return documentHasFeature(system, reference.kind, reference.id)
        ? { kind: reference.kind, id: reference.id }
        : null;
    default:
      return null;
  }
}
