export interface MapStyleRecoverySteps {
  registerIcons: () => void;
  ensureOverlay: () => boolean;
  restoreFeatureData: () => void;
  restoreGesturePreview: () => void;
  restoreHover: () => void;
  restoreHaloVisibility: () => void;
  restoreRouteFocus: () => void;
  restoreLandmarkVisibility: () => void;
  restoreDiagramVisibility: () => void;
  restoreSimulation: () => void;
  repaint: () => void;
}

/**
 * Restore every piece of app-owned map state after either a style diff or a
 * full rebuild. Keeping the sequence in one named path prevents the initial
 * load, diff, and fallback cases from recovering subtly different subsets.
 */
export function recoverMapStyleState(steps: MapStyleRecoverySteps): boolean {
  steps.registerIcons();
  if (!steps.ensureOverlay()) return false;
  steps.restoreFeatureData();
  steps.restoreGesturePreview();
  steps.restoreHover();
  steps.restoreHaloVisibility();
  steps.restoreRouteFocus();
  steps.restoreLandmarkVisibility();
  steps.restoreDiagramVisibility();
  steps.restoreSimulation();
  steps.repaint();
  return true;
}
