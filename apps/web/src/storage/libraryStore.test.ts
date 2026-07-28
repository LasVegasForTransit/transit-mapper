import { createEmptySystem } from '@transitmapper/core/model/serialize';
import type { TransitSystem } from '@transitmapper/core/model/system';
import { describe, expect, it, vi } from 'vitest';
import {
  createLibraryStore,
  type LibraryDatabase,
  type LegacyLibrary,
  type StoredLibraryEntry,
  type StoredSystemRecord,
} from './libraryStore';
import type { LibraryEntry, LoadResult, SaveOutcome } from './localStore';

class MemoryDatabase implements LibraryDatabase {
  readonly systems = new Map<string, StoredSystemRecord>();
  fail: SaveOutcome | null = null;

  async list(): Promise<StoredLibraryEntry[]> {
    if (this.fail) throw storageError(this.fail);
    return [...this.systems.values()].map(
      ({ id, name, updatedAt, supersededAuthoritativeSnapshotId }) => ({
        id,
        name,
        updatedAt,
        ...(supersededAuthoritativeSnapshotId ? { supersededAuthoritativeSnapshotId } : {}),
      }),
    );
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
  readonly authoritative = new Set<string>();
  readonly authoritativeSnapshotIds = new Map<string, string>();
  legacySingleSlot: TransitSystem | null = null;
  fail: SaveOutcome | null = null;
  available = true;
  databaseHistory = false;
  private nextAuthoritativeSnapshot = 0;

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

  saveAuthoritative(system: TransitSystem): SaveOutcome {
    if (this.fail) return this.fail;
    this.systems.set(system.id, system);
    this.authoritative.add(system.id);
    this.authoritativeSnapshotIds.set(
      system.id,
      `recovery-snapshot-${++this.nextAuthoritativeSnapshot}`,
    );
    return 'saved';
  }

  delete(id: string): SaveOutcome {
    if (this.fail) return this.fail;
    this.systems.delete(id);
    this.authoritative.delete(id);
    this.authoritativeSnapshotIds.delete(id);
    return 'saved';
  }

  getAuthoritativeSnapshotId(id: string): string | null {
    return (
      this.authoritativeSnapshotIds.get(id) ??
      (this.authoritative.has(id) ? 'legacy-authoritative-snapshot' : null)
    );
  }

  loadLegacySingleSlot(): TransitSystem | null {
    return this.legacySingleSlot;
  }

  removeLegacySingleSlot(): void {
    this.legacySingleSlot = null;
  }

  isAvailable(): boolean {
    return this.available;
  }

  hasDatabaseHistory(): boolean {
    return this.databaseHistory;
  }

  setDatabaseHistory(hasDocuments: boolean): void {
    this.databaseHistory = hasDocuments;
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

  it('recovers an equal-timestamp fallback after IndexedDB becomes available again', async () => {
    const { database, legacy, serialize, store } = setup();
    const databaseSystem = {
      ...createEmptySystem(),
      id: 'equal-timestamp-fallback',
      viewport: { center: [-115.14, 36.17] as [number, number], zoom: 10 },
      updatedAt: 50,
    };
    const intendedSystem = {
      ...databaseSystem,
      viewport: { center: [-115.22, 36.1] as [number, number], zoom: 13 },
    };
    database.systems.set(databaseSystem.id, {
      ...databaseSystem,
      serialized: JSON.stringify(databaseSystem),
    });
    database.fail = 'unavailable';

    await expect(store.save(intendedSystem)).resolves.toBe('saved');

    database.fail = null;
    const recovered = createLibraryStore({ database, legacy, serialize });
    await expect(recovered.load(intendedSystem.id)).resolves.toEqual({
      status: 'ok',
      system: intendedSystem,
    });
  });

  it('recovers an intended fallback whose document timestamp moved backward', async () => {
    const { database, legacy, serialize, store } = setup();
    const databaseSystem = {
      ...createEmptySystem(),
      id: 'undo-fallback',
      name: 'Later edit',
      updatedAt: 100,
    };
    const intendedSystem = {
      ...databaseSystem,
      name: 'State restored by undo',
      updatedAt: 40,
    };
    database.systems.set(databaseSystem.id, {
      ...databaseSystem,
      serialized: JSON.stringify(databaseSystem),
    });
    database.fail = 'unavailable';

    await expect(store.save(intendedSystem)).resolves.toBe('saved');

    database.fail = null;
    const recovered = createLibraryStore({ database, legacy, serialize });
    await expect(recovered.load(intendedSystem.id)).resolves.toEqual({
      status: 'ok',
      system: intendedSystem,
    });
  });

  it('does not restore a stale recovery copy after a newer IndexedDB commit', async () => {
    const { database, legacy, serialize, store } = setup();
    const stale = {
      ...createEmptySystem(),
      id: 'superseded-recovery-copy',
      name: 'Stale recovery copy',
      updatedAt: 100,
    };
    const newest = {
      ...stale,
      name: 'Newest database snapshot',
      updatedAt: 40,
    };
    legacy.systems.set(stale.id, stale);
    legacy.authoritative.add(stale.id);
    legacy.fail = 'unavailable';

    await expect(store.save(newest)).resolves.toBe('saved');
    expect(legacy.systems.get(stale.id)).toEqual(stale);

    legacy.fail = null;
    const reloaded = createLibraryStore({ database, legacy, serialize });
    await expect(reloaded.load(stale.id)).resolves.toMatchObject({
      status: 'ok',
      system: {
        id: newest.id,
        name: newest.name,
        updatedAt: newest.updatedAt,
      },
    });
  });

  it('reports the useful localStorage failure when both stores reject a save', async () => {
    const { database, legacy, store } = setup();
    const system = { ...createEmptySystem(), id: 'too-large' };
    database.fail = 'unavailable';
    legacy.fail = 'full';

    await expect(store.save(system)).resolves.toBe('full');
  });

  it('ignores an unmarked localStorage copy with the same timestamp', async () => {
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

  it('promotes a newer localStorage snapshot over an older IndexedDB record', async () => {
    const { database, legacy, store } = setup();
    const databaseSystem = {
      ...createEmptySystem(),
      id: 'newer-local-copy',
      name: 'Older database copy',
      updatedAt: 10,
    };
    const localSystem = {
      ...databaseSystem,
      name: 'Newest local copy',
      updatedAt: 20,
    };
    database.systems.set(databaseSystem.id, {
      id: databaseSystem.id,
      name: databaseSystem.name,
      updatedAt: databaseSystem.updatedAt,
      serialized: JSON.stringify(databaseSystem),
    });
    legacy.systems.set(localSystem.id, localSystem);

    await expect(store.load(localSystem.id)).resolves.toEqual({
      status: 'ok',
      system: localSystem,
    });

    expect(database.systems.get(localSystem.id)).toMatchObject({
      name: localSystem.name,
      updatedAt: localSystem.updatedAt,
      serialized: JSON.stringify(localSystem),
    });
    expect(legacy.systems.has(localSystem.id)).toBe(false);
  });

  it('promotes an authoritative camera-only snapshot when timestamps are equal', async () => {
    const { database, legacy, store } = setup();
    const databaseSystem = {
      ...createEmptySystem(),
      id: 'camera-emergency',
      updatedAt: 50,
      viewport: { center: [-115.14, 36.17] as [number, number], zoom: 10 },
    };
    const localSystem = {
      ...databaseSystem,
      viewport: { center: [-115.22, 36.1] as [number, number], zoom: 13 },
    };
    database.systems.set(databaseSystem.id, {
      id: databaseSystem.id,
      name: databaseSystem.name,
      updatedAt: databaseSystem.updatedAt,
      serialized: JSON.stringify(databaseSystem),
    });
    legacy.systems.set(localSystem.id, localSystem);
    legacy.authoritative.add(localSystem.id);

    await expect(store.load(localSystem.id)).resolves.toEqual({
      status: 'ok',
      system: localSystem,
    });

    expect(database.systems.get(localSystem.id)?.serialized).toBe(JSON.stringify(localSystem));
    expect(legacy.systems.has(localSystem.id)).toBe(false);
    expect(legacy.authoritative.has(localSystem.id)).toBe(false);
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

    await expect(store.list()).resolves.toEqual({
      status: 'ok',
      source: 'complete',
      entries: [
        expect.objectContaining({ id: 'local' }),
        expect.objectContaining({ id: 'db' }),
        expect.objectContaining({ id: 'both', name: 'Database wins' }),
      ],
    });
  });

  it('uses the newest metadata when IndexedDB and localStorage both list a document', async () => {
    const { database, legacy, store } = setup();
    const databaseSystem = {
      ...createEmptySystem(),
      id: 'newest-metadata',
      name: 'Old database name',
      updatedAt: 10,
    };
    const localSystem = {
      ...databaseSystem,
      name: 'Newest local name',
      updatedAt: 20,
    };
    database.systems.set(databaseSystem.id, {
      ...databaseSystem,
      serialized: JSON.stringify(databaseSystem),
    });
    legacy.systems.set(localSystem.id, localSystem);

    await expect(store.list()).resolves.toEqual({
      status: 'ok',
      source: 'complete',
      entries: [
        {
          id: localSystem.id,
          name: localSystem.name,
          updatedAt: localSystem.updatedAt,
        },
      ],
    });
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

  it('reports an IndexedDB delete failure while preserving a removable legacy copy', async () => {
    const { database, legacy, store } = setup();
    const system = { ...createEmptySystem(), id: 'not-deleted' };
    database.systems.set(system.id, { ...system, serialized: JSON.stringify(system) });
    legacy.systems.set(system.id, system);
    database.fail = 'unavailable';

    await expect(store.delete(system.id)).resolves.toBe('unavailable');

    expect(database.systems.has(system.id)).toBe(true);
    expect(legacy.systems.has(system.id)).toBe(true);
  });

  it('reports unavailable when an IndexedDB-only migrated document cannot be read', async () => {
    const { database, legacy, serialize, store } = setup();
    const system = { ...createEmptySystem(), id: 'idb-only' };
    await store.save(system);
    expect(legacy.databaseHistory).toBe(true);
    database.fail = 'unavailable';
    const reloaded = createLibraryStore({ database, legacy, serialize });

    await expect(reloaded.load(system.id)).resolves.toEqual({ status: 'unavailable' });
    await expect(reloaded.list()).resolves.toEqual({ status: 'unavailable' });
  });

  it('keeps localStorage-only libraries usable while IndexedDB is unavailable', async () => {
    const { database, legacy, store } = setup();
    const system = { ...createEmptySystem(), id: 'local-only' };
    legacy.systems.set(system.id, system);
    database.fail = 'unavailable';

    await expect(store.load(system.id)).resolves.toEqual({ status: 'ok', system });
    await expect(store.list()).resolves.toEqual({
      status: 'ok',
      entries: [expect.objectContaining({ id: system.id })],
      source: 'legacy-only',
    });
  });

  it('does not show an incomplete legacy list when IndexedDB may contain migrated documents', async () => {
    const { database, legacy, store } = setup();
    legacy.databaseHistory = true;
    legacy.systems.set('local', { ...createEmptySystem(), id: 'local' });
    database.fail = 'unavailable';

    await expect(store.list()).resolves.toEqual({ status: 'unavailable' });
  });

  it('allows a first localStorage-only document when no IndexedDB history exists', async () => {
    const { database, store } = setup();
    database.fail = 'unavailable';

    await expect(store.list()).resolves.toEqual({
      status: 'ok',
      entries: [],
      source: 'legacy-only',
    });
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
    await expect(listing).resolves.toMatchObject({
      status: 'ok',
      entries: [expect.objectContaining({ id: system.id, name: system.name })],
    });
  });
});
