import { describe, expect, it } from 'vitest';
import {
  INDEXED_DB_DOCUMENT_STORE,
  INDEXED_DB_INDEX_STORE,
  createIndexedDbLibraryDatabase,
} from './indexedDbLibrary';
import type { StoredSystemRecord } from './libraryStore';

interface FakeRequest<T> {
  result: T;
  error: DOMException | null;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
}

function successfulRequest<T>(result: T): IDBRequest<T> {
  const request: FakeRequest<T> = {
    result,
    error: null,
    onsuccess: null,
    onerror: null,
  };
  queueMicrotask(() => request.onsuccess?.());
  return request as unknown as IDBRequest<T>;
}

class FakeObjectStore {
  constructor(private readonly records: Map<IDBValidKey, unknown>) {}

  get(key: IDBValidKey): IDBRequest<unknown> {
    return successfulRequest(this.records.get(key));
  }

  getAll(): IDBRequest<unknown[]> {
    return successfulRequest([...this.records.values()]);
  }

  put(value: { id: IDBValidKey }): IDBRequest<IDBValidKey> {
    this.records.set(value.id, value);
    return successfulRequest(value.id);
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

  constructor(
    private readonly records: Map<string, Map<IDBValidKey, unknown>>,
    readonly storeNames: string[],
  ) {
    queueMicrotask(() => this.oncomplete?.());
  }

  objectStore(name: string): IDBObjectStore {
    const records = this.records.get(name);
    if (!records) throw new DOMException(`Missing ${name}`, 'NotFoundError');
    return new FakeObjectStore(records) as unknown as IDBObjectStore;
  }
}

class FakeDatabase {
  readonly records = new Map<string, Map<IDBValidKey, unknown>>();
  readonly transactionLog: string[][] = [];
  readonly objectStoreNames = {
    contains: (name: string) => this.records.has(name),
  } as DOMStringList;

  createObjectStore(name: string): IDBObjectStore {
    const records = new Map<IDBValidKey, unknown>();
    this.records.set(name, records);
    return new FakeObjectStore(records) as unknown as IDBObjectStore;
  }

  transaction(storeNames: string | string[]): IDBTransaction {
    const names = typeof storeNames === 'string' ? [storeNames] : [...storeNames];
    this.transactionLog.push(names);
    return new FakeTransaction(this.records, names) as unknown as IDBTransaction;
  }
}

class FakeIndexedDbFactory {
  readonly database = new FakeDatabase();

  open(): IDBOpenDBRequest {
    const request = {
      result: this.database,
      error: null,
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

describe('IndexedDB document database', () => {
  it('creates separate document and lightweight index stores', async () => {
    const factory = new FakeIndexedDbFactory();
    const database = createIndexedDbLibraryDatabase(factory as unknown as IDBFactory);

    await database.list();

    expect(factory.database.objectStoreNames.contains(INDEXED_DB_DOCUMENT_STORE)).toBe(true);
    expect(factory.database.objectStoreNames.contains(INDEXED_DB_INDEX_STORE)).toBe(true);
  });

  it('stores document bytes and library metadata in one transaction', async () => {
    const factory = new FakeIndexedDbFactory();
    const database = createIndexedDbLibraryDatabase(factory as unknown as IDBFactory);
    const record: StoredSystemRecord = {
      id: 'rtc',
      name: 'RTC',
      updatedAt: 42,
      serialized: '{"id":"rtc"}',
    };

    await database.save(record);

    expect(factory.database.transactionLog.at(-1)).toEqual([
      INDEXED_DB_DOCUMENT_STORE,
      INDEXED_DB_INDEX_STORE,
    ]);
    await expect(database.load(record.id)).resolves.toEqual(record);
    await expect(database.list()).resolves.toEqual([
      { id: record.id, name: record.name, updatedAt: record.updatedAt },
    ]);
  });

  it('deletes the document and its index row in one transaction', async () => {
    const factory = new FakeIndexedDbFactory();
    const database = createIndexedDbLibraryDatabase(factory as unknown as IDBFactory);
    const record: StoredSystemRecord = {
      id: 'gone',
      name: 'Gone',
      updatedAt: 42,
      serialized: '{"id":"gone"}',
    };
    await database.save(record);

    await database.delete(record.id);

    await expect(database.load(record.id)).resolves.toBeNull();
    await expect(database.list()).resolves.toEqual([]);
  });
});
