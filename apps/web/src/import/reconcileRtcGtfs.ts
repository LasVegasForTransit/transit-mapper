import type { TransitSystem } from '@transitmapper/core/model/system';
import type { ReconcileImportedSystemResult } from '../editor/store';
import type { GtfsReconcileEvent, GtfsReconcileRequest } from './gtfsReconcileProtocol';

const RECONCILE_TIMEOUT_MS = 60_000;

interface ReconcileWorker {
  onmessage: ((event: MessageEvent<GtfsReconcileEvent>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: GtfsReconcileRequest): void;
  terminate(): void;
}

export interface ReconcileRtcGtfsOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  workerFactory?: () => ReconcileWorker;
}

function defaultWorkerFactory(): ReconcileWorker {
  return new Worker(new URL('./gtfsReconcile.worker.ts', import.meta.url), {
    type: 'module',
    name: 'transitmapper-gtfs-reconcile',
  });
}

/** Reconcile imported corridors away from the main thread. The caller retains
 * the input object and must reject the returned snapshot if an edit replaced
 * it while the Worker was running. */
export function reconcileRtcGtfs(
  system: TransitSystem,
  serviceIds: string[],
  options: ReconcileRtcGtfsOptions = {},
): Promise<ReconcileImportedSystemResult> {
  if (options.signal?.aborted) {
    return Promise.reject(
      options.signal.reason instanceof Error
        ? options.signal.reason
        : new DOMException('GTFS reconciliation canceled.', 'AbortError'),
    );
  }
  const worker = (options.workerFactory ?? defaultWorkerFactory)();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (
      outcome: { ok: true; value: ReconcileImportedSystemResult } | { ok: false; error: Error },
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      worker.terminate();
      if (outcome.ok) resolve(outcome.value);
      else reject(outcome.error);
    };
    const onAbort = () =>
      finish({
        ok: false,
        error:
          options.signal?.reason instanceof Error
            ? options.signal.reason
            : new DOMException('GTFS reconciliation canceled.', 'AbortError'),
      });
    const timer = setTimeout(
      () =>
        finish({
          ok: false,
          error: new Error('GTFS reconciliation timed out.'),
        }),
      options.timeoutMs ?? RECONCILE_TIMEOUT_MS,
    );
    worker.onmessage = (event) => {
      if (event.data.kind === 'error') {
        finish({ ok: false, error: new Error(event.data.message) });
        return;
      }
      finish({
        ok: true,
        value: { system: event.data.system, reconciled: event.data.reconciled },
      });
    };
    worker.onerror = (event) =>
      finish({ ok: false, error: new Error(event.message || 'GTFS reconciliation failed.') });
    options.signal?.addEventListener('abort', onAbort, { once: true });
    worker.postMessage({ system, serviceIds });
  });
}
