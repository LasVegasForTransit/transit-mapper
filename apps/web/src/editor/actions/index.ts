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
 * Read-only mode is enforced here rather than inside each provider: every
 * action offered by any provider mutates the system, so one wrapper is both
 * shorter and impossible to forget when the next provider is written.
 */
export function createSelectionActions(store: SelectionActionStore): SelectionActionRegistry {
  const registry = createSelectionActionRegistry();
  const isTerminusMenu = (ctx: Parameters<ReturnType<typeof serviceActionProvider>>[0]) =>
    Boolean(ctx.serviceHit?.terminusSide);
  const whenEditable =
    (provider: ReturnType<typeof wayActionProvider>) => (ctx: Parameters<typeof provider>[0]) =>
      store.getState().readOnly ? [] : provider(ctx);

  registry.register(whenEditable(wayActionProvider(store)));
  registry.register(whenEditable(serviceActionProvider(store)));
  // Point-anchored cuts come before the whole-object merges: when a click has
  // a place, what it can do THERE is the more specific answer.
  registry.register((ctx) =>
    isTerminusMenu(ctx) ? [] : whenEditable(servicePointActionProvider(store))(ctx),
  );
  registry.register((ctx) =>
    isTerminusMenu(ctx) ? [] : whenEditable(wayPointActionProvider(store))(ctx),
  );
  registry.register((ctx) =>
    isTerminusMenu(ctx) ? [] : whenEditable(commonActionProvider(store))(ctx),
  );
  return registry;
}

export { blockedMergeNote } from './blockedNotes';
