// The registry's whole job is collecting providers and asking them, so these
// cases are about that contract rather than about any particular action.

import { describe, expect, it, vi } from 'vitest';
import { createSelectionActionRegistry, isExactly, refIds } from '../../src/model/selectionActions';
import type { ActionContext, SelectionAction } from '../../src/model/selectionActions';
import { aSystem } from '../support/fixtures.test';

const ctx: ActionContext = {
  system: aSystem(),
  refs: [
    { kind: 'way', id: 'w1' },
    { kind: 'way', id: 'w2' },
  ],
};

const anAction = (id: string): SelectionAction => ({ id, label: id, run: () => {} });

describe('the selection action registry', () => {
  it('returns actions in the order the providers were registered', () => {
    const registry = createSelectionActionRegistry();
    registry.register(() => [anAction('first')]);
    registry.register(() => [anAction('second')]);
    expect(registry.actionsFor(ctx).map((a) => a.id)).toEqual(['first', 'second']);
  });

  it('contributes nothing for a provider that offers nothing', () => {
    const registry = createSelectionActionRegistry();
    registry.register(() => []);
    expect(registry.actionsFor(ctx)).toEqual([]);
  });

  it('keeps the other providers when one throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const registry = createSelectionActionRegistry();
    registry.register(() => {
      throw new Error('bad predicate');
    });
    registry.register(() => [anAction('survivor')]);
    expect(registry.actionsFor(ctx).map((a) => a.id)).toEqual(['survivor']);
    warn.mockRestore();
  });

  it('runs the behaviour the provider attached, not one looked up by id', () => {
    const registry = createSelectionActionRegistry();
    const run = vi.fn();
    registry.register(() => [{ id: 'x', label: 'x', run }]);
    registry.actionsFor(ctx)[0].run();
    expect(run).toHaveBeenCalledOnce();
  });
});

describe('the helpers providers gate on', () => {
  it('lists the ids of one kind in selection order', () => {
    expect(refIds(ctx.refs, 'way')).toEqual(['w1', 'w2']);
    expect(refIds(ctx.refs, 'service')).toEqual([]);
  });

  it('matches a selection of exactly one kind and count', () => {
    expect(isExactly(ctx.refs, 'way', 2)).toBe(true);
    expect(isExactly(ctx.refs, 'way', 3)).toBe(false);
    expect(isExactly([...ctx.refs, { kind: 'service', id: 's' }], 'way', 2)).toBe(false);
  });
});
