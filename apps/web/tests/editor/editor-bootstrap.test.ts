import { createEmptySystem } from '@transitmapper/core/model/serialize';
import { describe, expect, it, vi } from 'vitest';
import {
  resolveEditorBootstrap,
  type EditorBootstrapSources,
} from '../../src/editor/editor-bootstrap';

function sources(overrides: Partial<EditorBootstrapSources> = {}): EditorBootstrapSources {
  return {
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
      resolveEditorBootstrap(new AbortController().signal, editorSources),
    ).resolves.toEqual({
      kind: 'ready',
      system,
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
      resolveEditorBootstrap(new AbortController().signal, editorSources),
    ).resolves.toEqual({ kind: 'storage-unavailable' });

    expect(activeId).toBe('indexed-db-only');
    expect(createSystem).not.toHaveBeenCalled();
  });

  it('returns no document when local bootstrap finishes after abort', async () => {
    let finish: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const controller = new AbortController();
    const editorSources = sources({
      library: {
        load: vi.fn(),
        list: vi.fn(async () => {
          await pending;
          return { status: 'ok' as const, entries: [], source: 'complete' as const };
        }),
        migrateLegacySingleSlot: vi.fn(() => Promise.resolve(null)),
      },
    });

    const result = resolveEditorBootstrap(controller.signal, editorSources);
    controller.abort();
    finish?.();

    await expect(result).resolves.toEqual({ kind: 'aborted' });
  });
});
