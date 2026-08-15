import { useEffect, useLayoutEffect, useState } from 'react';
import { serviceWorkerRegistrationEnabled } from '@transitmapper/pwa-updater/registration-policy';
import { useAppUpdate, type AppUpdate } from '@transitmapper/pwa-updater/useAppUpdate';
import type { OfflineReadiness } from '../pwa/adaptive-cache-contract';
import {
  SERVICE_WORKER_READY_MARK,
  SHELL_MOUNTED_MARK,
  SYSTEM_COMMITTED_MARK,
  markOnce,
} from './startup-marks';

export interface StartupLifecycle extends AppUpdate {
  offlineReadiness: OfflineReadiness;
}

function returningOrInstalled(): boolean {
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) return true;
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches
  );
}

function scheduleIdle(callback: () => void): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(callback, { timeout: 5_000 });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(callback, 1_000);
  return () => window.clearTimeout(handle);
}

/** Connects React's editor commit and PWA lifecycle to the canonical startup
 * timeline. Kept separate from startup-marks so the vanilla embed entry never
 * acquires React or service-worker registration through its observability code. */
export function useStartupLifecycle(
  documentReady: boolean,
  flushPendingSave: () => void | Promise<void>,
): StartupLifecycle {
  // Layout effects run after the shell commit but before passive bootstrap
  // work. That keeps storage and child-map activity from preceding the shell
  // boundary they depend on.
  useLayoutEffect(() => {
    markOnce(SHELL_MOUNTED_MARK);
    if (documentReady) markOnce(SYSTEM_COMMITTED_MARK);
  }, [documentReady]);

  const enabled =
    import.meta.env.PROD && serviceWorkerRegistrationEnabled(window.location.pathname);
  const [offlineReadiness, setOfflineReadiness] = useState<OfflineReadiness>('deferred');
  const update = useAppUpdate(flushPendingSave, {
    enabled,
    onOfflineReady: () => setOfflineReadiness('essential'),
    onServiceWorkerReady: () => markOnce(SERVICE_WORKER_READY_MARK),
  });

  useEffect(() => {
    if (!enabled || !returningOrInstalled()) return;
    let cancelled = false;
    setOfflineReadiness('adaptive-pending');
    const cancelIdle = scheduleIdle(() => {
      void import('../pwa/adaptive-cache')
        .then(({ cacheBrowserAdaptiveAssets }) => cacheBrowserAdaptiveAssets(true))
        .then((readiness) => {
          if (!cancelled) setOfflineReadiness(readiness);
        })
        .catch(() => {
          if (!cancelled) setOfflineReadiness('deferred');
        });
    });
    return () => {
      cancelled = true;
      cancelIdle();
    };
  }, [enabled]);

  return { ...update, offlineReadiness };
}
