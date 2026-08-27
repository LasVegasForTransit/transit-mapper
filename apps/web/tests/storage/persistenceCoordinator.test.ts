import { createEmptySystem } from '@transitmapper/core/model/serialize';
import type { TransitSystem } from '@transitmapper/core/model/system';
import { describe, expect, it, vi } from 'vitest';
import {
  createPersistenceCoordinator,
  type PersistenceSnapshot,
  type PersistenceStore,
} from '../../src/storage/persistenceCoordinator';
import type { SaveOutcome } from '../../src/storage/localStore';
class FakeStore implements PersistenceStore {
  private snapshot: PersistenceSnapshot;
  private listeners = new Set<(next: PersistenceSnapshot, previous: PersistenceSnapshot) => void>();

  constructor(system: TransitSystem) {
    this.snapshot = { system };
  }

  getState(): PersistenceSnapshot {
    return this.snapshot;
  }

  subscribe(
    listener: (next: PersistenceSnapshot, previous: PersistenceSnapshot) => void,
  ): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  replace(snapshot: PersistenceSnapshot): void {
    const previous = this.snapshot;
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener(snapshot, previous);
  }
}

interface SetupOptions {
  save?: (system: TransitSystem) => Promise<'saved' | 'full' | 'unavailable'>;
  emergencySave?: (system: TransitSystem) => 'saved' | 'full' | 'unavailable';
}

function setup(options: SetupOptions = {}) {
  const system = createEmptySystem();
  const store = new FakeStore(system);
  const timers = new Map<number, () => void>();
  let nextTimer = 0;
  let cameraListener: (() => void) | null = null;
  let pageHideListener: (() => void) | null = null;
  let hiddenListener: (() => void) | null = null;
  const save = vi.fn(options.save ?? (async (_system: TransitSystem) => 'saved' as const));
  const emergencySave = vi.fn(
    options.emergencySave ?? ((_system: TransitSystem) => 'saved' as const),
  );
  const report = vi.fn();
  const coordinator = createPersistenceCoordinator({
    store,
    save,
    emergencySave,
    report,
    setActiveId: vi.fn(),
    withLiveCamera: (value) => ({
      ...value,
      viewport: { center: [-115, 36], zoom: 12 },
    }),
    subscribeCamera: (listener) => {
      cameraListener = listener;
      return () => {
        cameraListener = null;
      };
    },
    scheduler: {
      schedule: (callback) => {
        const id = ++nextTimer;
        timers.set(id, callback);
        return id;
      },
      cancel: (id) => timers.delete(id),
      subscribePageHide: (listener) => {
        pageHideListener = listener;
        return () => {
          pageHideListener = null;
        };
      },
      subscribeHidden: (listener) => {
        hiddenListener = listener;
        return () => {
          hiddenListener = null;
        };
      },
    },
  });
  return {
    system,
    store,
    save,
    emergencySave,
    report,
    coordinator,
    fireTimer: () => {
      const pending = [...timers.values()];
      timers.clear();
      pending.at(-1)?.();
    },
    flushTimer: async () => {
      const pending = [...timers.values()];
      timers.clear();
      pending.at(-1)?.();
      await coordinator.flush();
    },
    moveCamera: () => cameraListener?.(),
    pageHide: () => pageHideListener?.(),
    hidePage: () => hiddenListener?.(),
  };
}

describe('persistence coordinator', () => {
  it('coalesces a content edit and camera movement into one serialization/write', async () => {
    const harness = setup();
    const edited = { ...harness.system, name: 'Frequent network' };

    harness.store.replace({ system: edited });
    harness.moveCamera();
    await harness.flushTimer();

    expect(harness.save).toHaveBeenCalledTimes(1);
    expect(harness.save.mock.calls.at(0)?.[0]).toMatchObject({
      name: 'Frequent network',
      viewport: { center: [-115, 36], zoom: 12 },
    });
    expect(harness.report).toHaveBeenCalledWith('saved');
  });

  it('persists a camera-only change without mutating the editor store', async () => {
    const harness = setup();

    harness.moveCamera();
    await harness.flushTimer();

    expect(harness.save).toHaveBeenCalledTimes(1);
    expect(harness.store.getState().system).toBe(harness.system);
  });

  it('flushes pending work on pagehide before the debounce expires', async () => {
    const harness = setup();
    harness.store.replace({
      system: { ...harness.system, name: 'Last edit' },
    });

    harness.pageHide();
    await harness.coordinator.flush();

    expect(harness.save).toHaveBeenCalledTimes(1);
    expect(harness.save.mock.calls[0][0].name).toBe('Last edit');
  });

  it('starts an IndexedDB save as soon as the page becomes hidden', async () => {
    const harness = setup();
    harness.store.replace({
      system: { ...harness.system, name: 'Hidden-tab edit' },
    });

    harness.hidePage();
    await Promise.resolve();

    expect(harness.save).toHaveBeenCalledOnce();
    expect(harness.save.mock.calls[0][0].name).toBe('Hidden-tab edit');
    await harness.coordinator.flush();
  });

  it('synchronously emergency-saves an immediate edit before lifecycle flush', async () => {
    const order: string[] = [];
    const harness = setup({
      save: async () => {
        order.push('async');
        return 'saved';
      },
      emergencySave: () => {
        order.push('emergency');
        return 'saved';
      },
    });
    harness.store.replace({
      system: { ...harness.system, name: 'Immediate close' },
    });

    harness.pageHide();

    expect(harness.emergencySave).toHaveBeenCalledOnce();
    expect(harness.emergencySave.mock.calls[0][0].name).toBe('Immediate close');
    expect(order[0]).toBe('emergency');
    await harness.coordinator.flush();
  });

  it('emergency-saves the latest snapshot while its async save is still in flight', async () => {
    let finishSave: ((outcome: 'saved') => void) | undefined;
    const harness = setup({
      save: () =>
        new Promise<'saved'>((resolve) => {
          finishSave = resolve;
        }),
    });
    harness.store.replace({
      system: { ...harness.system, name: 'In-flight close' },
    });
    harness.fireTimer();
    await Promise.resolve();

    harness.hidePage();

    expect(harness.emergencySave).toHaveBeenCalledOnce();
    expect(harness.emergencySave.mock.calls[0][0].name).toBe('In-flight close');
    finishSave?.('saved');
    await harness.coordinator.flush();
    harness.hidePage();
    expect(harness.emergencySave).toHaveBeenCalledOnce();
  });

  it('does not serialize the same emergency snapshot twice across lifecycle events', () => {
    const harness = setup();
    harness.store.replace({
      system: { ...harness.system, name: 'One emergency copy' },
    });

    harness.hidePage();
    harness.pageHide();

    expect(harness.emergencySave).toHaveBeenCalledOnce();
  });

  it('retries an unchanged emergency snapshot when its prior write failed', () => {
    const harness = setup({
      emergencySave: vi
        .fn<() => 'saved' | 'unavailable'>()
        .mockReturnValueOnce('unavailable')
        .mockReturnValueOnce('saved'),
    });
    harness.store.replace({
      system: { ...harness.system, name: 'Retry this recovery copy' },
    });

    harness.hidePage();
    harness.pageHide();

    expect(harness.emergencySave).toHaveBeenCalledTimes(2);
    expect(harness.report).toHaveBeenLastCalledWith('saved');
  });

  it('saves the previous document before a system switch can replace its snapshot', async () => {
    const harness = setup();
    const edited = { ...harness.system, name: 'Unsaved old document' };
    const next = createEmptySystem();
    harness.store.replace({ system: edited });

    harness.store.replace({ system: next });

    await harness.coordinator.flush();
    expect(harness.save).toHaveBeenCalledTimes(2);
    expect(harness.save.mock.calls[0][0]).toMatchObject({
      id: harness.system.id,
      name: 'Unsaved old document',
    });
    expect(harness.save.mock.calls[1][0].id).toBe(next.id);
  });

  it('emergency-saves every undurable document after switching systems', async () => {
    let finishFirst: ((outcome: 'saved') => void) | undefined;
    const harness = setup({
      save: (system) =>
        system.id === harness.system.id
          ? new Promise<'saved'>((resolve) => {
              finishFirst = resolve;
            })
          : Promise.resolve('saved'),
    });
    const edited = { ...harness.system, name: 'Unsaved first document' };
    const next = { ...createEmptySystem(), name: 'Unsaved second document' };
    harness.store.replace({ system: edited });
    harness.fireTimer();
    await Promise.resolve();
    harness.store.replace({ system: next });

    harness.hidePage();

    expect(harness.emergencySave.mock.calls.map(([system]) => system.id)).toEqual([
      harness.system.id,
      next.id,
    ]);
    finishFirst?.('saved');
    await harness.coordinator.flush();
  });

  it('retains a failed-document warning when another document later saves', async () => {
    const harness = setup({
      save: async (system) =>
        system.id === harness.system.id ? ('unavailable' as const) : ('saved' as const),
    });
    harness.store.replace({
      system: { ...harness.system, name: 'Failed first document' },
    });
    await harness.coordinator.flush();

    const next = { ...createEmptySystem(), name: 'Successfully saved document' };
    harness.store.replace({ system: next });
    await harness.coordinator.flush();

    expect(harness.report).toHaveBeenLastCalledWith('unavailable');
  });

  it('reconciles direct library outcomes against every failed document', () => {
    const harness = setup();
    const other = createEmptySystem();

    harness.coordinator.recordOutcome(harness.system.id, 'unavailable');
    harness.coordinator.recordOutcome(other.id, 'saved');

    expect(harness.report).toHaveBeenLastCalledWith('unavailable');

    harness.coordinator.recordOutcome(harness.system.id, 'saved');
    expect(harness.report).toHaveBeenLastCalledWith('saved');
  });

  it('forgets a deleted document so lifecycle retries cannot resurrect it', async () => {
    const harness = setup({
      save: async () => 'unavailable',
    });
    harness.store.replace({
      system: { ...harness.system, name: 'Deleted after failed autosave' },
    });
    await harness.coordinator.flush();
    expect(harness.report).toHaveBeenLastCalledWith('unavailable');

    harness.coordinator.discard(harness.system.id);
    harness.hidePage();

    expect(harness.emergencySave).not.toHaveBeenCalled();
    expect(harness.report).toHaveBeenLastCalledWith('saved');
  });

  it('flushes a pending editable snapshot when the coordinator detaches', async () => {
    const harness = setup();
    harness.store.replace({
      system: { ...harness.system, name: 'Pending at detach' },
    });

    harness.coordinator.detach();
    await harness.coordinator.flush();

    expect(harness.save).toHaveBeenCalledTimes(1);
    expect(harness.save.mock.calls[0][0].name).toBe('Pending at detach');
  });

  it('coalesces snapshots queued behind an in-flight save to the latest edit', async () => {
    const releases: Array<(outcome: 'saved') => void> = [];
    const harness = setup({
      save: () =>
        new Promise<'saved'>((resolve) => {
          releases.push(resolve);
        }),
    });
    harness.store.replace({
      system: { ...harness.system, name: 'First' },
    });
    harness.fireTimer();
    await Promise.resolve();
    expect(harness.save).toHaveBeenCalledTimes(1);

    harness.store.replace({
      system: { ...harness.system, name: 'Second' },
    });
    harness.fireTimer();
    harness.store.replace({
      system: { ...harness.system, name: 'Third' },
    });
    harness.fireTimer();
    expect(harness.save).toHaveBeenCalledTimes(1);

    releases.shift()?.('saved');
    await Promise.resolve();
    await Promise.resolve();
    expect(harness.save).toHaveBeenCalledTimes(2);
    expect(harness.save.mock.calls[1][0].name).toBe('Third');

    releases.shift()?.('saved');
    await harness.coordinator.flush();
  });

  it('does not strand a snapshot queued between drain completion and cleanup', async () => {
    let finishFirst: ((outcome: 'saved') => void) | undefined;
    const harness = setup({
      save: (system) =>
        system.name === 'First'
          ? new Promise<'saved'>((resolve) => {
              finishFirst = resolve;
            })
          : Promise.resolve('saved'),
    });
    harness.store.replace({
      system: { ...harness.system, name: 'First' },
    });
    harness.fireTimer();
    await Promise.resolve();

    let boundaryFlush: Promise<SaveOutcome> | undefined;
    finishFirst?.('saved');
    queueMicrotask(() => {
      harness.store.replace({
        system: { ...harness.system, name: 'Queued at boundary' },
      });
      boundaryFlush = harness.coordinator.flush();
    });
    await Promise.resolve();
    await Promise.resolve();
    await boundaryFlush;

    expect(harness.save).toHaveBeenCalledTimes(2);
    expect(harness.save.mock.calls[1][0].name).toBe('Queued at boundary');
  });
});
