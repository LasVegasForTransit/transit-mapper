import type { GeoJSONSource } from 'maplibre-gl';
import type { DocumentMapSession } from '@transitmapper/renderer/driver';
import {
  bankedLayerId,
  logicalBankedLayerIds,
  logicalRenderLayerId,
  SOURCE_BANK_IDS,
  SRC_ACTION_ANCHOR,
} from '@transitmapper/renderer/layers';
import { sourceUploadsForSystemChange } from '@transitmapper/renderer/projection';
import { attachInteractions } from '../map/interactions';
import { LAYER_SPECS } from '../map/layers/layerSpecs';
import { editorSourcesNeedSystemRefresh, planSelectionRenderUpdate } from '../map/editor-overlays';
import { DOCUMENT_VIEW_FILTER_IDS, initializeDocumentCamera } from './document-view-adapter';
import { clearArmedTerminusForViewChange } from '../map/viewEditorState';
import { createEditorMapGesture, type EditorMapGestureController } from './editor-map-gesture';
import {
  createEditorMapProjection,
  type EditorMapProjectionController,
} from './editor-map-projection';
import { focusEditorFootprint, syncRoutePreview, syncSelectionFocus } from './editor-map-view';
import {
  callEditorMapSafely,
  disposeEditorMapLifecycle,
  editorMapAttachmentIsActive,
  ownEditorMapCleanup,
  type EditorMapLifecycle,
} from './editor-map-lifecycle';
import { installEditorMapLayers } from './editor-map-layers';
import type { AttachEditorMapOptions, EditorMapAttachment } from './editor-map-attachment-types';

export type { AttachEditorMapOptions, EditorMapAttachment } from './editor-map-attachment-types';

const BANKED_LAYER_IDS = logicalBankedLayerIds(LAYER_SPECS);
interface EditorAttachmentState {
  disposed: boolean;
  directManipulationActive: boolean;
}
interface EditorAttachmentContext extends EditorMapLifecycle {
  readonly session: DocumentMapSession;
  readonly options: AttachEditorMapOptions;
  readonly signal: AbortSignal;
  readonly state: EditorAttachmentState;
  readonly projection: EditorMapProjectionController;
  readonly gesture: EditorMapGestureController;
}
function reportSafely(options: AttachEditorMapOptions, error: unknown): void {
  try {
    options.reportError(error);
  } catch {
    // Diagnostics cannot interrupt MapLibre or editor cleanup.
  }
}
function flushThemeSafely(options: AttachEditorMapOptions): void {
  try {
    Promise.resolve(options.flushTheme()).catch((error: unknown) => reportSafely(options, error));
  } catch (error) {
    reportSafely(options, error);
  }
}
function createEditorAttachmentGesture(
  session: DocumentMapSession,
  options: AttachEditorMapOptions,
  projection: EditorMapProjectionController,
): EditorMapGestureController {
  try {
    return createEditorMapGesture(session, {
      store: options.document.store,
      source: options.document.source,
      counts: options.projection.gestureCounts,
      recordSourceUpload: () => options.projection.recordSourceUpload(),
      flushTheme: () => flushThemeSafely(options),
      reportError: (error) => reportSafely(options, error),
    });
  } catch (error) {
    try {
      projection.dispose();
    } catch (disposeError) {
      reportSafely(options, disposeError);
    }
    throw error;
  }
}
export function attachEditorMap(
  session: DocumentMapSession,
  options: AttachEditorMapOptions,
  signal: AbortSignal,
): EditorMapAttachment {
  installEditorMapLayers(session.map, options.layers.catalog());
  const state = { disposed: false, directManipulationActive: false };
  const cleanup: Array<() => void> = [];
  const projection = createEditorMapProjection(session, {
    ...options.projection,
    store: options.document.store,
    viewStore: options.view.store,
    renderView: () => options.view.renderView(),
    reportError: (error) => reportSafely(options, error),
  });
  const gesture = createEditorAttachmentGesture(session, options, projection);
  const context = {
    session,
    options,
    signal,
    state,
    projection,
    gesture,
    cleanup,
    reportError: (error: unknown) => reportSafely(options, error),
  };
  const dispose = () => disposeEditorMapLifecycle(context);
  cleanup.push(
    () => projection.dispose(),
    () => gesture.dispose(),
  );
  if (editorMapAttachmentIsActive(context)) {
    try {
      attachEditorSubscriptions(context, dispose);
      if (editorMapAttachmentIsActive(context)) attachEditorInteractions(context);
      if (editorMapAttachmentIsActive(context)) attachEditorExtensions(context);
      if (editorMapAttachmentIsActive(context)) projection.schedule();
    } catch (error) {
      const shouldRethrow = !signal.aborted;
      dispose();
      if (shouldRethrow) throw error;
    }
  } else {
    dispose();
  }
  return createAttachmentApi(context, dispose);
}

function createAttachmentApi(
  context: EditorAttachmentContext,
  dispose: () => void,
): EditorMapAttachment {
  const { projection, gesture, state } = context;
  return {
    dispose,
    applySelection: (targets) => {
      if (!state.disposed) projection.applySelection(targets);
    },
    restoreAfterStyle: () => {
      if (!state.disposed) {
        installEditorMapLayers(context.session.map, context.options.layers.catalog());
        projection.restoreAfterStyle();
      }
    },
    restoreGesturePreview: () => {
      if (!state.disposed) gesture.restoreAfterStyle();
    },
    selectedSourceIds: () => (state.disposed ? [] : projection.selectedSourceIds()),
    isInteractionActive: () =>
      !state.disposed &&
      (gesture.isActive() || state.directManipulationActive || gesture.ownsPreview()),
    isGestureActive: () => !state.disposed && gesture.isActive(),
  };
}

function attachEditorSubscriptions(context: EditorAttachmentContext, dispose: () => void): void {
  const { session, options, signal, state, projection, gesture } = context;
  let previousView = options.view.store.getSnapshot();
  const onAbort = () => dispose();
  signal.addEventListener('abort', onAbort, { once: true });
  ownEditorMapCleanup(context, () => signal.removeEventListener('abort', onAbort));
  if (
    !ownEditorMapCleanup(
      context,
      session.subscribeAcceptedScene((event) => {
        if (state.disposed || signal.aborted) return;
        callEditorMapSafely(context, () => gesture.acceptedScene(event));
        callEditorMapSafely(context, () => projection.applySelection());
        callEditorMapSafely(context, () => projection.schedule());
      }),
    )
  )
    return;
  if (
    !ownEditorMapCleanup(
      context,
      options.view.store.subscribe(() => {
        if (state.disposed || signal.aborted) return;
        const currentView = options.view.store.getSnapshot();
        const representationChanged =
          currentView.representationId !== previousView.representationId;
        const editorFilterChanged =
          currentView.filters[DOCUMENT_VIEW_FILTER_IDS.modes] !==
            previousView.filters[DOCUMENT_VIEW_FILTER_IDS.modes] ||
          currentView.filters[DOCUMENT_VIEW_FILTER_IDS.wayTypes] !==
            previousView.filters[DOCUMENT_VIEW_FILTER_IDS.wayTypes];
        previousView = currentView;
        if (!representationChanged && !editorFilterChanged) return;
        if (representationChanged) clearArmedTerminusForViewChange(options.document.store);
        callEditorMapSafely(context, () => options.simulation.notify());
        projection.schedule();
      }),
    )
  )
    return;
  if (state.disposed || signal.aborted) return;
  attachEditorStoreSubscription(context);
}

function attachEditorStoreSubscription(context: EditorAttachmentContext): void {
  const { session, options, signal, state, projection, gesture } = context;
  let previous = options.document.store.getState();
  ownEditorMapCleanup(
    context,
    options.document.store.subscribe((current) => {
      if (state.disposed || signal.aborted) return;
      const prior = previous;
      previous = current;
      const selectionUpdate = planSelectionRenderUpdate(prior, current);
      const documentChanged = current.system.id !== prior.system.id;
      const changedSources =
        current.system === prior.system
          ? []
          : sourceUploadsForSystemChange(prior.system, current.system, {
              forceAll: documentChanged,
            });
      if (
        selectionUpdate.updateEditorSources ||
        selectionUpdate.updateServiceTermini ||
        editorSourcesNeedSystemRefresh(changedSources, documentChanged)
      ) {
        projection.schedule();
      }
      if (documentChanged) gesture.documentChanged();
      else if (current.system !== prior.system) gesture.systemChanged();
      syncRoutePreview(session, current, prior);
      if (documentChanged) {
        initializeDocumentCamera(options.view.store, current.system.viewport);
      }
      syncSelectionFocus(session, options.view, current, prior);
      const stoppedDrawing =
        (prior.activeWayId !== null || prior.routeDraft !== null) &&
        current.activeWayId === null &&
        current.routeDraft === null;
      if (stoppedDrawing) flushThemeSafely(options);
    }),
  );
}

function attachEditorInteractions(context: EditorAttachmentContext): void {
  const { session, options, state, gesture } = context;
  const empty = { type: 'FeatureCollection' as const, features: [] };
  ownEditorMapCleanup(
    context,
    attachInteractions(session.map, options.document.store, {
      tuning: options.interactions.tuning,
      resolveQueryLayerIds: (layerId) => session.renderer.physicalLayerIds(layerId),
      resolveEventLayerIds: (layerId) =>
        BANKED_LAYER_IDS.has(layerId)
          ? SOURCE_BANK_IDS.map((bank) => bankedLayerId(layerId, bank))
          : [layerId],
      logicalLayerId: logicalRenderLayerId,
      openShortcuts: () => options.interactions.openShortcuts(),
      toggleUi: () => options.interactions.toggleUi(),
      attachKeyboard: (context) => options.interactions.attachKeyboard(context),
      isDiagramMode: () => options.view.store.getSnapshot().representationId === 'diagram',
      isNetworkMode: () => options.view.store.getSnapshot().representationId === 'network',
      openContextMenu: (...args) => options.interactions.openContextMenu(...args),
      closeContextMenu: () => options.interactions.closeContextMenu(),
      setActionAnchor: (at) =>
        session.map.getSource<GeoJSONSource>(SRC_ACTION_ANCHOR)?.setData(
          at
            ? {
                type: 'FeatureCollection',
                features: [
                  { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: at } },
                ],
              }
            : empty,
        ),
      onDirectManipulationStart: () => {
        state.directManipulationActive = true;
        callEditorMapSafely(context, () => options.simulation.notify());
      },
      onDirectManipulationEnd: () => {
        state.directManipulationActive = false;
        callEditorMapSafely(context, () => options.simulation.notify());
        flushThemeSafely(options);
      },
      onEditGestureStart: (targets) => gesture.begin(targets),
      onEditGestureEnd: () => {
        if (state.disposed) gesture.cancel();
        else gesture.end();
      },
      onPointerIntent: (...args) => options.interactions.onPointerIntent(...args),
      isContextMenuOpen: () => options.interactions.isContextMenuOpen(),
      registerPointerIntentRefresh: (refresh) =>
        options.interactions.registerPointerIntentRefresh(refresh),
      openTerminusConnectionChoice: (choice) =>
        options.interactions.openTerminusConnectionChoice(choice),
      focusFootprint: (footprint) => focusEditorFootprint(session, options.view, footprint),
      isAttachmentActive: () => !state.disposed && !context.signal.aborted,
    }),
  );
}

function attachEditorExtensions(context: EditorAttachmentContext): void {
  const { session, options, state } = context;
  try {
    const attached = ownEditorMapCleanup(
      context,
      options.simulation.attach(
        session,
        options.document.store,
        () => state.directManipulationActive,
      ),
    );
    if (!attached) return;
  } catch (error) {
    reportSafely(options, error);
  }
  if (!editorMapAttachmentIsActive(context)) return;
  try {
    const attachment = options.instrumentation?.attach(session);
    if (attachment) ownEditorMapCleanup(context, () => attachment.dispose());
  } catch (error) {
    reportSafely(options, error);
  }
}
