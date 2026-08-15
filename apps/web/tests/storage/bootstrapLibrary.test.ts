import { createEmptySystem } from '@transitmapper/core/model/serialize';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveLibraryBootstrap, type BootstrapLibrary } from '../../src/storage/bootstrapLibrary';

beforeEach(() => performance.clearMarks());
afterEach(() => performance.clearMarks());

function startupMarkNames(): string[] {
  return performance.getEntriesByType('mark').map((entry) => entry.name);
}

describe('local library bootstrap', () => {
  it('does not create a replacement when an active IndexedDB-only document is unavailable', async () => {
    const createSystem = vi.fn(createEmptySystem);
    const library: BootstrapLibrary = {
      load: vi.fn(() => Promise.resolve({ status: 'unavailable' as const })),
      list: vi.fn(async () => ({ status: 'unavailable' as const })),
      migrateLegacySingleSlot: vi.fn(async () => null),
    };

    await expect(
      resolveLibraryBootstrap({
        activeId: 'migrated-idb-document',
        library,
        createSystem,
      }),
    ).resolves.toEqual({ status: 'unavailable' });

    expect(library.list).not.toHaveBeenCalled();
    expect(library.migrateLegacySingleSlot).not.toHaveBeenCalled();
    expect(createSystem).not.toHaveBeenCalled();
    expect(startupMarkNames()).toEqual(['tm:storage-read-start', 'tm:storage-read-end']);
  });

  it('closes the storage-read milestone when bootstrap throws', async () => {
    const library: BootstrapLibrary = {
      load: vi.fn(),
      list: vi.fn(),
      migrateLegacySingleSlot: vi.fn(() =>
        Promise.reject(new Error('Storage failed unexpectedly.')),
      ),
    };

    await expect(
      resolveLibraryBootstrap({ activeId: null, library, createSystem: createEmptySystem }),
    ).rejects.toThrow('Storage failed unexpectedly.');
    expect(startupMarkNames()).toEqual(['tm:storage-read-start', 'tm:storage-read-end']);
  });

  it('does not create a document when listing a known IndexedDB library is unavailable', async () => {
    const createSystem = vi.fn(createEmptySystem);
    const library: BootstrapLibrary = {
      load: vi.fn(),
      list: vi.fn(async () => ({ status: 'unavailable' as const })),
      migrateLegacySingleSlot: vi.fn(async () => null),
    };

    await expect(
      resolveLibraryBootstrap({ activeId: null, library, createSystem }),
    ).resolves.toEqual({ status: 'unavailable' });
    expect(createSystem).not.toHaveBeenCalled();
  });

  it('creates the first document when a writable localStorage-only library is genuinely empty', async () => {
    const system = createEmptySystem();
    const library: BootstrapLibrary = {
      load: vi.fn(),
      list: vi.fn(async () => ({
        status: 'ok' as const,
        entries: [],
        source: 'legacy-only' as const,
      })),
      migrateLegacySingleSlot: vi.fn(async () => null),
    };

    await expect(
      resolveLibraryBootstrap({
        activeId: null,
        library,
        createSystem: () => system,
      }),
    ).resolves.toEqual({
      status: 'ready',
      system,
      isBrandNew: true,
      encounteredCorruption: false,
    });
  });

  it('loads a viable localStorage fallback while IndexedDB is unavailable', async () => {
    const system = { ...createEmptySystem(), id: 'local-fallback' };
    const library: BootstrapLibrary = {
      load: vi.fn(async () => ({ status: 'ok' as const, system })),
      list: vi.fn(),
      migrateLegacySingleSlot: vi.fn(),
    };

    await expect(
      resolveLibraryBootstrap({
        activeId: system.id,
        library,
        createSystem: createEmptySystem,
      }),
    ).resolves.toMatchObject({
      status: 'ready',
      system: { id: system.id },
      isBrandNew: false,
    });
  });
});
