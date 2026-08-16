/**
 * The frozen 497a549 artifact predates the shipping `tm:*` milestone
 * vocabulary. This observer runs before its modules without fetching or
 * changing application code, and translates only state the old artifact
 * already exposed. It exists solely to make that fixed artifact measurable by
 * the v3 byte ledger; current builds must use their own shipping marks.
 */

/**
 * Playwright serializes a function without the transform helpers that `tsx`
 * can attach to it. Keep this self-contained source as the browser-facing
 * form so the historical observer cannot fail before it marks the old app.
 */
export const LEGACY_497A549_FIRST_SESSION_INIT_SCRIPT = String.raw`
(() => {
  const pollIntervalMs = 25;
  const legacyWindow = window;
  let observer;
  let interval;
  let paintCandidateScheduled = false;

  function markOnce(name) {
    try {
      if (performance.getEntriesByName(name, 'mark').length === 0) performance.mark(name);
    } catch {
      // User Timing is observer-only evidence and must never affect the legacy app.
    }
  }

  function editorDocumentCommitted() {
    return document.querySelector('.app[data-document-status="ready"]') !== null;
  }

  function embedDocumentCommitted() {
    return document.getElementById('embed-status')?.hidden === true;
  }

  function mapCanvasReady() {
    const canvas = document.querySelector('.maplibregl-canvas');
    return canvas !== null && canvas.width > 0 && canvas.height > 0;
  }

  function stop() {
    if (observer) observer.disconnect();
    observer = undefined;
    if (interval !== undefined) clearInterval(interval);
    interval = undefined;
  }

  function observe() {
    const isEditor = document.querySelector('.app') !== null;
    const isEmbed = document.getElementById('map') !== null;
    if (isEditor || isEmbed) markOnce('tm:shell-mounted');
    if (!editorDocumentCommitted() && !embedDocumentCommitted()) return;
    markOnce('tm:system-committed');
    if (!mapCanvasReady() || paintCandidateScheduled) return;
    paintCandidateScheduled = true;
    requestAnimationFrame(function afterFirstFrame() {
      requestAnimationFrame(function afterSecondFrame() {
        paintCandidateScheduled = false;
        if (!mapCanvasReady()) return;
        markOnce('tm:first-system-paint');
        markOnce('tm:interactive');
        stop();
      });
    });
  }

  legacyWindow.__TRANSITMAPPER_PERF_RUN__ = true;
  markOnce('tm:bootstrap-start');
  observer = new MutationObserver(observe);
  observer.observe(document, { childList: true, subtree: true, attributes: true });
  interval = setInterval(observe, pollIntervalMs);
  observe();

  if ('serviceWorker' in navigator) {
    void navigator.serviceWorker.ready
      .then(function markServiceWorkerReady() {
        markOnce('tm:service-worker-ready');
      })
      .catch(function ignoreServiceWorkerFailure() {});
  }
})();
`;

/** Exercise the observer logic directly in unit tests. */
export function installLegacy497a549FirstSessionMarks(): void {
  // This function intentionally owns every helper it needs. Playwright
  // serializes the function body into an isolated init script, not its module
  // closure, so external references would silently make the frozen run unlike
  // the current observer contract.
  const pollIntervalMs = 25;
  const legacyWindow = window as Window & {
    __TRANSITMAPPER_PERF_RUN__?: boolean;
  };
  let observer: MutationObserver | undefined;
  let interval: ReturnType<typeof setInterval> | undefined;
  let paintCandidateScheduled = false;

  function markOnce(name: string): void {
    try {
      if (performance.getEntriesByName(name, 'mark').length === 0) performance.mark(name);
    } catch {
      // User Timing is observer-only evidence and must never affect the legacy app.
    }
  }

  function editorDocumentCommitted(): boolean {
    return document.querySelector('.app[data-document-status="ready"]') !== null;
  }

  function embedDocumentCommitted(): boolean {
    return document.getElementById('embed-status')?.hidden === true;
  }

  function mapCanvasReady(): boolean {
    const canvas = document.querySelector<HTMLCanvasElement>('.maplibregl-canvas');
    return canvas !== null && canvas.width > 0 && canvas.height > 0;
  }

  legacyWindow.__TRANSITMAPPER_PERF_RUN__ = true;
  markOnce('tm:bootstrap-start');

  function stop(): void {
    observer?.disconnect();
    observer = undefined;
    if (interval !== undefined) clearInterval(interval);
    interval = undefined;
  }

  function observe(): void {
    const isEditor = document.querySelector('.app') !== null;
    const isEmbed = document.getElementById('map') !== null;
    if (isEditor || isEmbed) markOnce('tm:shell-mounted');
    if (!editorDocumentCommitted() && !embedDocumentCommitted()) return;
    markOnce('tm:system-committed');
    if (!mapCanvasReady() || paintCandidateScheduled) return;
    paintCandidateScheduled = true;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        paintCandidateScheduled = false;
        if (!mapCanvasReady()) return;
        markOnce('tm:first-system-paint');
        markOnce('tm:interactive');
        stop();
      });
    });
  }

  observer = new MutationObserver(observe);
  // Playwright runs an init script before the parser has necessarily created
  // documentElement. The Document node already exists, so it observes both
  // that first insertion and every later legacy state transition.
  observer.observe(document, { childList: true, subtree: true, attributes: true });
  interval = setInterval(observe, pollIntervalMs);
  observe();

  if ('serviceWorker' in navigator) {
    void navigator.serviceWorker.ready
      .then(() => markOnce('tm:service-worker-ready'))
      .catch(() => undefined);
  }
}
