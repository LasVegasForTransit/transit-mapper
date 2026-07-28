import { parseSystem } from '@transitmapper/core/model/serialize';
import type { TransitSystem } from '@transitmapper/core/model/system';
import type { LibraryEntry, LoadResult, SaveOutcome } from './localStore';

export interface StoredSystemRecord extends LibraryEntry {
  serialized: string;
}

export interface LibraryDatabase {
  list(): Promise<LibraryEntry[]>;
  load(id: string): Promise<StoredSystemRecord | null>;
  save(record: StoredSystemRecord): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface LegacyLibrary {
  list(): LibraryEntry[];
  load(id: string): LoadResult;
  save(system: TransitSystem): SaveOutcome;
  delete(id: string): SaveOutcome;
  loadLegacySingleSlot(): TransitSystem | null;
  removeLegacySingleSlot(): void;
}

export interface LibraryStoreDependencies {
  database: LibraryDatabase;
  legacy: LegacyLibrary;
  serialize: (system: TransitSystem) => Promise<string>;
}

export interface LibraryStore {
  list(): Promise<LibraryEntry[]>;
  load(id: string): Promise<LoadResult>;
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
    try {
      const serialized = await dependencies.serialize(system);
      await dependencies.database.save({
        id: system.id,
        name: system.name,
        updatedAt: system.updatedAt,
        serialized,
      });
      // The IndexedDB transaction is committed before the legacy copy is
      // touched. A failed cleanup can waste space but cannot lose work.
      dependencies.legacy.delete(system.id);
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
    return dependencies.legacy.save(system);
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
      let databaseEntries: LibraryEntry[];
      try {
        databaseEntries = await dependencies.database.list();
      } catch {
        return legacyEntries.sort((a, b) => b.updatedAt - a.updatedAt);
      }
      const merged = new Map(legacyEntries.map((entry) => [entry.id, entry]));
      for (const entry of databaseEntries) merged.set(entry.id, entry);
      return [...merged.values()].sort((a, b) => b.updatedAt - a.updatedAt);
    },
    load: async (id) => {
      await waitForDocument(id);
      let record: StoredSystemRecord | null;
      try {
        record = await dependencies.database.load(id);
      } catch {
        return dependencies.legacy.load(id);
      }
      if (record) {
        const parsed = parseRecord(record);
        if (parsed.status === 'ok') return parsed;
        // A prior localStorage copy may still be valid after an interrupted
        // migration. Prefer the recoverable document but retain both sources:
        // the corrupt IndexedDB bytes may be repairable by a future version.
        const legacy = dependencies.legacy.load(id);
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
      } catch {
        return dependencies.legacy.delete(id);
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
