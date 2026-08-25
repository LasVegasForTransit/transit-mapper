interface EditorMapLifecycleState {
  disposed: boolean;
}

export interface EditorMapLifecycle {
  readonly signal: AbortSignal;
  readonly state: EditorMapLifecycleState;
  readonly cleanup: Array<() => void>;
  reportError(error: unknown): void;
}

export function editorMapAttachmentIsActive(lifecycle: EditorMapLifecycle): boolean {
  return !lifecycle.state.disposed && !lifecycle.signal.aborted;
}

export function ownEditorMapCleanup(lifecycle: EditorMapLifecycle, release: () => void): boolean {
  if (editorMapAttachmentIsActive(lifecycle)) {
    lifecycle.cleanup.push(release);
    return true;
  }
  releaseEditorMapResource(lifecycle, release);
  return false;
}

export function disposeEditorMapLifecycle(lifecycle: EditorMapLifecycle): void {
  if (lifecycle.state.disposed) return;
  lifecycle.state.disposed = true;
  for (const release of lifecycle.cleanup.splice(0).reverse()) {
    releaseEditorMapResource(lifecycle, release);
  }
}

export function callEditorMapSafely(lifecycle: EditorMapLifecycle, callback: () => void): void {
  try {
    callback();
  } catch (error) {
    lifecycle.reportError(error);
  }
}

function releaseEditorMapResource(lifecycle: EditorMapLifecycle, release: () => void): void {
  try {
    release();
  } catch (error) {
    try {
      lifecycle.reportError(error);
    } catch {
      // Diagnostics cannot interrupt attachment cleanup.
    }
  }
}
