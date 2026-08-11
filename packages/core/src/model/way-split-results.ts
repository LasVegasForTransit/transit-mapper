import type { TransitSystem } from './system';
import { splitWayAtIndex, splitWayAtPosition, type CreateWaySplitId } from './way-split-edits';

export interface WaySplitResult {
  system: TransitSystem;
  newWayId: string;
}

function trackedSplit(
  original: TransitSystem,
  operation: (createId: CreateWaySplitId) => TransitSystem,
  createId: CreateWaySplitId,
): WaySplitResult | null {
  const createdIds: string[] = [];
  const system = operation(() => {
    const id = createId();
    createdIds.push(id);
    return id;
  });
  return system !== original && createdIds.length > 0 ? { system, newWayId: createdIds[0] } : null;
}

/** Splits at an index and reports the otherwise-internal new way identity. */
export function splitWayAtIndexWithResult(
  system: TransitSystem,
  wayId: string,
  index: number,
  createId: CreateWaySplitId,
): WaySplitResult | null {
  return trackedSplit(system, (ids) => splitWayAtIndex(system, wayId, index, ids), createId);
}

/** Splits at a normalized position and reports the new way identity. */
export function splitWayAtPositionWithResult(
  system: TransitSystem,
  wayId: string,
  position: number,
  createId: CreateWaySplitId,
): WaySplitResult | null {
  return trackedSplit(system, (ids) => splitWayAtPosition(system, wayId, position, ids), createId);
}
