import { parseSystem } from '@transitmapper/core/model/serialize';
import type { TransitSystem } from '@transitmapper/core/model/system';
import type { LibraryEntry, LoadResult, SaveOutcome } from './localStore';

export interface StoredLibraryEntry extends LibraryEntry {
  supersededAuthoritativeSnapshotId?: string;
}

export interface StoredSystemRecord extends StoredLibraryEntry {
  serialized: string;
}

export interface LibraryDatabase {
  list(): Promise<StoredLibraryEntry[]>;
  load(id: string): Promise<StoredSystemRecord | null>;
  save(record: StoredSystemRecord): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface LegacyLibrary {
  list(): LibraryEntry[];
  load(id: string): LoadResult;
  saveAuthoritative(system: TransitSystem): SaveOutcome;
  delete(id: string): SaveOutcome;
  getAuthoritativeSnapshotId(id: string): string | null;
  loadLegacySingleSlot(): TransitSystem | null;
  removeLegacySingleSlot(): void;
  isAvailable(): boolean;
  hasDatabaseHistory(): boolean;
  setDatabaseHistory(hasDocuments: boolean): void;
}

export interface LibraryStoreDependencies {
  database: LibraryDatabase;
  legacy: LegacyLibrary;
  serialize: (system: TransitSystem) => Promise<string>;
}

export type LibraryLoadResult = LoadResult | { status: 'unavailable' };

export type LibraryListResult =
  | {
      status: 'ok';
      entries: LibraryEntry[];
      source: 'complete' | 'legacy-only';
    }
  | { status: 'unavailable' };

export interface LibraryStore {
  list(): Promise<LibraryListResult>;
  load(id: string): Promise<LibraryLoadResult>;
  save(system: TransitSystem): Promise<SaveOutcome>;
  delete(id: string): Promise<SaveOutcome>;
  migrateLegacySingleSlot(): Promise<TransitSystem | null>;
}

interface PendingSave {
  system: TransitSystem;
  waiters: Array<(outcome: SaveOutcome) => void>;
}

interface DocumentSaveLane {
  pending: PendingSave | null;
  running: boolean;
  idle: Promise<void>;
  resolveIdle: () => void;
}

function outcomeFor(error: unknown): SaveOutcome {
  const name = error instanceof Error ? error.name : '';
  const code = error instanceof DOMException ? error.code : 0;
  return name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    code === 22 ||
    code === 1014
    ? 'full'
    : 'unavailable';
}

function parseRecord(record: StoredSystemRecord): LoadResult {
  try {
    return { status: 'ok', system: parseSystem(JSON.parse(record.serialized)) };
  } catch {
    return { status: 'corrupt' };
  }
}

export function createLibraryStore(dependencies: LibraryStoreDependencies): LibraryStore {
  const saveLanes = new Map<string, DocumentSaveLane>();

  const copyToDatabase = async (system: TransitSystem): Promise<SaveOutcome> => {
    const supersededAuthoritativeSnapshotId = dependencies.legacy.getAuthoritativeSnapshotId(
      system.id,
    );
    try {
      const serialized = await dependencies.serialize(system);
      await dependencies.database.save({
        id: system.id,
        name: system.name,
        updatedAt: system.updatedAt,
        serialized,
        ...(supersededAuthoritativeSnapshotId ? { supersededAuthoritativeSnapshotId } : {}),
      });
      dependencies.legacy.setDatabaseHistory(true);
      // The IndexedDB transaction is committed before the legacy copy is
      // touched. Delete only the copy observed before that transaction: a
      // fallback from another tab may have appeared while it was in flight.
      if (
        dependencies.legacy.getAuthoritativeSnapshotId(system.id) ===
        supersededAuthoritativeSnapshotId
      ) {
        dependencies.legacy.delete(system.id);
      }
      return 'saved';
    } catch (error) {
      return outcomeFor(error);
    }
  };

  const persist = async (system: TransitSystem): Promise<SaveOutcome> => {
    const databaseOutcome = await copyToDatabase(system);
    if (databaseOutcome === 'saved') return 'saved';
    // IndexedDB can be unavailable in locked-down/private contexts. Keep
    // the old path as a real fallback for documents that still fit there.
    return dependencies.legacy.saveAuthoritative(system);
  };

  const drain = async (id: string, lane: DocumentSaveLane): Promise<void> => {
    lane.running = true;
    while (lane.pending) {
      const current = lane.pending;
      lane.pending = null;
      const outcome = await persist(current.system);
      for (const resolve of current.waiters) resolve(outcome);
    }
    lane.running = false;
    lane.resolveIdle();
    if (saveLanes.get(id) === lane) saveLanes.delete(id);
  };

  const save = (system: TransitSystem): Promise<SaveOutcome> =>
    new Promise<SaveOutcome>((resolve) => {
      let lane = saveLanes.get(system.id);
      if (!lane) {
        let resolveIdle = () => {};
        const idle = new Promise<void>((idleResolve) => {
          resolveIdle = idleResolve;
        });
        lane = { pending: null, running: false, idle, resolveIdle };
        saveLanes.set(system.id, lane);
      }
      if (lane.pending) {
        // One document can change repeatedly while Worker serialization or
        // IndexedDB is busy. Only the newest queued immutable snapshot needs
        // durable bytes; every caller still receives that save's outcome.
        lane.pending.system = system;
        lane.pending.waiters.push(resolve);
      } else {
        lane.pending = { system, waiters: [resolve] };
      }
      if (!lane.running) void drain(system.id, lane);
    });

  const waitForDocument = async (id: string): Promise<void> => {
    await saveLanes.get(id)?.idle;
  };

  const waitForCurrentSaves = async (): Promise<void> => {
    await Promise.all([...saveLanes.values()].map((lane) => lane.idle));
  };

  return {
    list: async () => {
      await waitForCurrentSaves();
      const legacyEntries = dependencies.legacy.list();
      let databaseEntries: StoredLibraryEntry[];
      try {
        databaseEntries = await dependencies.database.list();
      } catch {
        if (!dependencies.legacy.hasDatabaseHistory() && dependencies.legacy.isAvailable()) {
          return {
            status: 'ok',
            entries: legacyEntries.sort((a, b) => b.updatedAt - a.updatedAt),
            source: 'legacy-only',
          };
        }
        return { status: 'unavailable' };
      }
      dependencies.legacy.setDatabaseHistory(databaseEntries.length > 0);
      const merged = new Map(databaseEntries.map((entry) => [entry.id, entry]));
      for (const entry of legacyEntries) {
        const existing = merged.get(entry.id);
        const authoritativeSnapshotId = dependencies.legacy.getAuthoritativeSnapshotId(entry.id);
        const isCurrentAuthoritativeSnapshot =
          authoritativeSnapshotId !== null &&
          authoritativeSnapshotId !== existing?.supersededAuthoritativeSnapshotId;
        const isSupersededAuthoritativeSnapshot =
          authoritativeSnapshotId !== null &&
          authoritativeSnapshotId === existing?.supersededAuthoritativeSnapshotId;
        if (
          !existing ||
          isCurrentAuthoritativeSnapshot ||
          (!isSupersededAuthoritativeSnapshot && entry.updatedAt > existing.updatedAt)
        ) {
          merged.set(entry.id, entry);
        }
      }
      return {
        status: 'ok',
        entries: [...merged.values()].sort((a, b) => b.updatedAt - a.updatedAt),
        source: 'complete',
      };
    },
    load: async (id) => {
      await waitForDocument(id);
      let record: StoredSystemRecord | null;
      try {
        record = await dependencies.database.load(id);
      } catch {
        const legacy = dependencies.legacy.load(id);
        return legacy.status === 'missing' ? { status: 'unavailable' } : legacy;
      }
      if (record) {
        dependencies.legacy.setDatabaseHistory(true);
        const parsed = parseRecord(record);
        const legacy = dependencies.legacy.load(id);
        if (parsed.status === 'ok') {
          const authoritativeSnapshotId = dependencies.legacy.getAuthoritativeSnapshotId(id);
          const isCurrentAuthoritativeSnapshot =
            authoritativeSnapshotId !== null &&
            authoritativeSnapshotId !== record.supersededAuthoritativeSnapshotId;
          if (
            legacy.status === 'ok' &&
            (isCurrentAuthoritativeSnapshot ||
              (authoritativeSnapshotId === null && legacy.system.updatedAt > record.updatedAt))
          ) {
            await copyToDatabase(legacy.system);
            return legacy;
          }
          return parsed;
        }
        // A prior localStorage copy may still be valid after an interrupted
        // migration. Prefer the recoverable document but retain both sources:
        // the corrupt IndexedDB bytes may be repairable by a future version.
        return legacy.status === 'ok' ? legacy : parsed;
      }

      const legacy = dependencies.legacy.load(id);
      if (legacy.status !== 'ok') return legacy;
      await copyToDatabase(legacy.system);
      return legacy;
    },
    save,
    delete: async (id) => {
      await waitForDocument(id);
      try {
        await dependencies.database.delete(id);
      } catch (error) {
        // Preserve the legacy copy too. The authoritative IndexedDB record
        // may still exist and would reappear when the database recovers; a
        // partially successful delete is both misleading and less recoverable.
        return outcomeFor(error);
      }
      return dependencies.legacy.delete(id);
    },
    migrateLegacySingleSlot: async () => {
      const system = dependencies.legacy.loadLegacySingleSlot();
      if (!system) return null;
      if ((await save(system)) === 'saved') dependencies.legacy.removeLegacySingleSlot();
      return system;
    },
  };
}
