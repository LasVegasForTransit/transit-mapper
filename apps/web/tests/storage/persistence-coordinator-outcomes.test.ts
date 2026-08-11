import { createEmptySystem } from '@transitmapper/core/model/serialize';
import type { TransitSystem } from '@transitmapper/core/model/system';
import { describe, expect, it, vi } from 'vitest';
import type { SaveOutcome } from '../../src/storage/localStore';
import {
  createPersistenceCoordinator,
  type PersistenceSnapshot,
  type PersistenceStore,
} from '../../src/storage/persistenceCoordinator';

class OutcomeStore implements PersistenceStore {
  private snapshot: PersistenceSnapshot;
  private listeners = new Set<(next: PersistenceSnapshot, previous: PersistenceSnapshot) => void>();

  constructor(system: TransitSystem) {
    this.snapshot = { system, readOnly: false };
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

  edit(name: string): void {
    const previous = this.snapshot;
    this.snapshot = { ...previous, system: { ...previous.system, name } };
    for (const listener of this.listeners) listener(this.snapshot, previous);
  }
}

interface OutcomeHarness {
  coordinator: ReturnType<typeof createPersistenceCoordinator>;
  report: ReturnType<typeof vi.fn<(outcome: SaveOutcome) => void>>;
  store: OutcomeStore;
}

function setup(
  save: (system: TransitSystem) => Promise<SaveOutcome> = () => Promise.resolve('saved'),
): OutcomeHarness {
  const store = new OutcomeStore(createEmptySystem());
  const report = vi.fn<(outcome: SaveOutcome) => void>();
  const coordinator = createPersistenceCoordinator({
    store,
    save,
    emergencySave: () => 'saved',
    report,
    setActiveId: () => undefined,
    withLiveCamera: (system) => system,
    subscribeCamera: () => () => undefined,
    scheduler: {
      schedule: () => 1,
      cancel: () => undefined,
      subscribePageHide: () => () => undefined,
      subscribeHidden: () => () => undefined,
    },
  });
  return { coordinator, report, store };
}

describe('persistence flush outcomes', () => {
  it('reports the effective saved outcome after a successful flush', async () => {
    const harness = setup();
    harness.store.edit('Durable edit');

    await expect(harness.coordinator.flush()).resolves.toBe('saved');
  });

  it('reports the current system as undurable until a later save succeeds', async () => {
    const save = vi
      .fn<(system: TransitSystem) => Promise<SaveOutcome>>()
      .mockResolvedValueOnce('full')
      .mockResolvedValueOnce('saved');
    const harness = setup(save);
    harness.store.edit('First edit');
    await expect(harness.coordinator.flush()).resolves.toBe('full');

    harness.store.edit('Retry edit');
    await expect(harness.coordinator.flush()).resolves.toBe('saved');
  });

  it('does not apply another system failure to the current system flush', async () => {
    const harness = setup();
    harness.coordinator.recordOutcome('other-system', 'full');

    await expect(harness.coordinator.flush()).resolves.toBe('saved');
    expect(harness.report).toHaveBeenLastCalledWith('full');
  });
});
