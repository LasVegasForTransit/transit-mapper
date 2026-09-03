import type { GeoJSONSource, MapMouseEvent } from 'maplibre-gl';
import { serviceWayIds } from '@transitmapper/core/model/geo';
import type { RenderViewOptions } from '@transitmapper/core/render/buildFeatures';
import type { MapViewStore } from '@transitmapper/map';
import type { DocumentMapSession } from '@transitmapper/renderer/driver';
import {
  EDITOR_SYSTEM_FEATURE_SOURCES,
  LYR_FACILITIES,
  LYR_JUNCTIONS,
  LYR_LINE_STRIPE,
  LYR_SERVICES_ELEVATED,
  LYR_SERVICES_SOLID,
  LYR_SERVICES_UNDERGROUND,
  LYR_STATIONS,
  LYR_WAYS_DASHED,
  LYR_WAYS_SOLID,
  SRC_PATTERN_OVERLAY,
  SRC_PATTERN_OVERLAY_ARROWS,
  SRC_PATTERN_OVERLAY_TERMINI,
  SRC_JUNCTION_GUIDES,
  emptySystemFeatures,
} from '@transitmapper/renderer/layers';
import {
  mergeSourceFeatureProjectionCounts,
  type FeatureProjectionClient,
  type PatternOverlayFeatures,
  type PatternOverlayProjectionClient,
  type SourceFeatureProjectionCounts,
} from '@transitmapper/renderer/projection';
import type { AcceptedSceneUpdate } from '@transitmapper/renderer/runtime';
import {
  canApplyEditorSourceUpdate,
  editorPatternOverlayWorkerInput,
  editorOverlayWorkerInput,
  selectedJunctionConnectorFeatures,
} from '../map/editor-overlays';
import { createEditorFeatureState, type SceneTargetResolver } from '../map/editor-feature-state';
import type { EditorStore } from './store';

const HOVER_LAYERS = [
  LYR_WAYS_SOLID,
  LYR_WAYS_DASHED,
  LYR_SERVICES_SOLID,
  LYR_SERVICES_ELEVATED,
  LYR_SERVICES_UNDERGROUND,
  LYR_LINE_STRIPE,
  LYR_STATIONS,
  LYR_FACILITIES,
  LYR_JUNCTIONS,
] as const;

export interface EditorProjectionAccounting {
  readonly counts: SourceFeatureProjectionCounts;
  accept(): boolean;
  discard(): boolean;
}

export interface EditorMapProjectionOptions {
  readonly store: EditorStore;
  readonly viewStore: MapViewStore;
  createWorker(): FeatureProjectionClient & PatternOverlayProjectionClient;
  renderView(): RenderViewOptions;
  overlayNeedsHealing(): boolean;
  beginAccounting(): EditorProjectionAccounting;
  recordUpdate(update: AcceptedSceneUpdate | null): void;
  recordSourceUpload(): void;
  reportError(error: unknown): void;
}

function emptyPatternOverlay(): PatternOverlayFeatures {
  return {
    path: { type: 'FeatureCollection', features: [] },
    arrows: { type: 'FeatureCollection', features: [] },
    termini: { type: 'FeatureCollection', features: [] },
  };
}

export interface EditorMapProjectionController {
  applySelection(resolveTargets?: SceneTargetResolver): void;
  restoreAfterStyle(): void;
  selectedSourceIds(): string[];
  schedule(): void;
  flush(): void;
  dispose(): void;
}

// eslint-disable-next-line max-lines-per-function -- One worker generation owns its feature-state and hover companions.
export function createEditorMapProjection(
  session: DocumentMapSession,
  options: EditorMapProjectionOptions,
): EditorMapProjectionController {
  const reportError = (error: unknown) => options.reportError(error);
  const worker = options.createWorker();
  const featureState = createEditorFeatureState({
    map: session.map,
    renderer: session.renderer,
    readSelection: () => options.store.getState().selection,
  });
  let frame: number | null = null;
  let projectionAbort: AbortController | null = null;
  let revision = 0;
  let disposed = false;
  const handles = () => {
    const state = options.store.getState();
    if (options.viewStore.getSnapshot().representationId === 'diagram') return [];
    if (state.activeWayId) return [state.activeWayId];
    if (state.selection?.kind === 'way') return [state.selection.id];
    if (state.selection?.kind !== 'service') return [];
    const service = state.system.services.find((candidate) => candidate.id === state.selection?.id);
    return service ? serviceWayIds(service) : [];
  };
  const applyProjected = (
    state: ReturnType<EditorStore['getState']>,
    features: ReturnType<typeof emptySystemFeatures>,
    infrastructure: boolean,
    patternOverlay: PatternOverlayFeatures,
  ) => {
    const update = session.renderer.updateEditorScene({
      revision: `${state.system.id}:editor:${++revision}`,
      features,
      sourceIds: EDITOR_SYSTEM_FEATURE_SOURCES,
    });
    options.recordUpdate(update);
    featureState.applySelection();
    const guideSource = session.map.getSource<GeoJSONSource>(SRC_JUNCTION_GUIDES);
    if (guideSource) {
      guideSource.setData(
        infrastructure
          ? selectedJunctionConnectorFeatures(
              state.system,
              state.selection?.kind === 'node' ? state.selection.id : null,
            )
          : { type: 'FeatureCollection', features: [] },
      );
      options.recordSourceUpload();
    }
    for (const [sourceId, data] of [
      [SRC_PATTERN_OVERLAY, patternOverlay.path],
      [SRC_PATTERN_OVERLAY_ARROWS, patternOverlay.arrows],
      [SRC_PATTERN_OVERLAY_TERMINI, patternOverlay.termini],
    ] as const) {
      const source = session.map.getSource<GeoJSONSource>(sourceId);
      if (!source) continue;
      source.setData(data);
      options.recordSourceUpload();
    }
  };
  const update = () => {
    if (
      disposed ||
      options.overlayNeedsHealing() ||
      !canApplyEditorSourceUpdate(
        session.renderer.hasAcceptedScene(),
        session.renderer.publicationInProgress(),
      )
    )
      return;
    const state = options.store.getState();
    const representation = options.viewStore.getSnapshot().representationId;
    if (representation === 'diagram') {
      projectionAbort?.abort();
      projectionAbort = null;
      applyProjected(state, emptySystemFeatures(), false, emptyPatternOverlay());
      return;
    }
    const accounting = options.beginAccounting();
    projectionAbort?.abort();
    const abort = new AbortController();
    projectionAbort = abort;
    const infrastructure = representation === 'infrastructure';
    const view = options.renderView();
    const editorProjection = worker.project(
      editorOverlayWorkerInput({
        system: state.system,
        selection: state.selection,
        handleWayIds: handles(),
        view,
        physicalHandleStationId:
          infrastructure && state.selection?.kind === 'station' ? state.selection.id : null,
        physicalHandleGroupId:
          infrastructure && state.selection?.kind === 'group' ? state.selection.id : null,
        activePatternId: state.activePatternId,
        armedTerminus: state.armedTerminus,
      }),
      abort.signal,
    );
    const patternInput = editorPatternOverlayWorkerInput({
      system: state.system,
      selection: state.selection,
      activePatternId: state.activePatternId,
      armedTerminus: state.armedTerminus,
      view,
    });
    const patternProjection = patternInput
      ? worker.projectPatternOverlay(patternInput, abort.signal)
      : Promise.resolve(emptyPatternOverlay());
    void Promise.all([editorProjection, patternProjection])
      .then(([{ features, counts }, patternOverlay]) => {
        if (disposed || abort.signal.aborted || projectionAbort !== abort) {
          accounting.discard();
          return;
        }
        if (counts) mergeSourceFeatureProjectionCounts(accounting.counts, counts);
        try {
          applyProjected(state, features, infrastructure, patternOverlay);
          accounting.accept();
        } catch (error) {
          accounting.discard();
          options.reportError(error);
        }
      })
      .catch((error: unknown) => {
        accounting.discard();
        if (!disposed && !abort.signal.aborted) options.reportError(error);
      });
  };
  const schedule = () => {
    if (disposed || frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      update();
    });
  };
  const flush = () => {
    if (disposed) return;
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    update();
  };

  let hoverCleanup: () => void;
  try {
    hoverCleanup = attachHover(session, featureState, reportError);
  } catch (error) {
    cleanSafely(() => worker.dispose(), reportError);
    throw error;
  }
  return {
    applySelection: (resolveTargets) => featureState.applySelection(resolveTargets),
    restoreAfterStyle: () => featureState.restoreAfterStyle(),
    selectedSourceIds: () => (disposed ? [] : featureState.selectedSourceIds()),
    schedule,
    flush,
    dispose() {
      if (disposed) return;
      disposed = true;
      const pendingFrame = frame;
      if (pendingFrame !== null) cleanSafely(() => cancelAnimationFrame(pendingFrame), reportError);
      frame = null;
      const pendingProjection = projectionAbort;
      if (pendingProjection) cleanSafely(() => pendingProjection.abort(), reportError);
      projectionAbort = null;
      cleanSafely(() => hoverCleanup(), reportError);
      cleanSafely(() => worker.dispose(), reportError);
    },
  };
}

function attachHover(
  session: DocumentMapSession,
  featureState: ReturnType<typeof createEditorFeatureState>,
  reportError: (error: unknown) => void,
): () => void {
  let pending: MapMouseEvent | null = null;
  let frame: number | null = null;
  const flush = () => {
    frame = null;
    const event = pending;
    pending = null;
    if (!event || session.map.isMoving() || event.originalEvent.buttons !== 0) return;
    const layers = HOVER_LAYERS.flatMap((layer) => session.renderer.physicalLayerIds(layer)).filter(
      (layer) => session.map.getLayer(layer),
    );
    const hit = layers.length
      ? session.map.queryRenderedFeatures(event.point, { layers })[0]
      : undefined;
    featureState.setHoveredFeature(
      hit && typeof hit.source === 'string' && hit.id != null
        ? { source: hit.source, id: String(hit.id) }
        : null,
    );
  };
  const onMove = (event: MapMouseEvent) => {
    pending = event;
    frame ??= requestAnimationFrame(flush);
  };
  const onOut = () => {
    pending = null;
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    featureState.setHoveredFeature(null);
  };
  session.map.on('mousemove', onMove);
  try {
    session.map.on('mouseout', onOut);
  } catch (error) {
    cleanSafely(() => session.map.off('mousemove', onMove), reportError);
    throw error;
  }
  return () => {
    cleanSafely(() => session.map.off('mousemove', onMove), reportError);
    cleanSafely(() => session.map.off('mouseout', onOut), reportError);
    cleanSafely(onOut, reportError);
  };
}

function cleanSafely(callback: () => void, reportError: (error: unknown) => void): void {
  try {
    callback();
  } catch (error) {
    try {
      reportError(error);
    } catch {
      // Diagnostics cannot interrupt resource cleanup.
    }
  }
}
