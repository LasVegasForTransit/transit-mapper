export interface MapStyleRecoverySteps {
  registerIcons: () => void;
  /** Must be read before ensureOverlay creates replacements for missing
   * sources. A retained MapLibre source still owns its current GeoJSON. */
  hasRetainedRendererSources: () => boolean;
  ensureOverlay: () => boolean;
  restoreFeatureData: () => void;
  /** Selection, hover, halos, and route focus are one editor paint state. */
  restoreEditorFeatureState: () => void;
  restoreGesturePreview: () => void;
  restoreLandmarkVisibility: () => void;
  restoreDiagramVisibility: () => void;
  restoreSimulation: () => void;
  repaint: () => void;
}

export type MapStyleFeatureDataRecoveryResult =
  | 'retained-scene-healed'
  | 'retained-scene-heal-scheduled'
  | 'full-projection-scheduled'
  | 'source-recovery-requested';

export interface MapStyleFeatureDataRecoverySteps<T> {
  hasRetainedScene: () => boolean;
  setPending: (pending: boolean) => void;
  invalidateSourceState: () => void;
  healCurrentScene: () => T;
  /** Production MapLibre adapters use the cooperative retained-scene replay;
   * synchronous healing remains available to browser-free/static consumers. */
  scheduleRetainedSceneHeal?: () => void;
  recordFullUpload: (result: T) => void;
  replayEditorState: () => void;
  scheduleFullProjection: () => void;
  requestSourceRecovery: () => void;
}

export interface MapStyleFeatureDataRecovery<T> {
  restore(): MapStyleFeatureDataRecoveryResult;
  sourceRecoverySucceeded(result: T): void;
}

/** Replays the authoritative retained scene after MapLibre replaces source
 * objects. Projection is reserved for the initial empty controller; a failed
 * synchronous setData handoff stays pending for the existing source recovery
 * coordinator to retry. */
export function createMapStyleFeatureDataRecovery<T>(
  steps: MapStyleFeatureDataRecoverySteps<T>,
): MapStyleFeatureDataRecovery<T> {
  const accept = (result: T) => {
    steps.recordFullUpload(result);
    steps.replayEditorState();
    steps.setPending(false);
  };
  return {
    restore() {
      steps.setPending(true);
      if (!steps.hasRetainedScene()) {
        steps.scheduleFullProjection();
        return 'full-projection-scheduled';
      }
      if (steps.scheduleRetainedSceneHeal) {
        try {
          steps.scheduleRetainedSceneHeal();
          return 'retained-scene-heal-scheduled';
        } catch {
          // Early bootstrap callers can reach this seam before the frame
          // scheduler exists. The compatibility replay below is still exact.
        }
      }
      try {
        steps.invalidateSourceState();
        accept(steps.healCurrentScene());
        return 'retained-scene-healed';
      } catch {
        steps.requestSourceRecovery();
        return 'source-recovery-requested';
      }
    },
    sourceRecoverySucceeded: accept,
  };
}

/**
 * Restore every piece of app-owned map state after either a style diff or a
 * full rebuild. Keeping the sequence in one named path prevents the initial
 * load, diff, and fallback cases from recovering subtly different subsets.
 */
export function recoverMapStyleState(steps: MapStyleRecoverySteps): boolean {
  // `ensureOverlay` is intentionally after this read: newly created empty
  // sources exist, but do not contain the retained renderer scene.
  const rendererSourcesRetained = steps.hasRetainedRendererSources();
  steps.registerIcons();
  if (!steps.ensureOverlay()) return false;
  if (!rendererSourcesRetained) steps.restoreFeatureData();
  steps.restoreEditorFeatureState();
  steps.restoreGesturePreview();
  steps.restoreLandmarkVisibility();
  steps.restoreDiagramVisibility();
  steps.restoreSimulation();
  steps.repaint();
  return true;
}
