import { describe, expect, it, vi } from 'vitest';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
import { createLibraryStore, type LegacyLibrary } from '../../src/storage/libraryStore';

describe('library deserialization', () => {
  it('reconstructs a stored document through the off-thread deserializer boundary', async () => {
    const system = { ...createEmptySystem(), id: 'metro', name: 'Metro' };
    const serialized = JSON.stringify(system);
    const deserialize = vi.fn(() => Promise.resolve(system));
    const legacy: LegacyLibrary = {
      list: () => [],
      load: () => ({ status: 'missing' }),
      saveAuthoritative: () => 'saved',
      delete: () => 'saved',
      getAuthoritativeSnapshotId: () => null,
      loadLegacySingleSlot: () => null,
      removeLegacySingleSlot: () => {},
      isAvailable: () => true,
      hasDatabaseHistory: () => false,
      setDatabaseHistory: () => {},
    };
    const store = createLibraryStore({
      database: {
        list: () => Promise.resolve([]),
        load: () =>
          Promise.resolve({
            id: system.id,
            name: system.name,
            updatedAt: system.updatedAt,
            serialized,
          }),
        save: () => Promise.resolve(),
        delete: () => Promise.resolve(),
      },
      legacy,
      serialize: (value) => Promise.resolve(JSON.stringify(value)),
      deserialize,
    });

    await expect(store.load(system.id)).resolves.toMatchObject({
      status: 'ok',
      system: { id: system.id, name: system.name },
    });
    expect(deserialize).toHaveBeenCalledWith(serialized);
  });
});
