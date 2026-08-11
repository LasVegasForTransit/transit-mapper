import { createEmptySystem } from '@transitmapper/core/model/serialize';
import { describe, expect, it } from 'vitest';
import { loadSystemPreviews, type SystemPreview } from '../../src/ui/system-previews';
import type { LibraryLoadResult } from '../../src/storage/browserLibrary';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe('saved-system previews', () => {
  it('renders ready systems and reports damaged systems without rejecting', async () => {
    const system = createEmptySystem();
    const previews = new Map<string, SystemPreview>();

    await loadSystemPreviews({
      ids: ['ready', 'damaged'],
      load: (id) =>
        Promise.resolve(
          id === 'ready' ? { status: 'ok', system: { ...system, id } } : { status: 'corrupt' },
        ),
      render: () => '<svg>network</svg>',
      onPreview: (id, preview) => previews.set(id, preview),
    });

    expect(previews.get('ready')).toEqual({
      status: 'ready',
      svg: '<svg>network</svg>',
    });
    expect(previews.get('damaged')).toEqual({ status: 'unavailable' });
  });

  it('limits document loading to three concurrent previews', async () => {
    const system = createEmptySystem();
    const pending = new Map<string, Deferred<LibraryLoadResult>>();
    const started: string[] = [];
    const operation = loadSystemPreviews({
      ids: ['one', 'two', 'three', 'four'],
      load: (id) => {
        started.push(id);
        const load = deferred<LibraryLoadResult>();
        pending.set(id, load);
        return load.promise;
      },
      render: () => '<svg />',
      onPreview: () => undefined,
    });
    await Promise.resolve();

    expect(started).toEqual(['one', 'two', 'three']);

    pending.get('one')?.resolve({ status: 'ok', system });
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual(['one', 'two', 'three', 'four']);

    for (const id of ['two', 'three', 'four']) {
      pending.get(id)?.resolve({ status: 'ok', system });
    }
    await operation;
  });

  it('turns load and render failures into unavailable previews', async () => {
    const system = createEmptySystem();
    const previews = new Map<string, SystemPreview>();

    await loadSystemPreviews({
      ids: ['load-failure', 'render-failure'],
      load: (id) =>
        id === 'load-failure'
          ? Promise.reject(new Error('read failed'))
          : Promise.resolve({ status: 'ok', system }),
      render: () => {
        throw new Error('render failed');
      },
      onPreview: (id, preview) => previews.set(id, preview),
    });

    expect(previews).toEqual(
      new Map([
        ['load-failure', { status: 'unavailable' }],
        ['render-failure', { status: 'unavailable' }],
      ]),
    );
  });

  it('waits for previews rendered away from the input thread', async () => {
    const system = createEmptySystem();
    const previews = new Map<string, SystemPreview>();

    await loadSystemPreviews({
      ids: ['saved-system'],
      load: () => Promise.resolve({ status: 'ok', system }),
      render: () => Promise.resolve('<svg>worker preview</svg>'),
      onPreview: (id, preview) => previews.set(id, preview),
    });

    expect(previews.get('saved-system')).toEqual({
      status: 'ready',
      svg: '<svg>worker preview</svg>',
    });
  });

  it('stops publishing previews after cancellation', async () => {
    const system = createEmptySystem();
    const load = deferred<LibraryLoadResult>();
    let cancelled = false;
    const previews = new Map<string, SystemPreview>();
    const operation = loadSystemPreviews({
      ids: ['saved-system'],
      load: () => load.promise,
      render: () => '<svg />',
      onPreview: (id, preview) => previews.set(id, preview),
      isCancelled: () => cancelled,
    });

    cancelled = true;
    load.resolve({ status: 'ok', system });
    await operation;

    expect(previews.size).toBe(0);
  });
});
