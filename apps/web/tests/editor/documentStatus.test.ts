import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
import { createEditorStore } from '../../src/editor/store';

/** The editor holds an empty placeholder system while it looks for the saved
 *  one. Anything drawn onto that placeholder would be destroyed the moment the
 *  saved document arrives, so the store refuses it — but only the content, and
 *  only for as long as the wait lasts. */

beforeEach(() => {
  // The guard warns on every refusal so a swallowed edit is visible in
  // development. The cases below refuse on purpose.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('a store still waiting for its document', () => {
  it('refuses to add a way', () => {
    const store = createEditorStore({ documentStatus: 'loading' });

    store.commands.ways.beginWay('road', 'straight');

    expect(store.getState().system.ways).toHaveLength(0);
  });

  it('refuses the whole change, not just the part touching the document', () => {
    // beginWay sets `activeWayId` alongside `system`. Letting that half through
    // would leave the store pointing at a way that was never created, which is
    // a worse state than the edit not happening.
    const store = createEditorStore({ documentStatus: 'loading' });

    store.commands.ways.beginWay('road', 'straight');

    expect(store.getState().activeWayId).toBeNull();
  });

  it('still changes everything that is not the document', () => {
    const store = createEditorStore({ documentStatus: 'loading' });

    store.commands.tools.setTool('way');
    store.commands.tools.setSelectVariant('erase');

    expect(store.getState().tool).toBe('way');
    expect(store.getState().selectVariant).toBe('erase');
    expect(store.getState().documentStatus).toBe('loading');
  });

  it('says so rather than dropping the edit in silence', () => {
    const store = createEditorStore({ documentStatus: 'loading' });

    store.commands.ways.beginWay('road', 'straight');

    expect(console.warn).toHaveBeenCalled();
  });
});

describe('the document arriving', () => {
  it('ends the wait and takes the edits it was holding off', () => {
    const store = createEditorStore({ documentStatus: 'loading' });
    const saved = createEmptySystem();

    store.commands.document.setSystem(saved);
    expect(store.getState().documentStatus).toBe('ready');

    store.commands.ways.beginWay('road', 'straight');
    expect(store.getState().system.ways).toHaveLength(1);
  });

  it('ends the wait when someone asks for a blank system instead', () => {
    // The escape hatch offered when storage is unavailable. Refusing the very
    // document the user just asked for would be the guard eating its own tail.
    const store = createEditorStore({ documentStatus: 'loading' });

    store.commands.document.newSystem();

    expect(store.getState().documentStatus).toBe('ready');
    store.commands.ways.beginWay('road', 'straight');
    expect(store.getState().system.ways).toHaveLength(1);
  });

  it('reports which document is on screen, so a late arrival can be spotted', () => {
    // App relies on this to tell "bootstrap finished first" from "the user got
    // ahead of it", and to avoid replacing a document someone is already using.
    const store = createEditorStore({ documentStatus: 'loading' });

    store.commands.document.newSystem();
    const chosen = store.getState().system.id;
    expect(store.getState().documentStatus).toBe('ready');
    expect(store.getState().system.id).toBe(chosen);
  });
});

describe('a store given its document directly', () => {
  it('waits for nothing by default', () => {
    // Every test, fixture and read-only preview map takes this path: there is
    // no storage to look in, so there is nothing to wait for.
    const store = createEditorStore();

    expect(store.getState().documentStatus).toBe('ready');
    store.commands.ways.beginWay('road', 'straight');
    expect(store.getState().system.ways).toHaveLength(1);
  });
});
