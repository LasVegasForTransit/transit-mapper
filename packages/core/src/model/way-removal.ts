import { deleteSelection } from './selection-deletion';
import type { TransitSystem } from './system';

/** Removes one way through the shared cross-entity deletion transform. */
export function removeWayFromSystem(system: TransitSystem, wayId: string): TransitSystem {
  return deleteSelection(system, [{ kind: 'way', id: wayId }]);
}
