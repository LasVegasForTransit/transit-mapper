/**
 * Common lifecycle for requests sent to a dedicated CPU worker.
 *
 * A reply can arrive after the initiating UI action was superseded. Removing
 * its entry before resolving or rejecting is therefore the cancellation rule:
 * later replies are harmless, and disposal rejects every caller exactly once.
 */
export interface PendingWorkerRequest<Value> {
  readonly resolve: (value: Value) => void;
  readonly reject: (error: Error) => void;
  readonly removeAbortListener: () => void;
}

export function takePendingWorkerRequest<Value>(
  pending: Map<number, PendingWorkerRequest<Value>>,
  requestId: number,
): PendingWorkerRequest<Value> | undefined {
  const request = pending.get(requestId);
  if (!request) return undefined;
  pending.delete(requestId);
  request.removeAbortListener();
  return request;
}

export function rejectPendingWorkerRequest<Value>(
  pending: Map<number, PendingWorkerRequest<Value>>,
  requestId: number,
  error: Error,
): void {
  takePendingWorkerRequest(pending, requestId)?.reject(error);
}

export function rejectAllPendingWorkerRequests<Value>(
  pending: Map<number, PendingWorkerRequest<Value>>,
  error: Error,
): void {
  for (const requestId of pending.keys()) {
    rejectPendingWorkerRequest(pending, requestId, error);
  }
}
