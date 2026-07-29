import { describe, expect, it } from 'vitest';
import {
  createPerfListenerIdentity,
  groupListenerInventory,
  listenerDeltas,
  type PerfListenerIdentity,
} from '../../src/perf/listenerInventory';

const clickListener: PerfListenerIdentity = {
  target: 'window',
  type: 'click',
  useCapture: false,
  passive: false,
  once: false,
  location: {
    scriptUrl: 'https://example.test/assets/main.js',
    lineNumber: 20,
    columnNumber: 4,
  },
};

describe('listener inventory diagnostics', () => {
  it('resolves a listener script id to its stable URL and keeps the backend target', () => {
    expect(
      createPerfListenerIdentity(
        'document',
        {
          type: 'mousemove',
          useCapture: true,
          passive: false,
          once: false,
          backendNodeId: 42,
          scriptId: '17',
          lineNumber: 20,
          columnNumber: 4,
        },
        'https://example.test/assets/map-engine.js',
      ),
    ).toEqual({
      target: 'document',
      backendNodeId: 42,
      type: 'mousemove',
      useCapture: true,
      passive: false,
      once: false,
      location: {
        scriptUrl: 'https://example.test/assets/map-engine.js',
        lineNumber: 20,
        columnNumber: 4,
      },
    });
  });

  it('groups equal listener identities without losing their multiplicity', () => {
    expect(groupListenerInventory([clickListener, clickListener])).toEqual([
      { ...clickListener, count: 2 },
    ]);
  });

  it('keeps listener flags and queried targets as distinct identities', () => {
    const variants: PerfListenerIdentity[] = [
      clickListener,
      { ...clickListener, target: 'document' },
      { ...clickListener, useCapture: true },
      { ...clickListener, passive: true },
      { ...clickListener, once: true },
    ];

    expect(groupListenerInventory(variants)).toHaveLength(5);
  });

  it('uses a stable script URL instead of a volatile script id', () => {
    const first: PerfListenerIdentity = {
      ...clickListener,
      location: {
        ...clickListener.location!,
        scriptId: '17',
      },
    };
    const second: PerfListenerIdentity = {
      ...clickListener,
      location: {
        ...clickListener.location!,
        scriptId: '29',
      },
    };

    expect(groupListenerInventory([first, second])).toEqual([
      {
        ...clickListener,
        count: 2,
      },
    ]);
  });

  it('falls back to script id when a listener has no script URL', () => {
    const first: PerfListenerIdentity = {
      ...clickListener,
      location: {
        scriptId: '17',
        lineNumber: 20,
        columnNumber: 4,
      },
    };
    const second: PerfListenerIdentity = {
      ...first,
      location: {
        ...first.location!,
        scriptId: '29',
      },
    };

    expect(groupListenerInventory([first, second])).toHaveLength(2);
  });

  it('reports signed multiplicity changes for added and removed listeners', () => {
    const keyListener: PerfListenerIdentity = {
      ...clickListener,
      target: 'document',
      type: 'keydown',
      useCapture: true,
    };

    expect(
      listenerDeltas(
        groupListenerInventory([clickListener, keyListener]),
        groupListenerInventory([clickListener, clickListener]),
      ),
    ).toEqual([
      {
        ...keyListener,
        initialCount: 1,
        finalCount: 0,
        delta: -1,
      },
      {
        ...clickListener,
        initialCount: 1,
        finalCount: 2,
        delta: 1,
      },
    ]);
  });

  it('sorts groups deterministically across input order', () => {
    const keyListener: PerfListenerIdentity = {
      ...clickListener,
      target: 'document',
      type: 'keydown',
      useCapture: true,
    };

    expect(groupListenerInventory([clickListener, keyListener])).toEqual(
      groupListenerInventory([keyListener, clickListener]),
    );
  });
});
