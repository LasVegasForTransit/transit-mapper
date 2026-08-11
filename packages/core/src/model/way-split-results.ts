import type { TransitSystem } from './system';
import {
  splitWayAtIndexResult,
  splitWayAtPositionResult,
  type CreateWaySplitId,
} from './way-split-edits';

export interface WaySplitResult {
  system: TransitSystem;
  newWayId: string;
}

/** Splits at an index and reports the otherwise-internal new way identity. */
export function splitWayAtIndexWithResult(
  system: TransitSystem,
  wayId: string,
  index: number,
  createId: CreateWaySplitId,
): WaySplitResult | null {
  return splitWayAtIndexResult(system, wayId, index, createId);
}

/** Splits at a normalized position and reports the new way identity. */
export function splitWayAtPositionWithResult(
  system: TransitSystem,
  wayId: string,
  position: number,
  createId: CreateWaySplitId,
): WaySplitResult | null {
  return splitWayAtPositionResult(system, wayId, position, createId);
}
