import type { GeoJSONSource } from 'maplibre-gl';
import type { TransitSystem } from '@transitmapper/core/model/system';
import type { DocumentMapSceneAccepted, DocumentMapSession } from '@transitmapper/renderer/driver';
import { SRC_GESTURE } from '@transitmapper/renderer/layers';
import {
  createGestureProjectionController,
  type EditGestureTargets,
  type GestureProjectionController,
  type GestureProjectionResult,
  type ProjectionOperationCounts,
} from '../map/gestureProjection';
import { createGestureLayerMaskController } from '../map/gestureLayerMask';
import { createStopGesturePreviewController } from '../map/stopGesturePreview';
import type { EditorDocumentMapSource } from './document-map-source';
import type { EditorStore } from './store';

export interface EditorMapGestureOptions {
  readonly store: EditorStore;
  readonly source: EditorDocumentMapSource;
  readonly counts: ProjectionOperationCounts;
  recordSourceUpload(): void;
  flushTheme(): void;
  reportError(error: unknown): void;
}

export interface EditorMapGestureController {
  begin(targets: EditGestureTargets): void;
  end(): void;
  cancel(): void;
  documentChanged(): void;
  systemChanged(): void;
  acceptedScene(event: DocumentMapSceneAccepted): void;
  restoreAfterStyle(): void;
  isActive(): boolean;
  ownsPreview(): boolean;
  dispose(): void;
}

// eslint-disable-next-line max-lines-per-function -- One gesture generation owns one preview, hold, and accepted-scene state.
export function createEditorMapGesture(
  session: DocumentMapSession,
  options: EditorMapGestureOptions,
): EditorMapGestureController {
  const reportError = (error: unknown) => options.reportError(error);
  let active = false;
  let projection: GestureProjectionController | null = null;
  let previewVisible = false;
  let awaitingCommittedSystem: TransitSystem | null = null;
  let hold: ReturnType<EditorDocumentMapSource['hold']> | null = null;
  let disposed = false;
  const empty = { type: 'FeatureCollection' as const, features: [] };
  const mask = createGestureLayerMaskController(session.map, {
    resolveLayerIds: (layerId) => session.renderer.physicalLayerIds(layerId),
  });

  const clearPreview = () => {
    if (!previewVisible) return;
    session.map.getSource<GeoJSONSource>(SRC_GESTURE)?.setData(empty);
    options.recordSourceUpload();
    previewVisible = false;
  };
  const preview = createStopGesturePreviewController({
    render(candidate) {
      if (!candidate) {
        clearPreview();
        mask.restore();
        return true;
      }
      const source = session.map.getSource<GeoJSONSource>(SRC_GESTURE);
      if (!source) return false;
      if (candidate.data.features.length > 0) {
        source.setData(candidate.data);
        options.recordSourceUpload();
        previewVisible = true;
      } else {
        clearPreview();
      }
      mask.apply(candidate.affected);
      return true;
    },
  });
  const apply = (result: GestureProjectionResult) => {
    if (result.kind === 'abort') {
      preview.clear();
      return;
    }
    if (!preview.showActive(result.kind === 'preview' ? result.projection : null)) {
      preview.clear();
    }
  };
  const settlePreview = () => {
    cleanSafely(() => preview.clear(), reportError);
    cleanSafely(() => mask.restore(), reportError);
    cleanSafely(() => options.flushTheme(), reportError);
  };
  const finish = (outcome: 'commit' | 'cancel' | 'replace') => {
    if (!active) return;
    const result = projection?.finish() ?? { rebuild: false, hadPreview: false };
    active = false;
    projection = null;
    awaitingCommittedSystem =
      outcome === 'commit' && (result.rebuild || result.hadPreview)
        ? options.store.getState().system
        : null;
    const currentHold = hold;
    hold = null;
    cleanSafely(() => {
      if (outcome === 'commit' || outcome === 'replace') currentHold?.release();
      else currentHold?.cancel();
    }, reportError);
    if (!awaitingCommittedSystem) settlePreview();
    else cleanSafely(() => options.flushTheme(), reportError);
  };

  return {
    begin(targets) {
      if (disposed || active) return;
      hold?.cancel();
      hold = options.source.hold();
      active = true;
      awaitingCommittedSystem = null;
      const baseline = options.store.getState().system;
      projection = createGestureProjectionController(baseline, targets, options.counts);
      session.renderer.cancelProjectionAndRequeue();
      apply(projection.project(baseline));
    },
    end: () => finish('commit'),
    cancel: () => finish('cancel'),
    documentChanged() {
      if (active) {
        finish('replace');
        return;
      }
      if (!awaitingCommittedSystem) return;
      awaitingCommittedSystem = null;
      settlePreview();
    },
    systemChanged() {
      if (active && projection) apply(projection.project(options.store.getState().system));
      else if (awaitingCommittedSystem) {
        const current = options.store.getState().system;
        if (current.id === awaitingCommittedSystem.id) awaitingCommittedSystem = current;
      }
    },
    acceptedScene(event) {
      if (active) {
        mask.invalidate();
        preview.refresh();
      } else if (event.snapshot.system === awaitingCommittedSystem) {
        awaitingCommittedSystem = null;
        settlePreview();
      }
    },
    restoreAfterStyle() {
      if (disposed) return;
      mask.invalidate();
      preview.refresh();
    },
    isActive: () => !disposed && active,
    ownsPreview: () => !disposed && awaitingCommittedSystem !== null,
    dispose() {
      if (disposed) return;
      disposed = true;
      awaitingCommittedSystem = null;
      cleanSafely(() => hold?.cancel(), reportError);
      hold = null;
      cleanSafely(() => preview.clear(), reportError);
      cleanSafely(() => mask.restore(), reportError);
    },
  };
}

function cleanSafely(callback: () => void, reportError: (error: unknown) => void): void {
  try {
    callback();
  } catch (error) {
    try {
      reportError(error);
    } catch {
      // Diagnostics cannot interrupt gesture cleanup.
    }
  }
}
