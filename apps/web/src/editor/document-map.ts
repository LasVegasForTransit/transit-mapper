import type { MapDriver, SelectionController } from '@transitmapper/map';
import {
  createDocumentMapDriver,
  type DocumentMapDriverOptions,
} from '@transitmapper/renderer/driver';
import type { SourceFeatureProjectionAccounting } from '@transitmapper/renderer/projection';
import type { RendererStatsCollector } from '@transitmapper/renderer/stats';
import {
  DOCUMENT_MAP_DEFINITION,
  resolveDocumentMapPresentation,
} from '@transitmapper/renderer/presentation';
import { createDocumentMapSource, type EditorDocumentMapSource } from './document-map-source';
import { createEditorSelectionController } from './editor-selection';
import type { EditorStore } from './store';

export {
  DOCUMENT_MAP_DEFINITION,
  resolveDocumentMapPresentation,
} from '@transitmapper/renderer/presentation';

export interface CreateEditorDocumentMapOptions {
  readonly store: EditorStore;
  readonly layerSpecs: DocumentMapDriverOptions['layerSpecs'];
  readonly layerSpecsForPresentation?: DocumentMapDriverOptions['layerSpecsForPresentation'];
  readonly surfaceLayerSpecsForPresentation?: DocumentMapDriverOptions['surfaceLayerSpecsForPresentation'];
  readonly setupStaticSources?: DocumentMapDriverOptions['setupStaticSources'];
  readonly createFeatureProjectionWorker?: DocumentMapDriverOptions['createFeatureProjectionWorker'];
  readonly createDiagramLayoutWorker?: DocumentMapDriverOptions['createDiagramLayoutWorker'];
  readonly projectionAccounting?: SourceFeatureProjectionAccounting;
  readonly rendererStats?: RendererStatsCollector;
  readonly instrumentationEnabled?: boolean;
  readonly scheduler?: DocumentMapDriverOptions['scheduler'];
  readonly attachSession?: DocumentMapDriverOptions['attachSession'];
}

export interface EditorDocumentMap {
  readonly driver: MapDriver;
  readonly source: EditorDocumentMapSource;
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
    layerSpecsForPresentation: options.layerSpecsForPresentation,
    surfaceLayerSpecsForPresentation: options.surfaceLayerSpecsForPresentation,
    resolvePresentation: resolveDocumentMapPresentation,
    setupStaticSources: options.setupStaticSources,
    createFeatureProjectionWorker: options.createFeatureProjectionWorker,
    createDiagramLayoutWorker: options.createDiagramLayoutWorker,
    projectionAccounting: options.projectionAccounting,
    rendererStats: options.rendererStats,
    instrumentationEnabled: options.instrumentationEnabled,
    scheduler: options.scheduler,
    attachSession: options.attachSession,
  });
  return { driver, source, selection };
}
