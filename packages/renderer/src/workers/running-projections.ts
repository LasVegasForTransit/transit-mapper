/**
 * The projections one worker realm is currently running.
 *
 * Supersession used to be expressed by terminating the worker, because that
 * was the only way to reclaim the CPU of a projection already under way. It
 * also destroyed the realm's retained Systems and its described-content cache,
 * and a pan supersedes on every source mutation — so the caches those two
 * things buy were paid for on every frame and never used.
 *
 * A request id is the unit of cancellation because it is already the unit of
 * identity: the client's pending map and this registry key off the same
 * number, so neither half has to reason about the other's timing.
 */
export interface RunningProjections {
  /** Registers `requestId` and hands back the signal its work must honour. */
  begin(requestId: number): AbortSignal;
  /**
   * Asks the running projection to stop. An id nobody is running is ignored,
   * because a reply may already have left before the cancel arrived.
   */
  cancel(requestId: number): void;
  /**
   * Retires `requestId` and says whether its reply may still be sent.
   *
   * False for a cancelled request, and false for one nobody registered. Both
   * mean the host stopped waiting for this answer, and a cancelled projection
   * must never publish — so an unknown id resolves the same way rather than
   * guessing.
   */
  finish(requestId: number): boolean;
}

export function createRunningProjections(): RunningProjections {
  const running = new Map<number, AbortController>();
  return {
    begin(requestId) {
      const controller = new AbortController();
      running.set(requestId, controller);
      return controller.signal;
    },
    cancel(requestId) {
      // The entry keeps the controller until `finish`, so a cancel that
      // arrives while the projection is suspended still leaves a record for
      // `finish` to read. Deleting here would make a cancelled request
      // indistinguishable from a finished one.
      running.get(requestId)?.abort();
    },
    finish(requestId) {
      const controller = running.get(requestId);
      running.delete(requestId);
      return controller !== undefined && !controller.signal.aborted;
    },
  };
}
