import { useCallback, useEffect, useRef } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";

// How often an already-registered tab checks for a new deploy. Workbox's own
// update check only fires on navigation/reload, which a long-lived app tab
// may not see for hours at a stretch — without a poll, an already-open tab
// would never learn a new version shipped until the user happened to reload
// it for some unrelated reason.
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

export interface AppUpdate {
  /** A new service worker is installed and waiting — show the reload banner. */
  needRefresh: boolean;
  /** The app is now cached and usable offline — a one-time FYI, not urgent. */
  offlineReady: boolean;
  /** Clears the offlineReady flag without reloading; nothing to act on. */
  dismissOfflineReady: () => void;
  /** Activates the waiting service worker and reloads onto the new build. */
  reload: () => void;
}

/**
 * Wires up an app's service worker registration and update lifecycle. Call
 * exactly once, from the app's own root component — the consuming app owns
 * its VitePWA plugin config (registerType/manifest/precache scope), and
 * should keep this out of any bundle entry (e.g. an embedded/iframed one)
 * that isn't meant to register a service worker of its own.
 *
 * @param flushPendingSave Called synchronously before reloading, so an
 *   update-triggered reload never drops a still-debounced autosave write.
 */
export function useAppUpdate(flushPendingSave: () => void): AppUpdate {
  const updateInterval = useRef<number | undefined>(undefined);

  const {
    needRefresh: [needRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swScriptUrl, registration) {
      if (!registration) return;
      updateInterval.current = window.setInterval(() => {
        // Skip a hidden tab's check — nothing productive can come of racing
        // a reload prompt against a tab nobody is looking at right now.
        if (document.visibilityState === "visible") void registration.update();
      }, UPDATE_CHECK_INTERVAL_MS);
    },
    onRegisterError(error) {
      console.error("[transitmapper] service worker registration failed", error);
    },
  });

  useEffect(() => () => window.clearInterval(updateInterval.current), []);

  // Stable across renders (useCallback with an empty dep array, closing only
  // over setOfflineReady itself — a useState setter, always stable) so a
  // caller can safely put these in its own effect dependency arrays.
  const dismissOfflineReady = useCallback(() => setOfflineReady(false), [setOfflineReady]);
  const reload = useCallback(() => {
    flushPendingSave();
    // The reload itself happens once the new worker reports "controlling"
    // (see vite-plugin-pwa's react client) — asynchronous and after
    // flushPendingSave has already landed, so there's no race to guard here.
    void updateServiceWorker();
  }, [flushPendingSave, updateServiceWorker]);

  return { needRefresh, offlineReady, dismissOfflineReady, reload };
}
