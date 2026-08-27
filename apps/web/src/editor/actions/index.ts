// Composition root for selection actions: this is the one place that knows
// which providers exist and in what order they offer.
//
// Registration order is menu order, so the merges come before the delete
// rather than by accident of import order.

import {
  createSelectionActionRegistry,
  type SelectionActionRegistry,
} from '@transitmapper/core/model/selectionActions';
import type { SelectionActionStore } from './action-store';
import { commonActionProvider } from './commonActions';
import { servicePointActionProvider, wayPointActionProvider } from './pointActions';
import { serviceActionProvider } from './serviceActions';
import { wayActionProvider } from './wayActions';

/**
 * Build the registry for one editor store.
 *
 * Every provider is editor-only. Read-only readers use their own selection
 * controller and never construct this registry.
 */
export function createSelectionActions(store: SelectionActionStore): SelectionActionRegistry {
  const registry = createSelectionActionRegistry();
  const isTerminusMenu = (ctx: Parameters<ReturnType<typeof serviceActionProvider>>[0]) =>
    Boolean(ctx.serviceHit?.terminusSide);
  const wayActions = wayActionProvider(store);
  const serviceActions = serviceActionProvider(store);
  const servicePointActions = servicePointActionProvider(store);
  const wayPointActions = wayPointActionProvider(store);
  const commonActions = commonActionProvider(store);

  registry.register(wayActions);
  registry.register(serviceActions);
  // Point-anchored cuts come before the whole-object merges: when a click has
  // a place, what it can do THERE is the more specific answer.
  registry.register((ctx) => (isTerminusMenu(ctx) ? [] : servicePointActions(ctx)));
  registry.register((ctx) => (isTerminusMenu(ctx) ? [] : wayPointActions(ctx)));
  registry.register((ctx) => (isTerminusMenu(ctx) ? [] : commonActions(ctx)));
  return registry;
}

export { blockedMergeNote } from './blockedNotes';
