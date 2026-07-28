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

function setup() {
  const system = createEmptySystem();
  const store = new FakeStore(system);
  const timers = new Map<number, () => void>();
  let nextTimer = 0;
  let cameraListener: (() => void) | null = null;
  let pageHideListener: (() => void) | null = null;
  const save = vi.fn((_system: TransitSystem) => 'saved' as const);
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
    },
  });
  return {
    system,
    store,
    save,
    report,
    coordinator,
    flushTimer: () => {
      const pending = [...timers.values()];
      timers.clear();
      pending.at(-1)?.();
    },
    moveCamera: () => cameraListener?.(),
    pageHide: () => pageHideListener?.(),
  };
}

describe('persistence coordinator', () => {
  it('coalesces a content edit and camera movement into one serialization/write', () => {
    const harness = setup();
    const edited = { ...harness.system, name: 'Frequent network' };

    harness.store.replace({ system: edited, readOnly: false });
    harness.moveCamera();
    harness.flushTimer();

    expect(harness.save).toHaveBeenCalledTimes(1);
    expect(harness.save.mock.calls[0]![0]).toMatchObject({
      name: 'Frequent network',
      viewport: { center: [-115, 36], zoom: 12 },
    });
    expect(harness.report).toHaveBeenCalledWith('saved');
  });

  it('persists a camera-only change without mutating the editor store', () => {
    const harness = setup();

    harness.moveCamera();
    harness.flushTimer();

    expect(harness.save).toHaveBeenCalledTimes(1);
    expect(harness.store.getState().system).toBe(harness.system);
  });

  it('flushes pending work on pagehide before the debounce expires', () => {
    const harness = setup();
    harness.store.replace({
      system: { ...harness.system, name: 'Last edit' },
      readOnly: false,
    });

    harness.pageHide();

    expect(harness.save).toHaveBeenCalledTimes(1);
    expect(harness.save.mock.calls[0]![0].name).toBe('Last edit');
  });

  it('saves the previous document before a system switch can replace its snapshot', () => {
    const harness = setup();
    const edited = { ...harness.system, name: 'Unsaved old document' };
    const next = createEmptySystem();
    harness.store.replace({ system: edited, readOnly: false });

    harness.store.replace({ system: next, readOnly: false });

    expect(harness.save).toHaveBeenCalledTimes(1);
    expect(harness.save.mock.calls[0]![0]).toMatchObject({
      id: harness.system.id,
      name: 'Unsaved old document',
    });
    harness.flushTimer();
    expect(harness.save).toHaveBeenCalledTimes(2);
    expect(harness.save.mock.calls[1]![0].id).toBe(next.id);
  });

  it('flushes a pending editable snapshot when the coordinator detaches', () => {
    const harness = setup();
    harness.store.replace({
      system: { ...harness.system, name: 'Pending at detach' },
      readOnly: false,
    });

    harness.coordinator.detach();

    expect(harness.save).toHaveBeenCalledTimes(1);
    expect(harness.save.mock.calls[0]![0].name).toBe('Pending at detach');
  });

  it('never saves a read-only shared system', () => {
    const harness = setup();
    harness.store.replace({
      system: { ...harness.system, name: 'Shared' },
      readOnly: true,
    });
    harness.moveCamera();
    harness.flushTimer();

    expect(harness.save).not.toHaveBeenCalled();
  });
});
