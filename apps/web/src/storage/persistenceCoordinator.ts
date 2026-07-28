import type { TransitSystem } from '@transitmapper/core/model/system';
import type { EditorStore } from '../editor/store';
import { subscribeLiveCamera, withLiveCamera } from '../camera/liveCamera';
import { saveToLibrary, setActiveId, type SaveOutcome } from './localStore';

const SAVE_DEBOUNCE_MS = 450;

export interface PersistenceSnapshot {
  system: TransitSystem;
  readOnly: boolean;
}

export interface PersistenceStore {
  getState(): PersistenceSnapshot;
  subscribe(
    listener: (next: PersistenceSnapshot, previous: PersistenceSnapshot) => void,
  ): () => void;
}

export interface PersistenceScheduler {
  schedule(callback: () => void, delayMs: number): number;
  cancel(id: number): void;
  subscribePageHide(listener: () => void): () => void;
}

export interface PersistenceCoordinatorOptions {
  store: PersistenceStore;
  save: (system: TransitSystem) => SaveOutcome;
  report: (outcome: SaveOutcome) => void;
  setActiveId: (id: string) => void;
  withLiveCamera: (system: TransitSystem) => TransitSystem;
  subscribeCamera: (listener: () => void) => () => void;
  scheduler: PersistenceScheduler;
  debounceMs?: number;
}

export interface PersistenceCoordinator {
  /** Force the one pending content/camera snapshot to disk now. */
  flush(): void;
  detach(): void;
}

const browserScheduler: PersistenceScheduler = {
  schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
  cancel: (id) => window.clearTimeout(id),
  subscribePageHide: (listener) => {
    window.addEventListener('pagehide', listener);
    return () => window.removeEventListener('pagehide', listener);
  },
};

/** One persistence lane for both content and presentation camera state. A
 * burst containing both produces one JSON serialization and one storage write,
 * and pagehide/update callers can flush that same pending snapshot. */
export function createPersistenceCoordinator(
  options: PersistenceCoordinatorOptions,
): PersistenceCoordinator {
  let timer: number | null = null;
  let pendingSystem: TransitSystem | null = null;

  const cancelTimer = () => {
    if (timer === null) return;
    options.scheduler.cancel(timer);
    timer = null;
  };
  const flush = () => {
    cancelTimer();
    const system = pendingSystem;
    pendingSystem = null;
    if (!system) return;
    options.report(options.save(system));
  };
  const queue = (system: TransitSystem) => {
    // Capture the camera while this document is still current. A system
    // switch can reinitialize the global live-camera holder before a delayed
    // flush runs; reading it then would save the new document's viewport
    // onto the old document.
    pendingSystem = options.withLiveCamera(system);
    cancelTimer();
    timer = options.scheduler.schedule(flush, options.debounceMs ?? SAVE_DEBOUNCE_MS);
  };

  const unsubscribeStore = options.store.subscribe((next, previous) => {
    if (next.readOnly) {
      // A local edit may be pending when the user opens a read-only share.
      // Save that editable snapshot before refusing future writes.
      flush();
      return;
    }
    if (next.system === previous.system) return;
    if (next.system.id !== previous.system.id) {
      // Never let the new document overwrite the only pending slot before the
      // old document's last edit reaches disk.
      flush();
      options.setActiveId(next.system.id);
    }
    queue(next.system);
  });
  const unsubscribeCamera = options.subscribeCamera(() => {
    const current = options.store.getState();
    if (!current.readOnly) queue(current.system);
  });
  const unsubscribePageHide = options.scheduler.subscribePageHide(flush);

  return {
    flush,
    detach: () => {
      flush();
      unsubscribeStore();
      unsubscribeCamera();
      unsubscribePageHide();
    },
  };
}

export function attachPersistenceCoordinator(
  store: EditorStore,
  report: (outcome: SaveOutcome) => void,
): PersistenceCoordinator {
  return createPersistenceCoordinator({
    store,
    save: saveToLibrary,
    report,
    setActiveId,
    withLiveCamera,
    subscribeCamera: subscribeLiveCamera,
    scheduler: browserScheduler,
  });
}
