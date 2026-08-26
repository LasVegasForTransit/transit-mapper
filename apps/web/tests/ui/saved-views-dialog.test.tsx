// @vitest-environment jsdom

import { createEmptySystem } from '@transitmapper/core/model/serialize';
import { createMapViewStore, createSelectionController } from '@transitmapper/map';
import type { CreateViewResponse } from '@transitmapper/views';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SavedViewsDialog, type SavedViewsServices } from '../../src/ui/saved-views-dialog';
import type { LocalViewRecord } from '../../src/views/local-view-library';

const presentation = {
  schemaVersion: 1 as const,
  camera: { center: [-115.17, 36.14] as [number, number], zoom: 11 },
  representationId: 'network',
  filters: { modes: ['bus'] },
};

function localView(overrides: Partial<LocalViewRecord> = {}): LocalViewRecord {
  return {
    documentId: 'document-1',
    id: 'view-1',
    title: 'Downtown buses',
    state: presentation,
    createdAt: 100,
    updatedAt: 100,
    ...overrides,
  };
}

function createServices(initial: LocalViewRecord[] = []): {
  services: SavedViewsServices;
  records: LocalViewRecord[];
  publishSystem: ReturnType<typeof vi.fn<SavedViewsServices['publishSystem']>>;
  createPublication: ReturnType<typeof vi.fn<SavedViewsServices['createPublication']>>;
  deletePublication: ReturnType<typeof vi.fn<SavedViewsServices['deletePublication']>>;
} {
  const records = [...initial];
  const publishSystem = vi.fn(() =>
    Promise.resolve({ id: 'share-1', url: 'https://example.test/s/share-1' }),
  );
  const created: CreateViewResponse = {
    view: {
      schemaVersion: 1,
      id: 'published-1',
      title: 'Downtown buses',
      map: { kind: 'shared-system', id: 'share-1' },
      state: presentation,
    },
    editToken: 'view-token',
    createdAt: 100,
    updatedAt: 100,
  };
  const createPublication = vi.fn(() => Promise.resolve(created));
  const deletePublication = vi.fn(() => Promise.resolve());
  return {
    records,
    publishSystem,
    createPublication,
    deletePublication,
    services: {
      library: {
        list: () => Promise.resolve([...records].sort((a, b) => b.updatedAt - a.updatedAt)),
        put: (view) => {
          const index = records.findIndex((candidate) => candidate.id === view.id);
          if (index === -1) records.push(view);
          else records[index] = view;
          return Promise.resolve();
        },
        delete: (_documentId, id) => {
          const index = records.findIndex((candidate) => candidate.id === id);
          if (index !== -1) records.splice(index, 1);
          return Promise.resolve();
        },
      },
      publishSystem,
      createPublication,
      updatePublication: vi.fn(() => Promise.resolve(created)),
      deletePublication,
      createId: () => 'view-1',
      now: () => 100,
    },
  };
}

let container: HTMLDivElement;
let root: Root;
let onClose: ReturnType<typeof vi.fn<() => void>>;

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function buttonNamed(name: string): HTMLButtonElement {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) =>
      candidate.getAttribute('aria-label') === name || candidate.textContent.trim() === name,
  );
  if (!button) throw new Error(`Expected button named "${name}"`);
  return button;
}

async function click(name: string): Promise<void> {
  await act(async () => {
    buttonNamed(name).click();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderDialog(services: SavedViewsServices): Promise<{
  viewStore: ReturnType<typeof createMapViewStore>;
  selection: ReturnType<typeof createSelectionController>;
}> {
  const viewStore = createMapViewStore(presentation);
  const selection = createSelectionController();
  act(() => {
    root.render(
      <SavedViewsDialog
        onClose={onClose}
        system={{ ...createEmptySystem(), id: 'document-1', name: 'Test system' }}
        viewStore={viewStore}
        selection={selection}
        services={services}
      />,
    );
  });
  await settle();
  return { viewStore, selection };
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  onClose = vi.fn();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.replaceChildren();
});

describe('Saved views dialog', () => {
  it('saves the current map from the empty state', async () => {
    const state = createServices();
    await renderDialog(state.services);

    expect(document.body.textContent).toContain('No saved views yet.');
    await click('Save current view');
    const input = document.querySelector<HTMLInputElement>('input[aria-label="View name"]');
    expect(input?.value).toBe('View 1');
    await click('Save');

    expect(state.records).toMatchObject([{ id: 'view-1', title: 'View 1' }]);
    expect(document.body.textContent).toContain('View 1');
  });

  it('opens a saved presentation on the existing editor surface', async () => {
    const state = createServices([
      localView({
        state: {
          ...presentation,
          camera: { center: [-73.98, 40.75], zoom: 13 },
          selection: { source: 'document', kind: 'stop', id: 'stop-1' },
        },
      }),
    ]);
    const session = await renderDialog(state.services);

    await click('Open Downtown buses');

    expect(session.viewStore.getSnapshot().camera).toEqual({ center: [-73.98, 40.75], zoom: 13 });
    expect(session.selection.getSnapshot()).toEqual({
      source: 'document',
      kind: 'stop',
      id: 'stop-1',
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows the canonical link after publishing a saved view', async () => {
    const state = createServices([localView()]);
    await renderDialog(state.services);

    await click('Actions for Downtown buses');
    await click('Share');

    expect(state.publishSystem).toHaveBeenCalledOnce();
    expect(state.createPublication).toHaveBeenCalledOnce();
    expect(
      document.querySelector<HTMLInputElement>('input[aria-label="Link to Downtown buses"]')?.value,
    ).toBe('http://localhost:3000/v/published-1');
  });

  it('requires confirmation before deleting a published view', async () => {
    const state = createServices([
      localView({
        publishedId: 'published-1',
        sharedSystemId: 'share-1',
        editToken: 'view-token',
      }),
    ]);
    await renderDialog(state.services);

    await click('Actions for Downtown buses');
    await click('Delete');
    expect(document.body.textContent).toContain('Public and embedded links will stop working.');
    await click('Delete and stop sharing');

    expect(state.deletePublication).toHaveBeenCalledWith(
      'published-1',
      'view-token',
      expect.any(Object),
    );
    expect(state.records).toEqual([]);
  });
});
