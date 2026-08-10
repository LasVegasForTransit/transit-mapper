import type { TransitSystem } from '@transitmapper/core/model/system';
import { createIndexedDbLibraryDatabase } from './indexedDbLibrary';
import {
  createLibraryStore,
  type LibraryDatabase,
  type LibraryListResult,
  type LibraryLoadResult,
  type LibraryStore,
} from './libraryStore';
import {
  deleteFromLibrary as deleteLegacy,
  getAuthoritativeSnapshotId,
  hasIndexedDbLibraryHistory,
  isLocalStorageAvailable,
  listLibrary as listLegacy,
  loadLegacySingleSlot,
  loadSystemEntry as loadLegacy,
  removeLegacySingleSlot,
  saveAuthoritativeToLibrary,
  setIndexedDbLibraryHistory,
  type SaveOutcome,
} from './localStore';
import { serializeSystemOffThread } from './serializeSystem';
import { deserializeSystemOffThread } from './deserialize-system';

export type { LibraryEntry, SaveOutcome } from './localStore';
export type { LibraryListResult, LibraryLoadResult } from './libraryStore';

function unavailableDatabase(): LibraryDatabase {
  const fail = (): Promise<never> =>
    Promise.reject(new DOMException('IndexedDB is unavailable.', 'SecurityError'));
  return {
    list: fail,
    load: fail,
    save: fail,
    delete: fail,
  };
}

let browserStore: LibraryStore | null = null;

function getBrowserStore(): LibraryStore {
  if (browserStore) return browserStore;
  const database =
    typeof indexedDB === 'undefined'
      ? unavailableDatabase()
      : createIndexedDbLibraryDatabase(indexedDB);
  browserStore = createLibraryStore({
    database,
    legacy: {
      list: listLegacy,
      load: loadLegacy,
      saveAuthoritative: saveAuthoritativeToLibrary,
      delete: deleteLegacy,
      getAuthoritativeSnapshotId,
      loadLegacySingleSlot,
      removeLegacySingleSlot,
      isAvailable: isLocalStorageAvailable,
      hasDatabaseHistory: hasIndexedDbLibraryHistory,
      setDatabaseHistory: setIndexedDbLibraryHistory,
    },
    serialize: serializeSystemOffThread,
    deserialize: deserializeSystemOffThread,
  });
  return browserStore;
}

export function listLibrary(): Promise<LibraryListResult> {
  return getBrowserStore().list();
}

export function loadSystemEntry(id: string): Promise<LibraryLoadResult> {
  return getBrowserStore().load(id);
}

export function saveToLibrary(system: TransitSystem): Promise<SaveOutcome> {
  return getBrowserStore().save(system);
}

export function deleteFromLibrary(id: string): Promise<SaveOutcome> {
  return getBrowserStore().delete(id);
}

export function migrateLegacySingleSlot(): Promise<TransitSystem | null> {
  return getBrowserStore().migrateLegacySingleSlot();
}
