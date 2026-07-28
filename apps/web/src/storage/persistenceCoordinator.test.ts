import { createEmptySystem } from '@transitmapper/core/model/serialize';
import type { TransitSystem } from '@transitmapper/core/model/system';
import { describe, expect, it, vi } from 'vitest';
import {
  createPersistenceCoordinator,
  type PersistenceSnapshot,
  type PersistenceStore,
} from './persistenceCoordinator';

class FakeStore implements PersistenceStore {
  private snapshot: PersistenceSnapshot;
  private listeners = new Set<(next: PersistenceSnapshot, previous: PersistenceSnapshot) => void>();

  constructor(system: TransitSystem, readOnly = false) {
    this.snapshot = { system, readOnly };
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

function setup(
  saveOverride?: (system: TransitSystem) => Promise<'saved' | 'full' | 'unavailable'>,
) {
  const system = createEmptySystem();
  const store = new FakeStore(system);
  const timers = new Map<number, () => void>();
  let nextTimer = 0;
  let cameraListener: (() => void) | null = null;
  let pageHideListener: (() => void) | null = null;
  let hiddenListener: (() => void) | null = null;
  const save = vi.fn(saveOverride ?? (async (_system: TransitSystem) => 'saved' as const));
  const report = vi.fn();
  const coordinator = createPersistenceCoordinator({
    store,
    save,
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

    harness.store.replace({ system: edited, readOnly: false });
    harness.moveCamera();
    await harness.flushTimer();

    expect(harness.save).toHaveBeenCalledTimes(1);
    expect(harness.save.mock.calls[0]![0]).toMatchObject({
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
      readOnly: false,
    });

    harness.pageHide();
    await harness.coordinator.flush();

    expect(harness.save).toHaveBeenCalledTimes(1);
    expect(harness.save.mock.calls[0]![0].name).toBe('Last edit');
  });

  it('starts an IndexedDB save as soon as the page becomes hidden', async () => {
    const harness = setup();
    harness.store.replace({
      system: { ...harness.system, name: 'Hidden-tab edit' },
      readOnly: false,
    });

    harness.hidePage();
    await Promise.resolve();

    expect(harness.save).toHaveBeenCalledOnce();
    expect(harness.save.mock.calls[0]![0].name).toBe('Hidden-tab edit');
    await harness.coordinator.flush();
  });

  it('saves the previous document before a system switch can replace its snapshot', async () => {
    const harness = setup();
    const edited = { ...harness.system, name: 'Unsaved old document' };
    const next = createEmptySystem();
    harness.store.replace({ system: edited, readOnly: false });

    harness.store.replace({ system: next, readOnly: false });

    await harness.coordinator.flush();
    expect(harness.save).toHaveBeenCalledTimes(2);
    expect(harness.save.mock.calls[0]![0]).toMatchObject({
      id: harness.system.id,
      name: 'Unsaved old document',
    });
    expect(harness.save.mock.calls[1]![0].id).toBe(next.id);
  });

  it('flushes a pending editable snapshot when the coordinator detaches', async () => {
    const harness = setup();
    harness.store.replace({
      system: { ...harness.system, name: 'Pending at detach' },
      readOnly: false,
    });

    harness.coordinator.detach();
    await harness.coordinator.flush();

    expect(harness.save).toHaveBeenCalledTimes(1);
    expect(harness.save.mock.calls[0]![0].name).toBe('Pending at detach');
  });

  it('never saves a read-only shared system', async () => {
    const harness = setup();
    harness.store.replace({
      system: { ...harness.system, name: 'Shared' },
      readOnly: true,
    });
    harness.moveCamera();
    await harness.flushTimer();

    expect(harness.save).not.toHaveBeenCalled();
  });

  it('coalesces snapshots queued behind an in-flight save to the latest edit', async () => {
    const releases: Array<(outcome: 'saved') => void> = [];
    const harness = setup(
      () =>
        new Promise<'saved'>((resolve) => {
          releases.push(resolve);
        }),
    );
    harness.store.replace({
      system: { ...harness.system, name: 'First' },
      readOnly: false,
    });
    harness.fireTimer();
    await Promise.resolve();
    expect(harness.save).toHaveBeenCalledTimes(1);

    harness.store.replace({
      system: { ...harness.system, name: 'Second' },
      readOnly: false,
    });
    harness.fireTimer();
    harness.store.replace({
      system: { ...harness.system, name: 'Third' },
      readOnly: false,
    });
    harness.fireTimer();
    expect(harness.save).toHaveBeenCalledTimes(1);

    releases.shift()?.('saved');
    await Promise.resolve();
    await Promise.resolve();
    expect(harness.save).toHaveBeenCalledTimes(2);
    expect(harness.save.mock.calls[1]![0].name).toBe('Third');

    releases.shift()?.('saved');
    await harness.coordinator.flush();
  });
});
