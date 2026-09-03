/**
 * The documents one projection worker holds between requests.
 *
 * A camera move changes no part of a TransitSystem, so re-sending it on every
 * frame buys nothing and costs a whole-document `structuredClone` on the main
 * thread. The worker instead keeps the last System it was sent for each slot,
 * and a request names that slot rather than repeating its contents.
 *
 * Retention is per worker realm, which is what makes it safe: the client owns
 * every worker it creates, and forgets what it believes a worker holds the
 * moment it replaces or disposes one.
 */
import type { TransitSystem } from '@transitmapper/core/model/system';
import type { ProjectionSystemCarriage } from './feature-projection-worker-protocol';

/** Authored and schematic geometry are not interchangeable. `computeDiagramSystem`
 * spreads the authored System, so both slots carry the same `id` and
 * `updatedAt` and only their slot says which is which. */
export type RetainedSystemSlot = 'system' | 'diagramSystem';

export interface RetainedProjectionSystems {
  /** Returns the System this request means, retaining it when the request
   * carried one. Callers must do this before their first `await`: two
   * projections can interleave in one worker, and each has to read the slot
   * as it stood when its own message arrived. */
  resolve(carriage: ProjectionSystemCarriage, slot: RetainedSystemSlot): TransitSystem;
}

export function createRetainedProjectionSystems(): RetainedProjectionSystems {
  const held = new Map<RetainedSystemSlot, TransitSystem>();
  return {
    resolve(carriage, slot) {
      if (carriage.kind === 'sent') {
        held.set(slot, carriage.system);
        return carriage.system;
      }
      const retained = held.get(slot);
      // The client knows exactly what it has sent to this worker, so reaching
      // here means its bookkeeping and this realm have diverged. Falling back
      // to an empty scene or to the other slot would paint geometry that looks
      // plausible and belongs to a different document.
      if (!retained) {
        throw new Error(`Feature projection Worker holds no retained ${slot}.`);
      }
      return retained;
    },
  };
}
