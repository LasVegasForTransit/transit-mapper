/* eslint-disable max-lines, max-lines-per-function -- The attachment closure keeps every listener and worker in one disposal scope. */
import type {
  LayerSpecification,
  Map as MapLibreMap,
  MapEventType,
  MapSourceDataEvent,
} from 'maplibre-gl';
import { systemBounds } from '@transitmapper/core/model/geo/bounds';
import { createRenderTierStateResolver } from '@transitmapper/core/render/render-presentation';
import type { RenderViewOptions } from '@transitmapper/core/render/buildFeatures';
import type {
  MapDefinition,
  MapDriver,
  MapDriverAttachment,
  MapDriverAttachOptions,
} from '@transitmapper/map';
import type { MapFeatureReferenceV1, MapPresentationStateV1 } from '@transitmapper/views';
import {
  canReuseCommittedCameraRefresh,
  createCameraRenderPreloadController,
  createPresentationRefreshScheduler,
  type CommittedCameraCoverage,
  type PresentationRefreshScheduler,
} from './camera-render-preload';
import {
  createDiagramLayoutWorker,
  type DiagramLayoutWorkerClient,
} from './workers/diagram-layout-worker';
import {
  createFeatureProjectionWorker,
  type FeatureProjectionClient,
} from './workers/feature-projection-worker';
import { SRC_HIT_FEATURES } from './layers/constants';
import { createLiveMapRenderer, type LiveMapRendererHost } from './live-map-renderer';
import { renderPresentationFromMap } from './render-presentation';
import { applyRendererVisibilityFilters, planViewRenderUpdate } from './render-visibility';
import { physicalRenderSourceIds, sourceBankLayerSpecs } from './sources/source-bank-layers';
import {
  committedSystemFeatureSources,
  COMMITTED_SYSTEM_FEATURE_SOURCES,
} from './system-feature-sources';
import {
  createSourceUploadQueue,
  sourceUploadsForSystemChange,
} from './sources/source-upload-plan';
import type { GeoJsonSourceTarget } from './sources/render-scene-source-updater';
import { documentMapFeatureDetails } from './document-map-feature-details';
import type {
  DocumentMapDriverOptions,
  DocumentMapProjectionRequest,
  DocumentMapSceneAccepted,
  DocumentMapSession,
  DocumentMapSessionAttachment,
  DocumentMapSnapshot,
} from './document-map-driver-types';
import {
  createDocumentMapStyleRecovery,
  type DocumentMapStyleRecovery,
} from './document-map-style-recovery';
import { createDocumentMapScheduler } from './document-map-scheduler';
export type * from './document-map-driver-types';

interface ActiveProjection {
  readonly generation: number;
  readonly snapshot: DocumentMapSnapshot;
}

const emptyFeatureCollection = { type: 'FeatureCollection' as const, features: [] };

function reportSafely(options: MapDriverAttachOptions, error: unknown): void {
  try {
    options.host.reportError(error);
  } catch {
    // Diagnostics cannot abort renderer or MapLibre listener cleanup.
  }
}

function errorFrom(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function cleanupSafely(options: MapDriverAttachOptions, cleanup: (() => void) | null): void {
  if (!cleanup) return;
  try {
    cleanup();
  } catch (error) {
    reportSafely(options, error);
  }
}

function sameLayerOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function installSurfaceLayers(
  map: MapLibreMap,
  specs: readonly LayerSpecification[],
  catalogLayerIds: ReadonlySet<string>,
): void {
  const style = map.getStyle();
  const installedIds = style.layers
    .filter((layer) => catalogLayerIds.has(layer.id))
    .map((layer) => layer.id);
  const desiredIds = specs.map((spec) => spec.id);
  if (sameLayerOrder(installedIds, desiredIds)) return;
  map.setStyle(
    {
      ...style,
      layers: [...style.layers.filter((layer) => !catalogLayerIds.has(layer.id)), ...specs],
    },
    { diff: true, validate: false },
  );
}

function presentationFromMap(map: MapLibreMap) {
  const canvas = map.getCanvas();
  const container = map.getContainer();
  return renderPresentationFromMap({
    bounds: map.getBounds(),
    zoom: map.getZoom(),
    viewportWidthPx: canvas.clientWidth,
    viewportHeightPx: canvas.clientHeight,
    displayedWidthPx: container.clientWidth,
    displayedHeightPx: container.clientHeight,
    pixelRatio: map.getPixelRatio(),
  });
}

function documentHighlight(reference: MapFeatureReferenceV1 | undefined) {
  return reference?.source === 'document' ? { kind: reference.kind, id: reference.id } : null;
}

class DocumentMapDriver implements MapDriver {
  readonly definition: MapDefinition;

  constructor(private readonly options: DocumentMapDriverOptions) {
    this.definition = options.definition;
  }

  // One attachment closure owns every resource and the rollback path, so setup
  // branches remain visible beside the cleanup that reverses them.
  // eslint-disable-next-line complexity, sonarjs/cognitive-complexity -- One closure keeps setup rollback atomic across every owned resource.
  attach(attachOptions: MapDriverAttachOptions): Promise<MapDriverAttachment> {
    const attachmentIsAborted = () => attachOptions.signal.aborted;
    if (attachmentIsAborted()) {
      return Promise.resolve({ resolveFeature: () => Promise.resolve(null), dispose() {} });
    }
    const map = attachOptions.host.map;
    const scheduler = this.options.scheduler ?? createDocumentMapScheduler();
    const ownsScheduler = this.options.scheduler === undefined;
    let latestSnapshot: DocumentMapSnapshot;
    let previousView: ReturnType<DocumentMapDriverOptions['resolvePresentation']>;
    let initialPresentation: ReturnType<typeof presentationFromMap>;
    let initialPresentationTime: number;
    try {
      latestSnapshot = this.options.source.getSnapshot();
      previousView = this.options.resolvePresentation(attachOptions.viewStore.getSnapshot());
      initialPresentation = presentationFromMap(map);
      initialPresentationTime = scheduler.now();
    } catch (error) {
      if (ownsScheduler) cleanupSafely(attachOptions, () => scheduler.dispose?.());
      return Promise.reject(errorFrom(error));
    }
    let featureProjection: FeatureProjectionClient;
    try {
      featureProjection = this.options.createFeatureProjectionWorker
        ? this.options.createFeatureProjectionWorker()
        : createFeatureProjectionWorker();
    } catch (error) {
      if (ownsScheduler) cleanupSafely(attachOptions, () => scheduler.dispose?.());
      return Promise.reject(errorFrom(error));
    }
    let diagramLayout: DiagramLayoutWorkerClient | null = null;
    const createDiagram = () =>
      this.options.createDiagramLayoutWorker?.() ?? createDiagramLayoutWorker();
    let disposed = false;
    let overlayReady = false;
    let projectionGeneration = 0;
    let scheduledProjection: number | null = null;
    let activeProjection: ActiveProjection | null = null;
    let acceptedSnapshot: DocumentMapSnapshot | null = null;
    let sessionAttached = false;
    let startupMilestonesPending = false;
    let styleRecovery: DocumentMapStyleRecovery | null = null;
    let committedCameraCoverage: CommittedCameraCoverage | null = null;
    let renderedSystemId: string | null = null;
    let startupMilestonesPublished = false;
    let unsubscribeSource: (() => void) | null = null;
    let unsubscribeView: (() => void) | null = null;
    let unsubscribeSelection: (() => void) | null = null;
    let presentationRefresh: PresentationRefreshScheduler | null = null;
    let extension: DocumentMapSessionAttachment | undefined;
    let sessionAttachmentAttempted = false;
    let attachSessionAfterOverlay = () => {};
    let onAbort: (() => void) | null = null;
    const mapListenerCleanups: Array<() => void> = [];
    const acceptsWork = () => !disposed && !attachmentIsAborted();
    const acceptedListeners = new Set<(event: DocumentMapSceneAccepted) => void>();
    const sourceQueue = createSourceUploadQueue();
    const cameraPreload = createCameraRenderPreloadController();
    cameraPreload.observe(initialPresentation, initialPresentationTime);
    const tierStateResolver = createRenderTierStateResolver();

    const logicalLayerSpecs = () => this.options.layerSpecs();
    const requiredLogicalLayerSpecs = () => {
      const catalog = logicalLayerSpecs();
      return this.options.layerSpecsForPresentation?.(catalog, previousView) ?? catalog;
    };
    const surfaceLogicalLayerSpecs = () => {
      const catalog = logicalLayerSpecs();
      return (
        this.options.surfaceLayerSpecsForPresentation?.(catalog, previousView) ??
        requiredLogicalLayerSpecs()
      );
    };
    const physicalLayerSpecs = () => sourceBankLayerSpecs(requiredLogicalLayerSpecs());
    const physicalSurfaceLayerSpecs = () => sourceBankLayerSpecs(surfaceLogicalLayerSpecs());
    const physicalCatalogLayerIds = () =>
      new Set(sourceBankLayerSpecs(logicalLayerSpecs()).map((spec) => spec.id));
    const applyVisibility = () =>
      applyRendererVisibilityFilters(
        map,
        physicalLayerSpecs(),
        previousView.visibleModes,
        previousView.visibleWayTypes,
      );
    const ensureOverlay = (): boolean => {
      if (latestSnapshot.status !== 'ready') return false;
      try {
        this.options.setupStaticSources?.(map);
        for (const sourceId of physicalRenderSourceIds([
          ...COMMITTED_SYSTEM_FEATURE_SOURCES,
          SRC_HIT_FEATURES,
        ])) {
          if (!map.getSource(sourceId)) {
            map.addSource(sourceId, { type: 'geojson', data: emptyFeatureCollection });
          }
        }
        installSurfaceLayers(map, physicalSurfaceLayerSpecs(), physicalCatalogLayerIds());
        applyVisibility();
        overlayReady = true;
        attachSessionAfterOverlay();
        return true;
      } catch (error) {
        overlayReady = false;
        if (error instanceof Error && error.message === 'Style is not done loading.') return false;
        throw error;
      }
    };

    const rendererHost: LiveMapRendererHost = {
      resolveSource: (sourceId) => {
        const source = map.getSource(sourceId);
        if (!source || !('setData' in source)) {
          throw new Error(`Renderer source is unavailable: ${sourceId}`);
        }
        if (!('updateData' in source)) {
          throw new Error(`Renderer source cannot accept patches: ${sourceId}`);
        }
        return source as unknown as GeoJsonSourceTarget;
      },
      hasLayer: (layerId) => Boolean(map.getLayer(layerId)),
      setLayerVisibility: (layerId, visibility) =>
        map.setLayoutProperty(layerId, 'visibility', visibility),
      setLayerPaintProperty: (layerId, property, value) =>
        map.setPaintProperty(layerId, property, value),
      ensureOverlay,
      now: () => scheduler.now(),
      scheduleFrame: (callback) => scheduler.scheduleFrame(callback),
      cancelFrame: (handle) => scheduler.cancelFrame(handle),
      triggerRepaint: () => map.triggerRepaint(),
      isSourceLoaded: (sourceId) =>
        Boolean(map.getSource(sourceId)) && map.isSourceLoaded(sourceId),
      onSourceData(listener) {
        const onSourceData = (event: MapSourceDataEvent) => listener(event.sourceId);
        map.on('sourcedata', onSourceData);
        return () => map.off('sourcedata', onSourceData);
      },
      onRender(listener) {
        const onRender = () => listener();
        map.on('render', onRender);
        return () => map.off('render', onRender);
      },
    };
    let renderer: ReturnType<typeof createLiveMapRenderer>;
    try {
      renderer = createLiveMapRenderer({
        host: rendererHost,
        layerSpecs: logicalLayerSpecs(),
        featureProjectionWorker: featureProjection,
        layoutDiagram: async (system, revision, signal) => {
          diagramLayout ??= createDiagram();
          return (await diagramLayout.layout(system, revision, signal)).system;
        },
        requeueProjection: (sourceIds, transition) =>
          sourceQueue.add(sourceIds, transition ?? undefined),
        projectionAccounting: this.options.projectionAccounting,
        rendererStats: this.options.rendererStats,
        instrumentationEnabled: this.options.instrumentationEnabled,
        synchronizeInteractionState: (targets) => {
          if (!acceptsWork()) return;
          try {
            if (targets) extension?.synchronizeInteractionState?.(targets);
            else extension?.synchronizeInteractionState?.();
          } catch (error) {
            reportSafely(attachOptions, error);
          }
        },
        refreshInteractionPreviews: () => {
          if (!acceptsWork()) return;
          try {
            extension?.refreshInteractionPreviews?.();
          } catch (error) {
            reportSafely(attachOptions, error);
          }
        },
        onError: (error) => {
          if (!disposed && !attachOptions.signal.aborted && !styleRecovery?.isPending()) {
            reportSafely(attachOptions, error);
          }
        },
      });
    } catch (error) {
      cleanupSafely(attachOptions, () => featureProjection.dispose());
      if (ownsScheduler) cleanupSafely(attachOptions, () => scheduler.dispose?.());
      return Promise.reject(errorFrom(error));
    }
    const onMapError = (event: MapEventType['error']) => {
      renderer.handleSourceError(event);
    };
    try {
      map.on('error', onMapError);
      mapListenerCleanups.push(() => map.off('error', onMapError));
    } catch (error) {
      dispose();
      return Promise.reject(errorFrom(error));
    }

    const renderView = (): RenderViewOptions => ({
      ...previousView,
      presentation: presentationFromMap(map),
      styleDeferredVisibility: true,
      tierStateResolver,
    });
    const publishMilestones = () => {
      if (startupMilestonesPublished) return;
      if (!sessionAttached) {
        startupMilestonesPending = true;
        return;
      }
      if (!acceptsWork()) return;
      startupMilestonesPending = false;
      startupMilestonesPublished = true;
      try {
        attachOptions.milestones.contentCommitted();
      } catch (error) {
        reportSafely(attachOptions, error);
      }
      if (!acceptsWork()) return;
      try {
        attachOptions.milestones.interactive();
      } catch (error) {
        reportSafely(attachOptions, error);
      }
    };
    const publishPendingMilestones = () => {
      if (startupMilestonesPending) publishMilestones();
    };
    const scheduleQueuedProjection = () => {
      if (disposed || attachmentIsAborted()) return;
      if (scheduledProjection !== null) return;
      scheduledProjection = scheduler.scheduleFrame(() => {
        scheduledProjection = null;
        void flushProjection();
      });
    };
    const scheduleProjection = (request: DocumentMapProjectionRequest = {}) => {
      if (disposed || attachOptions.signal.aborted) return;
      if (request.sourceIds?.length === 0) return;
      sourceQueue.add(request.sourceIds ?? 'all', request.transition);
      if (request.replaceActive && renderer.hasActiveProjection())
        renderer.cancelProjectionAndRequeue();
      scheduleQueuedProjection();
    };
    const session: DocumentMapSession = {
      map,
      renderer,
      getSnapshot: () => latestSnapshot,
      scheduleProjection,
      recoverStyle: () => styleRecovery?.handleStyleLoad(),
      subscribeAcceptedScene(listener) {
        acceptedListeners.add(listener);
        return () => acceptedListeners.delete(listener);
      },
    };
    attachSessionAfterOverlay = () => {
      if (sessionAttachmentAttempted || !acceptsWork()) return;
      sessionAttachmentAttempted = true;
      try {
        extension = this.options.attachSession?.(session, attachOptions.signal);
      } catch (error) {
        reportSafely(attachOptions, error);
      }
      sessionAttached = true;
      publishPendingMilestones();
    };
    const discardQueuedProjection = () => {
      if (sourceQueue.hasPending()) sourceQueue.takeBatch();
      const pendingProjection = scheduledProjection;
      scheduledProjection = null;
      cleanupSafely(
        attachOptions,
        pendingProjection === null ? null : () => scheduler.cancelFrame(pendingProjection),
      );
    };
    // Projection settlement has one exit path so stale results cannot publish.
    // eslint-disable-next-line complexity, sonarjs/cognitive-complexity -- Settlement handles cancellation, replacement, and recovery in one transaction.
    const flushProjection = async () => {
      if (disposed || attachOptions.signal.aborted || !overlayReady) return;
      if (renderer.publicationInProgress() || renderer.hasActiveProjection()) {
        renderer.afterCurrentProjectionSettles(scheduleQueuedProjection);
        return;
      }
      const snapshot = latestSnapshot;
      if (snapshot.status !== 'ready') return;
      if (!acceptedSnapshot && systemBounds(snapshot.system) === null) {
        discardQueuedProjection();
        acceptedSnapshot = snapshot;
        publishMilestones();
        return;
      }
      if (!sourceQueue.hasPending()) return;
      const batch = sourceQueue.takeBatch();
      const sourceIds = committedSystemFeatureSources(batch.sourceIds);
      if (sourceIds.length === 0) return;
      const identityChanged =
        acceptedSnapshot !== null && acceptedSnapshot.system.id !== snapshot.system.id;
      const generation = ++projectionGeneration;
      activeProjection = { generation, snapshot };
      const isCurrentProjection = () => activeProjection?.generation === generation;
      const presentation = presentationFromMap(map);
      const preload = cameraPreload.prepare(presentation, scheduler.now());
      let projectionFailed = false;
      try {
        await renderer.projectDocument({
          revision: `${snapshot.system.id}:${generation}`,
          transition: batch.transition,
          requestedSourceIds: sourceIds,
          intent: identityChanged ? 'reset' : 'incremental',
          candidateEnvelope: preload.candidateEnvelope,
          projection: {
            system: snapshot.system,
            selection: documentHighlight(attachOptions.selection.getSnapshot()),
            handleWayIds: [],
            view: renderView(),
            physicalHandleStationId: null,
            physicalHandleGroupId: null,
            activePatternId: null,
            armedTerminus: null,
            selectionOwnedConnectors: false,
          },
          onAccepted: ({ update, settlementLatencyMs }) => {
            if (disposed || attachOptions.signal.aborted || !isCurrentProjection()) return;
            cameraPreload.accept(preload.token, settlementLatencyMs);
            committedCameraCoverage = {
              presentation,
              candidateEnvelope: preload.candidateEnvelope,
            };
            renderedSystemId = snapshot.system.id;
            acceptedSnapshot = snapshot;
            const event = { snapshot, update };
            for (const listener of acceptedListeners) {
              try {
                listener(event);
              } catch (error) {
                reportSafely(attachOptions, error);
              }
            }
            publishMilestones();
          },
        });
      } catch (error) {
        if (acceptsWork() && isCurrentProjection()) {
          projectionFailed = true;
          sourceQueue.add(sourceIds, batch.transition ?? undefined);
          if (!styleRecovery?.isPending()) reportSafely(attachOptions, error);
        }
      } finally {
        if (isCurrentProjection()) activeProjection = null;
        if (projectionFailed) styleRecovery?.continueAfterProjectionFailure();
        if (latestSnapshot !== snapshot || (!projectionFailed && sourceQueue.hasPending())) {
          scheduleQueuedProjection();
        }
      }
    };

    const authoritativeSystemId = (fallback: DocumentMapSnapshot) =>
      acceptedSnapshot?.system.id ?? activeProjection?.snapshot.system.id ?? fallback.system.id;
    const onSnapshot = (snapshot: DocumentMapSnapshot) => {
      if (disposed || attachmentIsAborted()) return;
      const previous = latestSnapshot;
      latestSnapshot = snapshot;
      if (snapshot.status !== 'ready') return;
      if (!overlayReady) {
        try {
          if (!ensureOverlay()) return;
        } catch (error) {
          reportSafely(attachOptions, error);
          return;
        }
      }
      const identityChanged = authoritativeSystemId(previous) !== snapshot.system.id;
      if (identityChanged) {
        cameraPreload.reset();
        committedCameraCoverage = null;
        renderedSystemId = null;
      }
      if (!acceptedSnapshot && systemBounds(snapshot.system) === null) {
        if (activeProjection) {
          renderer.cancelProjectionAndRequeue();
          activeProjection = null;
        }
        discardQueuedProjection();
        publishMilestones();
        acceptedSnapshot = snapshot;
        return;
      }
      const sourceIds = sourceUploadsForSystemChange(previous.system, snapshot.system, {
        forceAll: acceptedSnapshot === null || identityChanged,
      });
      if (sourceIds.length === 0) return;
      sourceQueue.add(sourceIds, { previous: previous.system, next: snapshot.system });
      if (identityChanged && renderer.hasActiveProjection()) {
        renderer.cancelProjectionAndRequeue();
      }
      scheduleQueuedProjection();
    };

    const onView = (state: MapPresentationStateV1) => {
      if (disposed || attachOptions.signal.aborted) return;
      try {
        const next = this.options.resolvePresentation(state);
        const plan = planViewRenderUpdate(previousView, next);
        previousView = next;
        if (plan.reproject) overlayReady = ensureOverlay();
        if (plan.updateFilters) applyVisibility();
        if (plan.reproject) scheduleProjection({ replaceActive: true });
      } catch (error) {
        reportSafely(attachOptions, error);
      }
    };
    const onSelection = () => {
      scheduleProjection({ replaceActive: true });
    };
    try {
      unsubscribeSource = this.options.source.subscribe(onSnapshot);
      unsubscribeView = attachOptions.viewStore.subscribe(onView);
      unsubscribeSelection = attachOptions.selection.subscribe(onSelection);
    } catch (error) {
      dispose();
      return Promise.reject(errorFrom(error));
    }

    const refresh = createPresentationRefreshScheduler({
      intervalMs: 80,
      now: () => scheduler.now(),
      scheduleFrame: (callback) => scheduler.scheduleFrame(callback),
      cancelFrame: (handle) => scheduler.cancelFrame(handle),
      scheduleTimer: (callback, delayMs) => scheduler.scheduleTimer(callback, delayMs),
      cancelTimer: (handle) => scheduler.cancelTimer(handle),
      refresh: () => {
        const current = presentationFromMap(map);
        if (
          canReuseCommittedCameraRefresh({
            committed: committedCameraCoverage,
            current,
            renderedSystemId,
            currentSystemId: latestSnapshot.system.id,
            rendererHealthy: overlayReady && !styleRecovery?.isPending(),
            projectionActive: activeProjection !== null || renderer.hasActiveProjection(),
          })
        ) {
          return;
        }
        scheduleProjection();
      },
    });
    presentationRefresh = refresh;
    const onCamera = () => {
      cameraPreload.observe(presentationFromMap(map), scheduler.now());
      refresh.request();
    };
    try {
      map.on('move', onCamera);
      mapListenerCleanups.push(() => map.off('move', onCamera));
      map.on('zoom', onCamera);
      mapListenerCleanups.push(() => map.off('zoom', onCamera));
      map.on('moveend', onCamera);
      mapListenerCleanups.push(() => map.off('moveend', onCamera));
    } catch (error) {
      dispose();
      return Promise.reject(errorFrom(error));
    }

    styleRecovery = createDocumentMapStyleRecovery({
      renderer,
      scheduler,
      acceptsWork,
      ensureOverlay: () => {
        overlayReady = false;
        return ensureOverlay();
      },
      hasQueuedProjection: () => sourceQueue.hasPending(),
      scheduleQueuedProjection,
      scheduleProjection,
      restoreAfterStyle: () => {
        if (!acceptsWork()) return;
        try {
          extension?.restoreAfterStyle?.();
        } catch (error) {
          reportSafely(attachOptions, error);
        }
      },
      reportError: (error) => reportSafely(attachOptions, error),
    });
    const onStyleLoad = () => session.recoverStyle();
    try {
      map.on('style.load', onStyleLoad);
      mapListenerCleanups.push(() => map.off('style.load', onStyleLoad));
    } catch (error) {
      dispose();
      return Promise.reject(errorFrom(error));
    }

    try {
      if (ensureOverlay()) {
        if (latestSnapshot.status === 'ready' && systemBounds(latestSnapshot.system) === null) {
          acceptedSnapshot = latestSnapshot;
          publishMilestones();
        } else if (latestSnapshot.status === 'ready') {
          scheduleProjection();
        }
      }
    } catch (error) {
      reportSafely(attachOptions, error);
    }

    // eslint-disable-next-line sonarjs/cognitive-complexity -- Each cleanup failure is isolated so later resources still release.
    function dispose() {
      if (disposed) return;
      disposed = true;
      const abortListener = onAbort;
      onAbort = null;
      cleanupSafely(
        attachOptions,
        abortListener
          ? () => attachOptions.signal.removeEventListener('abort', abortListener)
          : null,
      );
      const pendingProjection = scheduledProjection;
      scheduledProjection = null;
      cleanupSafely(
        attachOptions,
        pendingProjection === null ? null : () => scheduler.cancelFrame(pendingProjection),
      );
      const sourceCleanup = unsubscribeSource;
      unsubscribeSource = null;
      cleanupSafely(attachOptions, sourceCleanup);
      const viewCleanup = unsubscribeView;
      unsubscribeView = null;
      cleanupSafely(attachOptions, viewCleanup);
      const selectionCleanup = unsubscribeSelection;
      unsubscribeSelection = null;
      cleanupSafely(attachOptions, selectionCleanup);
      const listenerCleanups = mapListenerCleanups.splice(0);
      for (const cleanup of listenerCleanups) cleanupSafely(attachOptions, cleanup);
      const refresh = presentationRefresh;
      presentationRefresh = null;
      cleanupSafely(attachOptions, refresh ? () => refresh.dispose() : null);
      const recovery = styleRecovery;
      styleRecovery = null;
      cleanupSafely(attachOptions, recovery ? () => recovery.dispose() : null);
      acceptedListeners.clear();
      const attachedExtension = extension;
      extension = undefined;
      cleanupSafely(attachOptions, attachedExtension ? () => attachedExtension.dispose() : null);
      cleanupSafely(attachOptions, () => renderer.dispose());
      const layout = diagramLayout;
      diagramLayout = null;
      cleanupSafely(attachOptions, layout ? () => layout.dispose() : null);
      cleanupSafely(attachOptions, () => featureProjection.dispose());
      if (ownsScheduler) cleanupSafely(attachOptions, () => scheduler.dispose?.());
    }
    onAbort = dispose;
    try {
      attachOptions.signal.addEventListener('abort', onAbort, { once: true });
    } catch (error) {
      dispose();
      return Promise.reject(errorFrom(error));
    }
    if (attachmentIsAborted()) dispose();

    return Promise.resolve({
      resolveFeature(reference, signal) {
        if (disposed || attachmentIsAborted() || signal.aborted) return Promise.resolve(null);
        return Promise.resolve(documentMapFeatureDetails(latestSnapshot, reference));
      },
      dispose,
    });
  }
}

export function createDocumentMapDriver(options: DocumentMapDriverOptions): MapDriver {
  return new DocumentMapDriver(options);
}
