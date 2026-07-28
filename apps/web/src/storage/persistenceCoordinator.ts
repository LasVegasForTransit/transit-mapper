import type { TransitSystem } from '@transitmapper/core/model/system';
import type { EditorStore } from '../editor/store';
import { subscribeLiveCamera, withLiveCamera } from '../camera/liveCamera';
import { saveToLibrary, type SaveOutcome } from './browserLibrary';
import { saveEmergencyToLibrary, setActiveId } from './localStore';

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
  subscribeHidden(listener: () => void): () => void;
}

export interface PersistenceCoordinatorOptions {
  store: PersistenceStore;
  save: (system: TransitSystem) => Promise<SaveOutcome>;
  emergencySave: (system: TransitSystem) => SaveOutcome;
  report: (outcome: SaveOutcome) => void;
  setActiveId: (id: string) => void;
  withLiveCamera: (system: TransitSystem) => TransitSystem;
  subscribeCamera: (listener: () => void) => () => void;
  scheduler: PersistenceScheduler;
  debounceMs?: number;
}

export interface PersistenceCoordinator {
  /** Force the one pending content/camera snapshot to disk now. */
  flush(): Promise<void>;
  /** Reconcile a library write performed outside the autosave lane. */
  recordOutcome(id: string, outcome: SaveOutcome): void;
  /** Forget a successfully deleted document after its pending save is flushed. */
  discard(id: string): void;
  detach(): void;
}

const browserScheduler: PersistenceScheduler = {
  schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
  cancel: (id) => window.clearTimeout(id),
  subscribePageHide: (listener) => {
    window.addEventListener('pagehide', listener);
    return () => window.removeEventListener('pagehide', listener);
  },
  subscribeHidden: (listener) => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') listener();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
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
  const undurableSystems = new Map<string, TransitSystem>();
  const lastEmergencySystems = new Map<string, TransitSystem>();
  const failedOutcomes = new Map<string, Exclude<SaveOutcome, 'saved'>>();
  const saveQueue: TransitSystem[] = [];
  let drainPromise: Promise<void> | null = null;

  const cancelTimer = () => {
    if (timer === null) return;
    options.scheduler.cancel(timer);
    timer = null;
  };
  const reportEffectiveOutcome = (): void => {
    const effectiveOutcome = [...failedOutcomes.values()].includes('full')
      ? 'full'
      : failedOutcomes.size > 0
        ? 'unavailable'
        : 'saved';
    options.report(effectiveOutcome);
  };
  const recordOutcome = (id: string, outcome: SaveOutcome): void => {
    if (outcome === 'saved') {
      failedOutcomes.delete(id);
    } else failedOutcomes.set(id, outcome);
    reportEffectiveOutcome();
  };
  const drainSaves = async (): Promise<void> => {
    while (saveQueue.length > 0) {
      const system = saveQueue.shift()!;
      try {
        const outcome = await options.save(system);
        recordOutcome(system.id, outcome);
        if (outcome === 'saved' && undurableSystems.get(system.id) === system) {
          undurableSystems.delete(system.id);
          lastEmergencySystems.delete(system.id);
        }
      } catch {
        recordOutcome(system.id, 'unavailable');
      }
    }
  };
  const ensureDrain = (): Promise<void> | null => {
    if (drainPromise || saveQueue.length === 0) return drainPromise;
    const current = drainSaves();
    drainPromise = current;
    const settled = () => {
      if (drainPromise === current) drainPromise = null;
      // A snapshot can be enqueued after drainSaves observes an empty queue
      // but before this promise reaction runs. Restart here so that boundary
      // cannot strand the snapshot.
      if (saveQueue.length > 0) ensureDrain();
    };
    void current.then(settled, settled);
    return current;
  };
  const waitForIdle = async (): Promise<void> => {
    while (drainPromise || saveQueue.length > 0) {
      const current = ensureDrain() ?? drainPromise;
      if (current) await current;
    }
  };
  const enqueueSave = (system: TransitSystem): void => {
    const queued = saveQueue.at(-1);
    if (queued?.id === system.id) {
      // While one async write is in flight, repeated autosaves of the same
      // immutable document supersede one another. Preserve only the newest
      // queued snapshot so persistence never becomes a source of input lag.
      saveQueue[saveQueue.length - 1] = system;
    } else {
      saveQueue.push(system);
    }
    ensureDrain();
  };
  const flush = (): Promise<void> => {
    cancelTimer();
    const system = pendingSystem;
    pendingSystem = null;
    if (system) {
      // IndexedDB and Worker serialization are asynchronous. Preserve
      // captured document order while coalescing redundant same-document
      // snapshots queued behind the write already in progress.
      enqueueSave(system);
    }
    return waitForIdle();
  };
  const queue = (system: TransitSystem) => {
    // Capture the camera while this document is still current. A system
    // switch can reinitialize the global live-camera holder before a delayed
    // flush runs; reading it then would save the new document's viewport
    // onto the old document.
    pendingSystem = options.withLiveCamera(system);
    undurableSystems.set(pendingSystem.id, pendingSystem);
    cancelTimer();
    timer = options.scheduler.schedule(() => {
      void flush();
    }, options.debounceMs ?? SAVE_DEBOUNCE_MS);
  };

  const unsubscribeStore = options.store.subscribe((next, previous) => {
    if (next.readOnly) {
      // A local edit may be pending when the user opens a read-only share.
      // Save that editable snapshot before refusing future writes.
      void flush();
      return;
    }
    if (next.system === previous.system) return;
    if (next.system.id !== previous.system.id) {
      // Never let the new document overwrite the only pending slot before the
      // old document's last edit reaches disk.
      void flush();
      options.setActiveId(next.system.id);
    }
    queue(next.system);
  });
  const unsubscribeCamera = options.subscribeCamera(() => {
    const current = options.store.getState();
    if (!current.readOnly) queue(current.system);
  });
  const lifecycleFlush = () => {
    for (const [id, system] of undurableSystems) {
      if (lastEmergencySystems.get(id) === system) continue;
      // IndexedDB is asynchronous and browsers do not guarantee its
      // completion after a hard page termination. Keep the old synchronous
      // localStorage path as a close-time emergency copy for documents that
      // fit. RTC-scale documents can exceed localStorage quota; for those,
      // visibilitychange merely gives the required async IndexedDB write the
      // earliest platform-supported start.
      const outcome = options.emergencySave(system);
      if (outcome === 'saved') lastEmergencySystems.set(id, system);
      recordOutcome(id, outcome);
    }
    void flush();
  };
  const unsubscribePageHide = options.scheduler.subscribePageHide(lifecycleFlush);
  const unsubscribeHidden = options.scheduler.subscribeHidden(() => {
    // visibilitychange normally arrives before pagehide and gives an
    // asynchronous IndexedDB transaction more time to commit.
    lifecycleFlush();
  });

  return {
    flush,
    recordOutcome,
    discard: (id) => {
      if (pendingSystem?.id === id) {
        pendingSystem = null;
        cancelTimer();
      }
      for (let index = saveQueue.length - 1; index >= 0; index--) {
        if (saveQueue[index]?.id === id) saveQueue.splice(index, 1);
      }
      undurableSystems.delete(id);
      lastEmergencySystems.delete(id);
      failedOutcomes.delete(id);
      reportEffectiveOutcome();
    },
    detach: () => {
      void flush();
      unsubscribeStore();
      unsubscribeCamera();
      unsubscribePageHide();
      unsubscribeHidden();
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
    emergencySave: saveEmergencyToLibrary,
    report,
    setActiveId,
    withLiveCamera,
    subscribeCamera: subscribeLiveCamera,
    scheduler: browserScheduler,
  });
}
