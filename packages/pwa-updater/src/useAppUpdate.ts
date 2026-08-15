import { useCallback, useEffect, useRef, useState } from 'react';
import { reloadAfterFlush } from './reloadAfterFlush';

// How often an already-registered tab checks for a new deploy. Workbox's own
// update check only fires on navigation/reload, which a long-lived app tab
// may not see for hours at a stretch — without a poll, an already-open tab
// would never learn a new version shipped until the user happened to reload
// it for some unrelated reason.
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

interface RegistrationLifecycleOptions {
  onControllerChange: (updateActivated: boolean) => void;
  onNeedRefresh: () => void;
  onOfflineReady: () => void;
  onServiceWorkerReady: () => void;
}

function attachRegistrationLifecycle(
  registration: ServiceWorkerRegistration,
  options: RegistrationLifecycleOptions,
): () => void {
  let stopWatchingWorker: () => void = () => undefined;
  let installedWorkerExists = registration.active !== null || registration.waiting !== null;
  let updatePending = registration.waiting !== null;
  let serviceWorkerReadyReported = false;
  const reportServiceWorkerReady = () => {
    if (serviceWorkerReadyReported) return;
    serviceWorkerReadyReported = true;
    options.onServiceWorkerReady();
  };
  let deferredUpdateCheck = false;
  const checkForUpdate = () => {
    deferredUpdateCheck = false;
    void registration.update().catch((error: unknown) => {
      console.error('[transitmapper] service worker update failed', error);
    });
  };
  const watchWorker = (worker: ServiceWorker | null) => {
    stopWatchingWorker();
    if (!worker) return;
    const isUpdate = installedWorkerExists;
    const onStateChange = () => {
      if (worker.state !== 'installed') return;
      stopWatchingWorker();
      installedWorkerExists = true;
      reportServiceWorkerReady();
      if (isUpdate) {
        updatePending = true;
        options.onNeedRefresh();
      } else options.onOfflineReady();
    };
    worker.addEventListener('statechange', onStateChange);
    stopWatchingWorker = () => worker.removeEventListener('statechange', onStateChange);
    onStateChange();
  };
  const onUpdateFound = () => watchWorker(registration.installing);
  const onControllerChange = () => options.onControllerChange(updatePending);
  const onVisibilityChange = () => {
    if (deferredUpdateCheck && document.visibilityState === 'visible') checkForUpdate();
  };
  registration.addEventListener('updatefound', onUpdateFound);
  navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
  document.addEventListener('visibilitychange', onVisibilityChange);
  if (registration.waiting) {
    updatePending = true;
    options.onNeedRefresh();
  }
  if (installedWorkerExists) reportServiceWorkerReady();
  watchWorker(registration.installing);
  const updateInterval = window.setInterval(() => {
    if (document.visibilityState === 'visible') checkForUpdate();
    else deferredUpdateCheck = true;
  }, UPDATE_CHECK_INTERVAL_MS);
  return () => {
    window.clearInterval(updateInterval);
    registration.removeEventListener('updatefound', onUpdateFound);
    navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    stopWatchingWorker();
  };
}

export interface AppUpdate {
  /** A new service worker is installed and waiting — show the reload banner. */
  needRefresh: boolean;
  /** The essential shell finished its first install — a one-time FYI, not a
   * claim that lazy tools or the remote basemap are cached. */
  offlineReady: boolean;
  /** Clears the offlineReady flag without reloading; nothing to act on. */
  dismissOfflineReady: () => void;
  /** Activates the waiting service worker and reloads onto the new build. */
  reload: () => Promise<void>;
}

export interface AppUpdateOptions {
  /** Public delivery surfaces opt out instead of downloading the editor's
   * offline graph without an editor session to benefit from it. */
  enabled?: boolean;
  /** Called when the generated worker finishes its first offline install. */
  onOfflineReady?: () => void;
  /** Called once whenever this page has an installed worker, including a
   * returning session whose worker was already active before navigation. */
  onServiceWorkerReady?: () => void;
}

/**
 * Wires up an app's service worker registration and update lifecycle. Call
 * exactly once, from the app's own root component — the consuming app owns
 * its VitePWA plugin config (registerType/manifest/precache scope), and
 * disables registration for public delivery surfaces that are not meant to
 * install the editor's service worker.
 *
 * @param flushPendingSave Awaited before reloading, so an update-triggered
 *   reload never drops a still-debounced asynchronous IndexedDB write.
 */
export function useAppUpdate(
  flushPendingSave: () => void | Promise<void>,
  options: AppUpdateOptions = {},
): AppUpdate {
  const registrationPromise = useRef<Promise<ServiceWorkerRegistration | null>>(
    Promise.resolve(null),
  );
  const registrationStarted = useRef(false);
  const reloadRequested = useRef(false);
  const controllerReloadStarted = useRef(false);
  const flushPendingSaveRef = useRef(flushPendingSave);
  const onOfflineReadyRef = useRef(options.onOfflineReady);
  const onServiceWorkerReadyRef = useRef(options.onServiceWorkerReady);
  const [needRefresh, setNeedRefresh] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  const enabled = options.enabled ?? true;
  flushPendingSaveRef.current = flushPendingSave;
  onOfflineReadyRef.current = options.onOfflineReady;
  onServiceWorkerReadyRef.current = options.onServiceWorkerReady;

  useEffect(() => {
    let cancelled = false;
    let detachRegistration: () => void = () => undefined;
    // The ref survives Strict Mode's synthetic effect replay. Registration is
    // post-commit, but its external side effect still occurs exactly once.
    if (enabled && 'serviceWorker' in navigator && !registrationStarted.current) {
      registrationStarted.current = true;
      registrationPromise.current = navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .catch((error: unknown) => {
          console.error('[transitmapper] service worker registration failed', error);
          return null;
        });
    }
    if (enabled && 'serviceWorker' in navigator) {
      void registrationPromise.current.then((registration) => {
        if (cancelled || !registration) return;
        detachRegistration = attachRegistrationLifecycle(registration, {
          onControllerChange: (updateActivated) => {
            if (!updateActivated || controllerReloadStarted.current) return;
            controllerReloadStarted.current = true;
            if (reloadRequested.current) {
              window.location.reload();
              return;
            }
            void reloadAfterFlush(flushPendingSaveRef.current, () =>
              window.location.reload(),
            ).catch((error: unknown) => {
              controllerReloadStarted.current = false;
              console.error('[transitmapper] service worker update reload failed', error);
            });
          },
          onNeedRefresh: () => setNeedRefresh(true),
          onOfflineReady: () => {
            setOfflineReady(true);
            onOfflineReadyRef.current?.();
          },
          onServiceWorkerReady: () => onServiceWorkerReadyRef.current?.(),
        });
      });
    }

    return () => {
      cancelled = true;
      detachRegistration();
    };
  }, [enabled]);

  // Stable across renders (useCallback with an empty dep array, closing only
  // over setOfflineReady itself — a useState setter, always stable) so a
  // caller can safely put these in its own effect dependency arrays.
  const dismissOfflineReady = useCallback(() => setOfflineReady(false), []);
  const reload = useCallback(() => {
    return reloadAfterFlush(flushPendingSaveRef.current, async () => {
      const registration = await registrationPromise.current;
      if (!registration?.waiting) {
        window.location.reload();
        return;
      }
      reloadRequested.current = true;
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    });
  }, []);

  return { needRefresh, offlineReady, dismissOfflineReady, reload };
}
