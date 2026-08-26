import { parseMapViewState, type MapViewStateV1 } from '@transitmapper/views';

const LOCAL_VIEW_DATABASE = 'transitmapper-views';
const LOCAL_VIEW_DATABASE_VERSION = 1;
const LOCAL_VIEW_STORE = 'views';
const LOCAL_VIEW_DOCUMENT_INDEX = 'by-document';

export interface LocalViewRecord {
  documentId: string;
  id: string;
  title: string;
  description?: string;
  state: MapViewStateV1;
  createdAt: number;
  updatedAt: number;
  publishedId?: string;
  sharedSystemId?: string;
  editToken?: string;
}

interface StoredLocalView extends LocalViewRecord {
  key: string;
}

export interface LocalViewLibrary {
  list(documentId: string): Promise<LocalViewRecord[]>;
  put(view: LocalViewRecord): Promise<void>;
  delete(documentId: string, id: string): Promise<void>;
}

function viewKey(documentId: string, id: string): string {
  return `${documentId}\u0000${id}`;
}

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

function parseStoredView(value: StoredLocalView): LocalViewRecord {
  const parsed: LocalViewRecord = {
    documentId: value.documentId,
    id: value.id,
    title: value.title,
    state: parseMapViewState(value.state),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
  if (value.description !== undefined) parsed.description = value.description;
  if (value.publishedId !== undefined) parsed.publishedId = value.publishedId;
  if (value.sharedSystemId !== undefined) parsed.sharedSystemId = value.sharedSystemId;
  if (value.editToken !== undefined) parsed.editToken = value.editToken;
  return parsed;
}

function storedView(view: LocalViewRecord): StoredLocalView {
  if (!view.documentId || !view.id || !view.title.trim()) {
    throw new TypeError('A local View requires a document, id, and title.');
  }
  return {
    ...view,
    key: viewKey(view.documentId, view.id),
    state: parseMapViewState(view.state),
  };
}

/** Named local Views use their own database. Opening one must not upgrade or
 * block the document database that the editor may already have open. */
export function createIndexedDbLocalViewLibrary(factory: IDBFactory): LocalViewLibrary {
  let opening: Promise<IDBDatabase> | null = null;

  const open = (): Promise<IDBDatabase> => {
    if (opening) return opening;
    opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(LOCAL_VIEW_DATABASE, LOCAL_VIEW_DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        const existingStore = database.objectStoreNames.contains(LOCAL_VIEW_STORE);
        const upgradeTransaction = request.transaction;
        let store: IDBObjectStore;
        if (existingStore) {
          if (!upgradeTransaction) {
            throw new DOMException(
              'IndexedDB upgrade transaction is missing.',
              'InvalidStateError',
            );
          }
          store = upgradeTransaction.objectStore(LOCAL_VIEW_STORE);
        } else {
          store = database.createObjectStore(LOCAL_VIEW_STORE, { keyPath: 'key' });
        }
        if (!store.indexNames.contains(LOCAL_VIEW_DOCUMENT_INDEX)) {
          store.createIndex(LOCAL_VIEW_DOCUMENT_INDEX, 'documentId');
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
    list: async (documentId) => {
      const database = await open();
      const transaction = database.transaction(LOCAL_VIEW_STORE, 'readonly');
      const rows = (await requestResult(
        transaction
          .objectStore(LOCAL_VIEW_STORE)
          .index(LOCAL_VIEW_DOCUMENT_INDEX)
          .getAll(documentId),
      )) as StoredLocalView[];
      return rows.map(parseStoredView).sort((left, right) => right.updatedAt - left.updatedAt);
    },
    put: async (view) => {
      const database = await open();
      const transaction = database.transaction(LOCAL_VIEW_STORE, 'readwrite');
      transaction.objectStore(LOCAL_VIEW_STORE).put(storedView(view));
      await transactionComplete(transaction);
    },
    delete: async (documentId, id) => {
      const database = await open();
      const transaction = database.transaction(LOCAL_VIEW_STORE, 'readwrite');
      transaction.objectStore(LOCAL_VIEW_STORE).delete(viewKey(documentId, id));
      await transactionComplete(transaction);
    },
  };
}
