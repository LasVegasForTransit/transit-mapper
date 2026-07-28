import type { LibraryDatabase, StoredSystemRecord } from './libraryStore';
import type { LibraryEntry } from './localStore';

const INDEXED_DB_NAME = 'transitmapper-documents';
const INDEXED_DB_VERSION = 1;

export const INDEXED_DB_DOCUMENT_STORE = 'systems';
export const INDEXED_DB_INDEX_STORE = 'library';

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new DOMException('IndexedDB request failed.', 'UnknownError'));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new DOMException('IndexedDB transaction aborted.', 'AbortError'));
    transaction.onerror = () =>
      reject(
        transaction.error ?? new DOMException('IndexedDB transaction failed.', 'UnknownError'),
      );
  });
}

/** The complete JSON document and the lightweight library row live in
 * separate object stores. Listing a library of RTC-sized systems therefore
 * never reads megabytes of document contents, while a save updates both rows
 * atomically in one IndexedDB transaction. */
export function createIndexedDbLibraryDatabase(factory: IDBFactory): LibraryDatabase {
  let opening: Promise<IDBDatabase> | null = null;

  const open = (): Promise<IDBDatabase> => {
    if (opening) return opening;
    opening = new Promise<IDBDatabase>((resolve, reject) => {
      let request: IDBOpenDBRequest;
      try {
        request = factory.open(INDEXED_DB_NAME, INDEXED_DB_VERSION);
      } catch (error) {
        opening = null;
        reject(error);
        return;
      }
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(INDEXED_DB_DOCUMENT_STORE)) {
          database.createObjectStore(INDEXED_DB_DOCUMENT_STORE, { keyPath: 'id' });
        }
        if (!database.objectStoreNames.contains(INDEXED_DB_INDEX_STORE)) {
          database.createObjectStore(INDEXED_DB_INDEX_STORE, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        opening = null;
        reject(request.error ?? new DOMException('IndexedDB could not open.', 'UnknownError'));
      };
      request.onblocked = () => {
        opening = null;
        reject(
          new DOMException('IndexedDB upgrade is blocked by another tab.', 'InvalidStateError'),
        );
      };
    });
    return opening;
  };

  return {
    list: async () => {
      const database = await open();
      const transaction = database.transaction(INDEXED_DB_INDEX_STORE, 'readonly');
      return (await requestResult(
        transaction.objectStore(INDEXED_DB_INDEX_STORE).getAll(),
      )) as LibraryEntry[];
    },
    load: async (id) => {
      const database = await open();
      const transaction = database.transaction(INDEXED_DB_DOCUMENT_STORE, 'readonly');
      const record = await requestResult(
        transaction.objectStore(INDEXED_DB_DOCUMENT_STORE).get(id),
      );
      return (record as StoredSystemRecord | undefined) ?? null;
    },
    save: async (record) => {
      const database = await open();
      const transaction = database.transaction(
        [INDEXED_DB_DOCUMENT_STORE, INDEXED_DB_INDEX_STORE],
        'readwrite',
      );
      transaction.objectStore(INDEXED_DB_DOCUMENT_STORE).put(record);
      transaction.objectStore(INDEXED_DB_INDEX_STORE).put({
        id: record.id,
        name: record.name,
        updatedAt: record.updatedAt,
      } satisfies LibraryEntry);
      await transactionComplete(transaction);
    },
    delete: async (id) => {
      const database = await open();
      const transaction = database.transaction(
        [INDEXED_DB_DOCUMENT_STORE, INDEXED_DB_INDEX_STORE],
        'readwrite',
      );
      transaction.objectStore(INDEXED_DB_DOCUMENT_STORE).delete(id);
      transaction.objectStore(INDEXED_DB_INDEX_STORE).delete(id);
      await transactionComplete(transaction);
    },
  };
}
