import { createEmptySystem } from '@transitmapper/core/model/serialize';
import type { TransitSystem } from '@transitmapper/core/model/system';
import { describe, expect, it, vi } from 'vitest';
import {
  createLibraryStore,
  type LibraryDatabase,
  type LegacyLibrary,
  type StoredSystemRecord,
} from './libraryStore';
import type { LibraryEntry, LoadResult, SaveOutcome } from './localStore';

class MemoryDatabase implements LibraryDatabase {
  readonly systems = new Map<string, StoredSystemRecord>();
  fail: SaveOutcome | null = null;

  async list(): Promise<LibraryEntry[]> {
    if (this.fail) throw storageError(this.fail);
    return [...this.systems.values()].map(({ id, name, updatedAt }) => ({
      id,
      name,
      updatedAt,
    }));
  }

  async load(id: string): Promise<StoredSystemRecord | null> {
    if (this.fail) throw storageError(this.fail);
    return this.systems.get(id) ?? null;
  }

  async save(record: StoredSystemRecord): Promise<void> {
    if (this.fail) throw storageError(this.fail);
    this.systems.set(record.id, record);
  }

  async delete(id: string): Promise<void> {
    if (this.fail) throw storageError(this.fail);
    this.systems.delete(id);
  }
}

class MemoryLegacyLibrary implements LegacyLibrary {
  readonly systems = new Map<string, TransitSystem | 'corrupt'>();
  legacySingleSlot: TransitSystem | null = null;
  fail: SaveOutcome | null = null;

  list(): LibraryEntry[] {
    return [...this.systems.entries()].map(([id, system]) => ({
      id,
      name: system === 'corrupt' ? 'Damaged system' : system.name,
      updatedAt: system === 'corrupt' ? 0 : system.updatedAt,
    }));
  }

  load(id: string): LoadResult {
    const system = this.systems.get(id);
    if (!system) return { status: 'missing' };
    if (system === 'corrupt') return { status: 'corrupt' };
    return { status: 'ok', system };
  }

  save(system: TransitSystem): SaveOutcome {
    if (this.fail) return this.fail;
    this.systems.set(system.id, system);
    return 'saved';
  }

  delete(id: string): SaveOutcome {
    if (this.fail) return this.fail;
    this.systems.delete(id);
    return 'saved';
  }

  loadLegacySingleSlot(): TransitSystem | null {
    return this.legacySingleSlot;
  }

  removeLegacySingleSlot(): void {
    this.legacySingleSlot = null;
  }
}

function storageError(outcome: SaveOutcome): Error {
  return new DOMException(
    outcome === 'full' ? 'Storage quota exceeded.' : 'Storage unavailable.',
    outcome === 'full' ? 'QuotaExceededError' : 'SecurityError',
  );
}

function setup() {
  const database = new MemoryDatabase();
  const legacy = new MemoryLegacyLibrary();
  const serialize = vi.fn(async (system: TransitSystem) => JSON.stringify(system));
  const store = createLibraryStore({ database, legacy, serialize });
  return { database, legacy, serialize, store };
}

describe('IndexedDB library store', () => {
  it('saves a document in IndexedDB before removing its localStorage copy', async () => {
    const { database, legacy, store } = setup();
    const system = { ...createEmptySystem(), id: 'large', name: 'Large system' };
    legacy.systems.set(system.id, system);
    legacy.fail = 'full';

    await expect(store.save(system)).resolves.toBe('saved');

    expect(database.systems.get(system.id)?.serialized).toBe(JSON.stringify(system));
    expect(legacy.systems.has(system.id)).toBe(true);
  });

  it('removes the localStorage copy after an IndexedDB save when cleanup succeeds', async () => {
    const { legacy, store } = setup();
    const system = { ...createEmptySystem(), id: 'migrated' };
    legacy.systems.set(system.id, system);

    await expect(store.save(system)).resolves.toBe('saved');

    expect(legacy.systems.has(system.id)).toBe(false);
  });

  it('falls back to localStorage when IndexedDB is unavailable', async () => {
    const { database, legacy, store } = setup();
    const system = { ...createEmptySystem(), id: 'fallback' };
    database.fail = 'unavailable';

    await expect(store.save(system)).resolves.toBe('saved');

    expect(legacy.systems.get(system.id)).toEqual(system);
  });

  it('reports the useful localStorage failure when both stores reject a save', async () => {
    const { database, legacy, store } = setup();
    const system = { ...createEmptySystem(), id: 'too-large' };
    database.fail = 'unavailable';
    legacy.fail = 'full';

    await expect(store.save(system)).resolves.toBe('full');
  });

  it('loads an IndexedDB document without reading the legacy copy', async () => {
    const { database, legacy, store } = setup();
    const system = { ...createEmptySystem(), id: 'db', name: 'Database' };
    database.systems.set(system.id, {
      id: system.id,
      name: system.name,
      updatedAt: system.updatedAt,
      serialized: JSON.stringify(system),
    });
    legacy.systems.set(system.id, { ...system, name: 'Stale local copy' });

    await expect(store.load(system.id)).resolves.toMatchObject({
      status: 'ok',
      system: { id: system.id, name: system.name },
    });
  });

  it('reads a localStorage document and migrates it after IndexedDB misses', async () => {
    const { database, legacy, store } = setup();
    const system = { ...createEmptySystem(), id: 'legacy', name: 'Legacy' };
    legacy.systems.set(system.id, system);

    await expect(store.load(system.id)).resolves.toEqual({ status: 'ok', system });

    expect(database.systems.has(system.id)).toBe(true);
    expect(legacy.systems.has(system.id)).toBe(false);
  });

  it('keeps a localStorage document when its IndexedDB migration fails', async () => {
    const { database, legacy, store } = setup();
    const system = { ...createEmptySystem(), id: 'legacy' };
    legacy.systems.set(system.id, system);
    database.fail = 'unavailable';

    await expect(store.load(system.id)).resolves.toEqual({ status: 'ok', system });

    expect(legacy.systems.has(system.id)).toBe(true);
  });

  it('keeps corrupt IndexedDB bytes available for future recovery', async () => {
    const { database, store } = setup();
    const id = 'damaged';
    database.systems.set(id, {
      id,
      name: 'Damaged',
      updatedAt: 0,
      serialized: '{ not json',
    });

    await expect(store.load(id)).resolves.toEqual({ status: 'corrupt' });
    expect(database.systems.has(id)).toBe(true);
  });

  it('uses a valid localStorage fallback without replacing corrupt IndexedDB bytes', async () => {
    const { database, legacy, store } = setup();
    const system = { ...createEmptySystem(), id: 'recoverable', name: 'Local recovery' };
    database.systems.set(system.id, {
      id: system.id,
      name: system.name,
      updatedAt: system.updatedAt,
      serialized: '{ not json',
    });
    legacy.systems.set(system.id, system);

    await expect(store.load(system.id)).resolves.toEqual({ status: 'ok', system });

    expect(database.systems.get(system.id)?.serialized).toBe('{ not json');
    expect(legacy.systems.get(system.id)).toBe(system);
  });

  it('merges IndexedDB and localStorage entries without duplicate rows', async () => {
    const { database, legacy, store } = setup();
    const inDatabase = { ...createEmptySystem(), id: 'db', updatedAt: 30 };
    const inBoth = { ...createEmptySystem(), id: 'both', name: 'Database wins', updatedAt: 20 };
    database.systems.set(inDatabase.id, {
      ...inDatabase,
      serialized: JSON.stringify(inDatabase),
    });
    database.systems.set(inBoth.id, { ...inBoth, serialized: JSON.stringify(inBoth) });
    legacy.systems.set('both', { ...inBoth, name: 'Old local name', updatedAt: 10 });
    legacy.systems.set('local', { ...createEmptySystem(), id: 'local', updatedAt: 40 });

    await expect(store.list()).resolves.toEqual([
      expect.objectContaining({ id: 'local' }),
      expect.objectContaining({ id: 'db' }),
      expect.objectContaining({ id: 'both', name: 'Database wins' }),
    ]);
  });

  it('deletes both IndexedDB and localStorage copies', async () => {
    const { database, legacy, store } = setup();
    const system = { ...createEmptySystem(), id: 'gone' };
    database.systems.set(system.id, { ...system, serialized: JSON.stringify(system) });
    legacy.systems.set(system.id, system);

    await expect(store.delete(system.id)).resolves.toBe('saved');

    expect(database.systems.has(system.id)).toBe(false);
    expect(legacy.systems.has(system.id)).toBe(false);
  });

  it('copies the pre-library single slot before removing its only source', async () => {
    const { database, legacy, store } = setup();
    const system = { ...createEmptySystem(), id: 'single-slot' };
    legacy.legacySingleSlot = system;

    await expect(store.migrateLegacySingleSlot()).resolves.toEqual(system);

    expect(database.systems.has(system.id)).toBe(true);
    expect(legacy.legacySingleSlot).toBeNull();
  });

  it('leaves the pre-library single slot intact after a failed copy', async () => {
    const { database, legacy, store } = setup();
    const system = { ...createEmptySystem(), id: 'single-slot' };
    legacy.legacySingleSlot = system;
    database.fail = 'unavailable';
    legacy.fail = 'full';

    await expect(store.migrateLegacySingleSlot()).resolves.toEqual(system);

    expect(legacy.legacySingleSlot).toEqual(system);
  });

  it('coalesces queued saves to the latest document snapshot', async () => {
    const database = new MemoryDatabase();
    const legacy = new MemoryLegacyLibrary();
    const releases: Array<() => void> = [];
    const serialize = vi.fn(
      (system: TransitSystem) =>
        new Promise<string>((resolve) => {
          releases.push(() => resolve(JSON.stringify(system)));
        }),
    );
    const store = createLibraryStore({ database, legacy, serialize });
    const base = { ...createEmptySystem(), id: 'ordered' };

    const first = store.save({ ...base, name: 'First' });
    const second = store.save({ ...base, name: 'Second' });
    const third = store.save({ ...base, name: 'Third' });
    await Promise.resolve();
    expect(serialize).toHaveBeenCalledTimes(1);

    releases.shift()?.();
    await first;
    await Promise.resolve();
    expect(serialize).toHaveBeenCalledTimes(2);
    expect(serialize.mock.calls[1]![0].name).toBe('Third');
    releases.shift()?.();
    await expect(Promise.all([second, third])).resolves.toEqual(['saved', 'saved']);

    await expect(store.load(base.id)).resolves.toMatchObject({
      status: 'ok',
      system: { name: 'Third' },
    });
  });

  it('waits for a pending save before reloading that document', async () => {
    const database = new MemoryDatabase();
    const legacy = new MemoryLegacyLibrary();
    let release: (() => void) | undefined;
    const serialize = (system: TransitSystem) =>
      new Promise<string>((resolve) => {
        release = () => resolve(JSON.stringify(system));
      });
    const store = createLibraryStore({ database, legacy, serialize });
    const system = { ...createEmptySystem(), id: 'pending-load', name: 'Latest' };
    const saving = store.save(system);
    await Promise.resolve();

    const loaded = store.load(system.id);
    let settled = false;
    void loaded.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    release?.();
    await saving;
    await expect(loaded).resolves.toMatchObject({
      status: 'ok',
      system: { name: 'Latest' },
    });
  });

  it('waits for pending saves before listing library metadata', async () => {
    const database = new MemoryDatabase();
    const legacy = new MemoryLegacyLibrary();
    let release: (() => void) | undefined;
    const serialize = (system: TransitSystem) =>
      new Promise<string>((resolve) => {
        release = () => resolve(JSON.stringify(system));
      });
    const store = createLibraryStore({ database, legacy, serialize });
    const system = { ...createEmptySystem(), id: 'pending-list', name: 'Visible after save' };
    const saving = store.save(system);
    await Promise.resolve();

    const listing = store.list();
    let settled = false;
    void listing.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    release?.();
    await saving;
    await expect(listing).resolves.toContainEqual(
      expect.objectContaining({ id: system.id, name: system.name }),
    );
  });
});
