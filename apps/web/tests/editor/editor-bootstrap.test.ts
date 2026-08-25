import { createEmptySystem } from '@transitmapper/core/model/serialize';
import type { TransitSystem } from '@transitmapper/core/model/system';
import { describe, expect, it, vi } from 'vitest';
import type { RouteIntent } from '../../src/app/route-intent';
import {
  resolveEditorBootstrap,
  type EditorBootstrapSources,
} from '../../src/editor/editor-bootstrap';

function sources(overrides: Partial<EditorBootstrapSources> = {}): EditorBootstrapSources {
  return {
    fetchSharedSystem: vi.fn(() => Promise.reject(new Error('Unexpected shared-system load.'))),
    getActiveId: vi.fn(() => null),
    library: {
      load: vi.fn(),
      list: vi.fn(() =>
        Promise.resolve({
          status: 'ok' as const,
          entries: [],
          source: 'complete' as const,
        }),
      ),
      migrateLegacySingleSlot: vi.fn(() => Promise.resolve(null)),
    },
    createSystem: createEmptySystem,
    ...overrides,
  };
}

describe('editor bootstrap', () => {
  it('resolves a shared system as a read-only document', async () => {
    const system = { ...createEmptySystem(), id: 'shared-document' };
    const fetchSharedSystem = vi.fn(() => Promise.resolve(system));

    await expect(
      resolveEditorBootstrap(
        { kind: 'shared-system', shareId: 'abc123' },
        new AbortController().signal,
        sources({ fetchSharedSystem }),
      ),
    ).resolves.toEqual({ kind: 'ready', system, readOnly: true, source: 'shared-system' });
  });

  it('returns the share failure without creating a local document', async () => {
    const createSystem = vi.fn(createEmptySystem);
    const list = vi.fn(() =>
      Promise.resolve({ status: 'ok' as const, entries: [], source: 'complete' as const }),
    );
    const editorSources = sources({
      fetchSharedSystem: vi.fn(() => Promise.reject(new Error('Share not found.'))),
      createSystem,
      library: {
        load: vi.fn(),
        list,
        migrateLegacySingleSlot: vi.fn(() => Promise.resolve(null)),
      },
    });

    await expect(
      resolveEditorBootstrap(
        { kind: 'shared-system', shareId: 'missing' },
        new AbortController().signal,
        editorSources,
      ),
    ).resolves.toEqual({ kind: 'share-failed' });

    expect(createSystem).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
  });

  it('resolves the active local-library document without replacing it', async () => {
    const system = { ...createEmptySystem(), id: 'active-document' };
    const editorSources = sources({
      getActiveId: () => system.id,
      library: {
        load: vi.fn(() => Promise.resolve({ status: 'ok' as const, system })),
        list: vi.fn(),
        migrateLegacySingleSlot: vi.fn(),
      },
    });

    await expect(
      resolveEditorBootstrap({ kind: 'editor' }, new AbortController().signal, editorSources),
    ).resolves.toEqual({
      kind: 'ready',
      system,
      readOnly: false,
      source: 'local-library',
      isBrandNew: false,
      encounteredCorruption: false,
    });
  });

  it('keeps the active document unresolved when storage is unavailable', async () => {
    const activeId = 'indexed-db-only';
    const createSystem = vi.fn(createEmptySystem);
    const editorSources = sources({
      getActiveId: () => activeId,
      createSystem,
      library: {
        load: vi.fn(() => Promise.resolve({ status: 'unavailable' as const })),
        list: vi.fn(),
        migrateLegacySingleSlot: vi.fn(),
      },
    });

    await expect(
      resolveEditorBootstrap({ kind: 'editor' }, new AbortController().signal, editorSources),
    ).resolves.toEqual({ kind: 'storage-unavailable' });

    expect(activeId).toBe('indexed-db-only');
    expect(createSystem).not.toHaveBeenCalled();
  });

  it.each<RouteIntent>([{ kind: 'editor' }, { kind: 'shared-system', shareId: 'abc123' }])(
    'returns no document when %s bootstrap finishes after abort',
    async (routeIntent) => {
      const system = createEmptySystem();
      let finish: ((resolvedSystem: TransitSystem) => void) | undefined;
      const pending = new Promise<TransitSystem>((resolve) => {
        finish = resolve;
      });
      const controller = new AbortController();
      const editorSources = sources({
        fetchSharedSystem: () => pending,
        library: {
          load: vi.fn(),
          list: vi.fn(async () => {
            await pending;
            return { status: 'ok' as const, entries: [], source: 'complete' as const };
          }),
          migrateLegacySingleSlot: vi.fn(() => Promise.resolve(null)),
        },
      });

      const result = resolveEditorBootstrap(routeIntent, controller.signal, editorSources);
      controller.abort();
      finish?.(system);

      await expect(result).resolves.toEqual({ kind: 'aborted' });
    },
  );
});
