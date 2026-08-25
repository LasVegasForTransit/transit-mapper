import {
  COMMITTED_SYSTEM_FEATURE_SOURCES,
  LYR_SERVICES_HIT,
  LYR_STATIONS,
  LYR_STATION_LABELS_MAJOR,
  LYR_WAYS_SOLID,
  SRC_HIT_FEATURES,
  SRC_STATIONS,
  SRC_WAYS,
  isBankedRenderLayer,
  sourceBankLayerSpecs,
} from '@transitmapper/renderer/layers';
import {
  documentLayerSpecsForViewMode,
  type DocumentMapSession,
} from '@transitmapper/renderer/driver';
import type { SourceFeatureProjectionAccounting } from '@transitmapper/renderer/projection';
import type { RendererStatsCollector } from '@transitmapper/renderer/stats';
import type { ViewOptions } from '@transitmapper/core/render/buildFeatures';
import type { LayerSpecification, Map as MLMap } from 'maplibre-gl';
import { attachPerfHarness, type PerfHarnessOptions } from '../perf';
import { markFirstSystemMapPaint } from '../perf/mapPaintMark';
import { attachSimDevHandle } from '../sim/devHandle';
import type { EditorMapAttachment } from '../editor/editor-map-attachment';
import type { EditorMapDriverPorts } from './editor-map-ports';
import type { ProjectionOperationCounts } from './gestureProjection';
import { recordFullProjection } from './gestureProjection';
import { layerSpecsForScheme } from './mapTheme';

const PERF_HARNESS_BUILD = import.meta.env.DEV || import.meta.env.VITE_PERF_BUILD === '1';

interface InstrumentationContext {
  readonly session: DocumentMapSession;
  readonly ports: EditorMapDriverPorts;
  readonly counts: ProjectionOperationCounts;
  readonly accounting: SourceFeatureProjectionAccounting;
  readonly stats: RendererStatsCollector;
  attachment(): EditorMapAttachment | null;
  hideBasemap(): void;
}

function rendererSettled(session: DocumentMapSession): Promise<void> {
  return new Promise<void>((resolve) => {
    if (session.renderer.hasActiveProjection() || session.renderer.publicationInProgress()) {
      session.renderer.afterCurrentProjectionSettles(resolve);
    } else resolve();
  }).then(() => session.renderer.whenRecoverySettled());
}

export interface EditorMapOverlaySnapshotOptions {
  readonly map: MLMap;
  readonly renderer: DocumentMapSession['renderer'];
  readonly catalog: readonly LayerSpecification[];
  readonly representationId: ViewOptions['viewMode'];
}

export function editorMapOverlaySnapshot(options: EditorMapOverlaySnapshotOptions) {
  const { map, renderer } = options;
  const sourceId = renderer.activeSourceId(SRC_STATIONS);
  const expectedLayers = sourceBankLayerSpecs(
    documentLayerSpecsForViewMode(options.catalog, options.representationId),
  );
  const sourceExists = Boolean(map.getSource(sourceId));
  const sourceLoaded = sourceExists && map.isSourceLoaded(sourceId);
  const rendererLayerCount = expectedLayers.filter((layer) => map.getLayer(layer.id)).length;
  return {
    sourceExists,
    layerExists: Boolean(map.getLayer(renderer.activeLayerId(LYR_STATIONS) ?? '')),
    symbolLayerExists: Boolean(
      map.getLayer(renderer.activeLayerId(LYR_STATION_LABELS_MAJOR) ?? ''),
    ),
    overlayHealthy: rendererLayerCount === expectedLayers.length,
    rendererLayerCount,
    expectedRendererLayerCount: expectedLayers.length,
    sourceLoaded,
    featureCount: sourceLoaded ? map.querySourceFeatures(sourceId).length : 0,
  };
}

function overlaySnapshot(context: InstrumentationContext) {
  const { session, ports } = context;
  return editorMapOverlaySnapshot({
    map: session.map,
    renderer: session.renderer,
    catalog: layerSpecsForScheme(ports.style.current.activeTheme),
    representationId: ports.viewStore.getSnapshot().representationId as ViewOptions['viewMode'],
  });
}

function bankSnapshot(context: InstrumentationContext) {
  const { session, ports } = context;
  const snapshot = session.renderer.snapshot();
  const bankedLayers = layerSpecsForScheme(ports.style.current.activeTheme).filter(
    isBankedRenderLayer,
  );
  const activeLayerIds = (hit: boolean) =>
    bankedLayers
      .filter((layer) => ('source' in layer && layer.source === SRC_HIT_FEATURES) === hit)
      .map((layer) => session.renderer.activeLayerId(layer.id))
      .filter((id): id is string => Boolean(id && session.map.getLayer(id)));
  const activeVisualSourceIds = COMMITTED_SYSTEM_FEATURE_SOURCES.map((sourceId) =>
    session.renderer.activeSourceId(sourceId),
  ).filter((sourceId) => Boolean(session.map.getSource(sourceId)));
  return {
    activeBank: snapshot.activeBank,
    stagingBank: snapshot.stagingBank,
    activeRevision: snapshot.activeRevision,
    activeVisualSourceIds,
    activeVisualLayerIds: activeLayerIds(false),
    activeVisualSourceId: snapshot.activeBank ? session.renderer.activeSourceId(SRC_WAYS) : null,
    activeHitSourceId: snapshot.activeBank
      ? session.renderer.activeSourceId(SRC_HIT_FEATURES)
      : null,
    activeHitLayerIds: activeLayerIds(true),
    activeVisualLayerId: session.renderer.activeLayerId(LYR_WAYS_SOLID),
    activeHitLayerId: session.renderer.activeLayerId(LYR_SERVICES_HIT),
    selectedFeatureStateSourceIds: context.attachment()?.selectedSourceIds() ?? [],
    diagnostics: snapshot.diagnostics,
    scheduler: snapshot.scheduler,
  };
}

function perfOptions(context: InstrumentationContext): PerfHarnessOptions {
  const { session, ports, stats } = context;
  return {
    stopSnapshot: (stopId) => {
      const system = ports.store.getState().system;
      const stop = system.stops.find((candidate) => candidate.id === stopId);
      return stop
        ? { coord: stop.coord, revision: system.updatedAt, wayCount: system.ways.length }
        : null;
    },
    overlaySnapshot: () => overlaySnapshot(context),
    rendererStats: () => stats.snapshot(),
    rendererSettled: () => rendererSettled(session),
    rendererSettlementVersion: () => session.renderer.recoveryVersion(),
    renderSourceBankSnapshot: () => bankSnapshot(context),
  };
}

function attachPaintProof(context: InstrumentationContext, trace: string[]): () => void {
  const { session, ports, counts } = context;
  let acceptedDocumentId: string | null = null;
  const unsubscribe = session.subscribeAcceptedScene(({ snapshot, update }) => {
    recordFullProjection(counts, update.sourceUploadCount);
    if (snapshot.status === 'ready' && snapshot.system.id === ports.store.getState().system.id) {
      trace.push('scene-accepted');
      acceptedDocumentId = snapshot.system.id;
      session.map.triggerRepaint();
    }
    if (ports.viewStore.getSnapshot().representationId === 'diagram') context.hideBasemap();
  });
  const onRender = () => {
    const current = ports.store.getState();
    const sourceId = session.renderer.activeSourceId(SRC_STATIONS);
    if (
      acceptedDocumentId === null ||
      current.documentStatus !== 'ready' ||
      current.system.id !== acceptedDocumentId ||
      !session.map.getSource(sourceId) ||
      !session.map.isSourceLoaded(sourceId)
    )
      return;
    session.map.off('render', onRender);
    markFirstSystemMapPaint();
  };
  session.map.on('render', onRender);
  return () => {
    unsubscribe();
    session.map.off('render', onRender);
  };
}

export function attachEditorMapInstrumentation(context: InstrumentationContext): () => void {
  const trace: string[] = [];
  if (PERF_HARNESS_BUILD) {
    window.__mapProjectionCounts = () => ({
      ...context.counts,
      ...context.accounting.snapshot(),
    });
    window.__mapStartupTrace = () => [...trace];
  }
  const detachPaintProof = attachPaintProof(context, trace);
  const detachPerf = attachPerfHarness(context.session.map, perfOptions(context));
  const detachSimDev = attachSimDevHandle(context.ports.simClock);
  return () => {
    detachPaintProof();
    detachPerf();
    detachSimDev();
    if (PERF_HARNESS_BUILD) {
      delete window.__mapProjectionCounts;
      delete window.__mapStartupTrace;
    }
  };
}
