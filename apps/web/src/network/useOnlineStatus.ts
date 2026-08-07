import { useSyncExternalStore } from 'react';

/**
 * Whether the browser currently believes it has a network.
 *
 * Read this to *explain* a failure that already happened. Never read it to
 * decide whether to try: `navigator.onLine === true` only means the machine is
 * attached to some network, which a captive portal, a dead uplink, and a VPN
 * still negotiating all satisfy. Disabling a control on a signal that
 * confidently lies invents a block out of nothing, and the request that would
 * have succeeded never gets made.
 *
 * The `false` direction is the trustworthy one, and it is the only direction
 * anything here acts on: a browser reporting no network is a better answer to
 * "why did that fail" than the exception text, which for a fetch with no route
 * is some variation on "Failed to fetch" that means nothing to a reader.
 *
 * `useSyncExternalStore` rather than a `useState`/`useEffect` pair on purpose.
 * The browser is the one source of truth here, so every caller subscribes to
 * it directly instead of holding a copy that can drift out of step with the
 * others — and there is no module-level state to go stale between them.
 */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

function getSnapshot(): boolean {
  return navigator.onLine;
}

/** Nothing server-renders this app, but the test renderer asks for it. Assume
 *  a network, matching the direction this hook is allowed to act on: never
 *  claim offline without evidence. */
function getServerSnapshot(): boolean {
  return true;
}
