/**
 * What a selection lets you DO, as opposed to what it lets you edit.
 *
 * The list is built from providers rather than a switch over action ids: a
 * provider inspects the selection and returns whatever it has to offer, each
 * offer carrying its own behaviour. Adding an action means registering one
 * more provider — no enum to extend, no dispatch table to keep in sync, and
 * no renderer to teach about the new case.
 *
 * This module owns the contract and nothing else. It knows nothing about
 * ways, services, or menus: how two objects relate lives in
 * selectionRelations.ts, and which operation answers a relationship lives in
 * the app's providers, which are the only place those two facts meet.
 */

import type { LngLat, TransitSystem } from './system';

/** One selected object. The store's MultiSelectItem is this type — it lives
 *  here because the registry takes a selection as input and core cannot
 *  import from the app. */
export interface SelectionRef {
  kind: 'way' | 'station' | 'facility' | 'service';
  id: string;
}

export interface ActionContext {
  system: TransitSystem;
  refs: SelectionRef[];
  /** Where on the map the gesture happened, when it had a place: the point a
   *  right-click landed on. Absent for the inspector, which is a panel and
   *  points at nothing.
   *
   *  This is what lets an action act on a POSITION rather than on a whole
   *  object — cutting a line where you clicked instead of only at a stop.
   *  Providers that need it simply return nothing when it is absent, which is
   *  why the inspector and the menu can share one registry without either
   *  knowing about the other. */
  at?: LngLat;
}

export interface SelectionAction {
  /** Stable across renders so a menu can key on it. Namespacing by provider
   *  ("way.joinEndToEnd") is convention, not something this module parses. */
  id: string;
  label: string;
  /** One clause of context under the label. */
  hint?: string;
  /** Actions sharing a group render together, separated by a rule from the
   *  next group, in the order the groups were first seen. */
  group?: string;
  run: () => void;
}

export type SelectionActionProvider = (ctx: ActionContext) => SelectionAction[];

export interface SelectionActionRegistry {
  register: (provider: SelectionActionProvider) => void;
  /** Every action on offer for this selection, in registration order.
   *  Actions that do not apply are absent rather than disabled — see the
   *  design note in docs/superpowers/specs. */
  actionsFor: (ctx: ActionContext) => SelectionAction[];
}

export function createSelectionActionRegistry(): SelectionActionRegistry {
  const providers: SelectionActionProvider[] = [];
  return {
    register: (provider) => {
      providers.push(provider);
    },
    actionsFor: (ctx) => {
      const actions: SelectionAction[] = [];
      for (const provider of providers) {
        // One provider asking a question its relationship code can't answer
        // must not empty the whole menu: the other providers' actions are
        // still correct, and a menu that vanishes reads as "right-click is
        // broken" rather than "one action failed".
        try {
          actions.push(...provider(ctx));
        } catch (err) {
          console.warn('selection action provider failed', err);
        }
      }
      return actions;
    },
  };
}

/** The ids of every selected object of one kind, in selection order. */
export function refIds(refs: SelectionRef[], kind: SelectionRef['kind']): string[] {
  return refs.filter((r) => r.kind === kind).map((r) => r.id);
}

/** True when the selection is exactly `count` objects, all of `kind` — the
 *  shape most providers gate on ("exactly two ways"). */
export function isExactly(
  refs: SelectionRef[],
  kind: SelectionRef['kind'],
  count: number,
): boolean {
  return refs.length === count && refs.every((r) => r.kind === kind);
}
