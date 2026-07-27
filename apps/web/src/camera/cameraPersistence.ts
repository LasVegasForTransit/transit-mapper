import type { EditorStore } from '../editor/store';
import { saveToLibrary } from '../storage/localStore';
import { subscribeLiveCamera, withLiveCamera } from './liveCamera';

// Camera moves are debounced the same way content autosave is (App.tsx), so a
// flick-pan writes localStorage once after it settles, not once per frame.
const CAMERA_SAVE_DEBOUNCE_MS = 500;

/**
 * Persist live camera moves to the active system's saved library entry WITHOUT
 * routing them through the reactive domain store.
 *
 * Since decoupling the camera (camera/liveCamera.ts), a pure pan/zoom no longer
 * mints a new `system` reference, so App.tsx's content autosave — which fires on
 * `s.system !== prev.system` — never runs for a camera move. This closes that
 * gap: it folds the live camera into the saved snapshot on a debounce, giving
 * the same "reload restores where I left off" behavior at zero per-frame render
 * cost. It does NOT bump the system's updatedAt (camera isn't content), so pure
 * camera moves never reorder the library list.
 */
export function attachCameraPersistence(store: EditorStore): () => void {
  let timer: number | undefined;
  const unsub = subscribeLiveCamera(() => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      const { system, readOnly } = store.getState();
      if (readOnly) return; // never autosave a read-only shared view
      saveToLibrary(withLiveCamera(system));
    }, CAMERA_SAVE_DEBOUNCE_MS);
  });
  return () => {
    window.clearTimeout(timer);
    unsub();
  };
}
