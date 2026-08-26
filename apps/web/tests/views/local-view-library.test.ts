import { describe, expect, it } from 'vitest';
import {
  createIndexedDbLocalViewLibrary,
  type LocalViewRecord,
} from '../../src/views/local-view-library';

interface FakeRequest<T> {
  result: T;
  error: DOMException | null;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
}

function successfulRequest<T>(result: T): IDBRequest<T> {
  const request: FakeRequest<T> = { result, error: null, onsuccess: null, onerror: null };
  queueMicrotask(() => request.onsuccess?.());
  return request as unknown as IDBRequest<T>;
}

class FakeIndex {
  constructor(private readonly records: Map<IDBValidKey, LocalViewRecord & { key: string }>) {}

  getAll(documentId: IDBValidKey): IDBRequest<Array<LocalViewRecord & { key: string }>> {
    return successfulRequest(
      [...this.records.values()].filter((record) => record.documentId === documentId),
    );
  }
}

class FakeObjectStore {
  readonly indexNames = { contains: () => true } as unknown as DOMStringList;

  constructor(private readonly records: Map<IDBValidKey, LocalViewRecord & { key: string }>) {}

  createIndex(): IDBIndex {
    return new FakeIndex(this.records) as unknown as IDBIndex;
  }

  index(): IDBIndex {
    return new FakeIndex(this.records) as unknown as IDBIndex;
  }

  put(value: LocalViewRecord & { key: string }): IDBRequest<IDBValidKey> {
    this.records.set(value.key, value);
    return successfulRequest<IDBValidKey>(value.key);
  }

  delete(key: IDBValidKey): IDBRequest<undefined> {
    this.records.delete(key);
    return successfulRequest(undefined);
  }
}

class FakeTransaction {
  error: DOMException | null = null;
  oncomplete: (() => void) | null = null;
  onabort: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(private readonly store: FakeObjectStore) {
    queueMicrotask(() => this.oncomplete?.());
  }

  objectStore(): IDBObjectStore {
    return this.store as unknown as IDBObjectStore;
  }
}

class FakeIndexedDbFactory {
  private readonly records = new Map<IDBValidKey, LocalViewRecord & { key: string }>();
  private readonly store = new FakeObjectStore(this.records);
  private readonly database = {
    objectStoreNames: { contains: () => true } as unknown as DOMStringList,
    createObjectStore: () => this.store as unknown as IDBObjectStore,
    transaction: () => new FakeTransaction(this.store) as unknown as IDBTransaction,
  };

  open(): IDBOpenDBRequest {
    const request = {
      result: this.database,
      error: null,
      transaction: new FakeTransaction(this.store),
      onupgradeneeded: null as (() => void) | null,
      onsuccess: null as (() => void) | null,
      onerror: null as (() => void) | null,
      onblocked: null,
    };
    queueMicrotask(() => {
      request.onupgradeneeded?.();
      request.onsuccess?.();
    });
    return request as unknown as IDBOpenDBRequest;
  }
}

function localView(documentId: string, id: string, updatedAt: number): LocalViewRecord {
  return {
    documentId,
    id,
    title: `View ${id}`,
    state: {
      schemaVersion: 1,
      camera: { center: [-115.17, 36.14], zoom: 11 },
      representationId: 'network',
      filters: { modes: ['bus'] },
    },
    createdAt: 10,
    updatedAt,
  };
}

describe('local View library', () => {
  it('lists only the Views owned by one transit document', async () => {
    const library = createIndexedDbLocalViewLibrary(
      new FakeIndexedDbFactory() as unknown as IDBFactory,
    );
    await library.put(localView('document-a', 'first', 20));
    await library.put(localView('document-b', 'other', 30));
    await library.put(localView('document-a', 'second', 40));

    await expect(library.list('document-a')).resolves.toEqual([
      localView('document-a', 'second', 40),
      localView('document-a', 'first', 20),
    ]);
  });

  it('updates and deletes a View without writing a transit document', async () => {
    const library = createIndexedDbLocalViewLibrary(
      new FakeIndexedDbFactory() as unknown as IDBFactory,
    );
    await library.put(localView('document-a', 'first', 20));
    await library.put({ ...localView('document-a', 'first', 50), title: 'Renamed' });

    await expect(library.list('document-a')).resolves.toMatchObject([
      { id: 'first', title: 'Renamed', updatedAt: 50 },
    ]);
    await library.delete('document-a', 'first');
    await expect(library.list('document-a')).resolves.toEqual([]);
  });
});
