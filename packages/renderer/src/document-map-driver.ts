/* eslint-disable max-lines, max-lines-per-function -- The attachment closure keeps every listener and worker in one disposal scope. */
import type { Map as MapLibreMap, MapEventType, MapSourceDataEvent } from 'maplibre-gl';
import { systemBounds } from '@transitmapper/core/model/geo/bounds';
import { createRenderTierStateResolver } from '@transitmapper/core/render/render-presentation';
import type { RenderViewOptions } from '@transitmapper/core/render/buildFeatures';
import type {
  MapDefinition,
  MapDriver,
  MapDriverAttachment,
  MapDriverAttachOptions,
} from '@transitmapper/map';
import type { MapPresentationStateV1 } from '@transitmapper/views';
import {
  createCameraRenderPreloadController,
  createPresentationRefreshScheduler,
} from './camera-render-preload';
import { createDiagramLayoutWorker, type DiagramLayoutWorkerClient } from './diagram-layout-worker';
import { createFeatureProjectionWorker } from './feature-projection-worker';
import { SRC_HIT_FEATURES } from './layers/constants';
import { createLiveMapRenderer, type LiveMapRendererHost } from './live-map-renderer';
import { renderPresentationFromMap } from './render-presentation';
import { applyRendererVisibilityFilters, planViewRenderUpdate } from './render-visibility';
import { physicalRenderSourceIds, sourceBankLayerSpecs } from './source-bank-layers';
import {
  committedSystemFeatureSources,
  COMMITTED_SYSTEM_FEATURE_SOURCES,
} from './system-feature-sources';
import { createSourceUploadQueue, sourceUploadsForSystemChange } from './sourceUploadPlan';
import type { GeoJsonSourceTarget } from './render-scene-source-updater';
import { documentMapFeatureDetails } from './document-map-feature-details';
import type {
  DocumentMapDriverOptions,
  DocumentMapProjectionRequest,
  DocumentMapSceneAccepted,
  DocumentMapScheduler,
  DocumentMapSession,
  DocumentMapSessionAttachment,
  DocumentMapSnapshot,
} from './document-map-driver-types';
export type * from './document-map-driver-types';

interface ActiveProjection {
  readonly generation: number;
  readonly snapshot: DocumentMapSnapshot;
}

const emptyFeatureCollection = { type: 'FeatureCollection' as const, features: [] };

function defaultScheduler(): DocumentMapScheduler {
  return {
    now: () => performance.now(),
    scheduleFrame: (callback) => requestAnimationFrame(() => callback()),
    cancelFrame: (handle) => cancelAnimationFrame(handle),
    scheduleTimer: (callback, delayMs) => window.setTimeout(callback, delayMs),
    cancelTimer: (handle) => window.clearTimeout(handle),
  };
}

function reportSafely(options: MapDriverAttachOptions, error: unknown): void {
  try {
    options.host.reportError(error);
  } catch {
    // Diagnostics cannot abort renderer or MapLibre listener cleanup.
  }
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

class DocumentMapDriver implements MapDriver {
  readonly definition: MapDefinition;

  constructor(private readonly options: DocumentMapDriverOptions) {
    this.definition = options.definition;
  }

  attach(attachOptions: MapDriverAttachOptions): Promise<MapDriverAttachment> {
    const attachmentIsAborted = () => attachOptions.signal.aborted;
    if (attachmentIsAborted()) {
      return Promise.resolve({ resolveFeature: () => Promise.resolve(null), dispose() {} });
    }
    const map = attachOptions.host.map;
    const scheduler = this.options.scheduler ?? defaultScheduler();
    const ownsScheduler = this.options.scheduler === undefined;
    const featureProjection = this.options.createFeatureProjectionWorker
      ? this.options.createFeatureProjectionWorker()
      : createFeatureProjectionWorker();
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
    let styleRecoveryPending = false;
    let styleRecoveryContinuation: (() => void) | null = null;
    const continueStyleRecovery = () => {
      const continuation = styleRecoveryContinuation;
      styleRecoveryContinuation = null;
      continuation?.();
    };
    const acceptsWork = () => !disposed && !attachmentIsAborted();
    let latestSnapshot = this.options.source.getSnapshot();
    let previousView = this.options.resolvePresentation(attachOptions.viewStore.getSnapshot());
    const acceptedListeners = new Set<(event: DocumentMapSceneAccepted) => void>();
    const sourceQueue = createSourceUploadQueue();
    const cameraPreload = createCameraRenderPreloadController();
    cameraPreload.observe(presentationFromMap(map), scheduler.now());
    const tierStateResolver = createRenderTierStateResolver();

    const logicalLayerSpecs = () => this.options.layerSpecs();
    const physicalLayerSpecs = () => sourceBankLayerSpecs(logicalLayerSpecs());
    const applyVisibility = () =>
      applyRendererVisibilityFilters(
        map,
        physicalLayerSpecs(),
        previousView.visibleModes,
        previousView.visibleWayTypes,
      );
    const ensureOverlay = (): boolean => {
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
        const specs = physicalLayerSpecs();
        for (let index = 0; index < specs.length; index += 1) {
          const spec = specs[index];
          if (map.getLayer(spec.id)) continue;
          const anchor = specs.slice(index + 1).find((candidate) => map.getLayer(candidate.id));
          map.addLayer(spec, anchor?.id);
        }
        applyVisibility();
        overlayReady = true;
        return true;
      } catch (error) {
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
    const renderer = createLiveMapRenderer({
      host: rendererHost,
      layerSpecs: logicalLayerSpecs(),
      featureProjectionWorker: featureProjection,
      layoutDiagram: async (system, revision, signal) => {
        diagramLayout ??= createDiagram();
        return (await diagramLayout.layout(system, revision, signal)).system;
      },
      requeueProjection: (sourceIds, transition) =>
        sourceQueue.add(sourceIds, transition ?? undefined),
      onError: (error) => {
        if (!disposed && !attachOptions.signal.aborted && !styleRecoveryPending) {
          reportSafely(attachOptions, error);
        }
      },
    });
    const onMapError = (event: MapEventType['error']) => {
      renderer.handleSourceError(event);
    };
    map.on('error', onMapError);

    const renderView = (): RenderViewOptions => ({
      ...previousView,
      presentation: presentationFromMap(map),
      styleDeferredVisibility: true,
      tierStateResolver,
    });
    const publishMilestones = () => {
      if (!sessionAttached) {
        startupMilestonesPending = true;
        return;
      }
      if (!acceptsWork()) return;
      startupMilestonesPending = false;
      try {
        attachOptions.milestones.contentCommitted();
      } catch (error) {
        reportSafely(attachOptions, error);
      }
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
      sourceQueue.add(request.sourceIds ?? 'all', request.transition);
      if (request.replaceActive && renderer.hasActiveProjection())
        renderer.cancelProjectionAndRequeue();
      scheduleQueuedProjection();
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
        acceptedSnapshot = snapshot;
        publishMilestones();
        return;
      }
      const batch = sourceQueue.takeBatch();
      const sourceIds =
        batch.sourceIds.length > 0
          ? committedSystemFeatureSources(batch.sourceIds)
          : COMMITTED_SYSTEM_FEATURE_SOURCES;
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
            selection: null,
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
          if (!styleRecoveryPending) reportSafely(attachOptions, error);
        }
      } finally {
        if (isCurrentProjection()) activeProjection = null;
        if (projectionFailed && styleRecoveryPending) continueStyleRecovery();
        if (latestSnapshot !== snapshot || (!projectionFailed && sourceQueue.hasPending())) {
          scheduleQueuedProjection();
        }
      }
    };

    const onSnapshot = (snapshot: DocumentMapSnapshot) => {
      if (disposed || attachmentIsAborted()) return;
      const previous = latestSnapshot;
      latestSnapshot = snapshot;
      if (snapshot.status !== 'ready') return;
      if (!acceptedSnapshot && systemBounds(snapshot.system) === null) {
        publishMilestones();
        acceptedSnapshot = snapshot;
        return;
      }
      sourceQueue.add(
        sourceUploadsForSystemChange(previous.system, snapshot.system, {
          forceAll: previous.system.id !== snapshot.system.id,
        }),
        { previous: previous.system, next: snapshot.system },
      );
      if (previous.system.id !== snapshot.system.id && renderer.hasActiveProjection()) {
        renderer.cancelProjectionAndRequeue();
      }
      scheduleQueuedProjection();
    };
    const unsubscribeSource = this.options.source.subscribe(onSnapshot);

    const onView = (state: MapPresentationStateV1) => {
      if (disposed || attachOptions.signal.aborted) return;
      try {
        const next = this.options.resolvePresentation(state);
        const plan = planViewRenderUpdate(previousView, next);
        previousView = next;
        if (plan.updateFilters) applyVisibility();
        if (plan.reproject) scheduleProjection({ replaceActive: true });
      } catch (error) {
        reportSafely(attachOptions, error);
      }
    };
    const unsubscribeView = attachOptions.viewStore.subscribe(onView);

    const presentationRefresh = createPresentationRefreshScheduler({
      intervalMs: 80,
      now: () => scheduler.now(),
      scheduleFrame: (callback) => scheduler.scheduleFrame(callback),
      cancelFrame: (handle) => scheduler.cancelFrame(handle),
      scheduleTimer: (callback, delayMs) => scheduler.scheduleTimer(callback, delayMs),
      cancelTimer: (handle) => scheduler.cancelTimer(handle),
      refresh: () => scheduleProjection(),
    });
    const onCamera = () => {
      cameraPreload.observe(presentationFromMap(map), scheduler.now());
      presentationRefresh.request();
    };
    map.on('move', onCamera);
    map.on('zoom', onCamera);
    map.on('moveend', onCamera);

    const recoverAcceptedStyle = () => {
      if (!acceptsWork()) return;
      renderer.requestRecovery();
      void renderer.whenRecoverySettled().then(
        () => {
          styleRecoveryPending = false;
          if (!acceptsWork()) return;
          renderer.restoreActiveLayers();
          if (sourceQueue.hasPending()) scheduleQueuedProjection();
        },
        (error: unknown) => {
          styleRecoveryPending = false;
          if (acceptsWork()) reportSafely(attachOptions, error);
        },
      );
    };
    const recoverStyle = () => {
      if (!acceptsWork()) return;
      try {
        if (!ensureOverlay()) return;
        styleRecoveryPending = true;
        if (renderer.hasAcceptedScene()) {
          if (renderer.hasActiveProjection() || renderer.publicationInProgress()) {
            styleRecoveryContinuation = recoverAcceptedStyle;
            renderer.afterCurrentProjectionSettles(continueStyleRecovery);
          } else {
            recoverAcceptedStyle();
          }
        } else {
          const scheduleInitialProjection = () => {
            styleRecoveryPending = false;
            scheduleProjection();
          };
          if (renderer.hasActiveProjection() || renderer.publicationInProgress()) {
            styleRecoveryContinuation = scheduleInitialProjection;
            renderer.afterCurrentProjectionSettles(continueStyleRecovery);
          } else {
            scheduleInitialProjection();
          }
        }
      } catch (error) {
        styleRecoveryPending = false;
        reportSafely(attachOptions, error);
      }
    };
    map.on('style.load', recoverStyle);

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

    const session: DocumentMapSession = {
      map,
      renderer,
      getSnapshot: () => latestSnapshot,
      scheduleProjection,
      subscribeAcceptedScene(listener) {
        acceptedListeners.add(listener);
        return () => acceptedListeners.delete(listener);
      },
    };
    let extension: DocumentMapSessionAttachment | undefined;
    try {
      extension = this.options.attachSession?.(session, attachOptions.signal);
    } catch (error) {
      reportSafely(attachOptions, error);
    }
    sessionAttached = true;
    publishPendingMilestones();

    const onAbort = () => dispose();
    function dispose() {
      if (disposed) return;
      disposed = true;
      attachOptions.signal.removeEventListener('abort', onAbort);
      if (scheduledProjection !== null) scheduler.cancelFrame(scheduledProjection);
      scheduledProjection = null;
      unsubscribeSource();
      unsubscribeView();
      map.off('move', onCamera);
      map.off('zoom', onCamera);
      map.off('moveend', onCamera);
      map.off('style.load', recoverStyle);
      map.off('error', onMapError);
      presentationRefresh.dispose();
      styleRecoveryContinuation = null;
      acceptedListeners.clear();
      try {
        extension?.dispose();
      } catch (error) {
        reportSafely(attachOptions, error);
      }
      extension = undefined;
      renderer.dispose();
      diagramLayout?.dispose();
      featureProjection.dispose();
      if (ownsScheduler) scheduler.dispose?.();
    }
    attachOptions.signal.addEventListener('abort', onAbort, { once: true });
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
