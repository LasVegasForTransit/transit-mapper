import type { TransitSystem } from '@transitmapper/core/model/system';
import { createMapViewStore, createSelectionController } from '@transitmapper/map';
import type { CreateViewResponse, GetViewResponse } from '@transitmapper/views';
import { describe, expect, it, vi } from 'vitest';
import type { LocalViewLibrary, LocalViewRecord } from '../../src/views/local-view-library';
import {
  deleteSavedView,
  nextSavedViewTitle,
  publishSavedView,
  renameSavedView,
  restoreSavedView,
  saveCurrentView,
} from '../../src/views/saved-views';

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

interface TestLibrary {
  value: LocalViewLibrary;
  put: ReturnType<typeof vi.fn<LocalViewLibrary['put']>>;
  delete: ReturnType<typeof vi.fn<LocalViewLibrary['delete']>>;
}

function library(): TestLibrary {
  const put = vi.fn(() => Promise.resolve());
  const deleteRecord = vi.fn(() => Promise.resolve());
  return {
    value: {
      list: vi.fn(() => Promise.resolve([])),
      put,
      delete: deleteRecord,
    },
    put,
    delete: deleteRecord,
  };
}

function publishedResponse(id = 'published-1', shareId = 'share-1'): CreateViewResponse {
  return {
    view: {
      schemaVersion: 1,
      id,
      title: 'Downtown buses',
      map: { kind: 'shared-system', id: shareId },
      state: presentation,
    },
    editToken: 'view-token',
    createdAt: 100,
    updatedAt: 100,
  };
}

describe('saved View workflow', () => {
  it('numbers the first unused default name', () => {
    expect(
      nextSavedViewTitle([
        localView({ id: 'a', title: 'View 1' }),
        localView({ id: 'b', title: 'A custom name' }),
        localView({ id: 'c', title: 'View 3' }),
      ]),
    ).toBe('View 2');
  });

  it('saves presentation and selection without receiving a transit document', async () => {
    const views = library();
    const viewStore = createMapViewStore(presentation);
    const selection = createSelectionController({ source: 'document', kind: 'stop', id: 'stop-1' });

    const saved = await saveCurrentView({
      documentId: 'document-1',
      title: 'Downtown buses',
      viewStore,
      selection,
      library: views.value,
      createId: () => 'view-1',
      now: () => 100,
    });

    expect(saved.state).toEqual({
      ...presentation,
      selection: { source: 'document', kind: 'stop', id: 'stop-1' },
    });
    expect(views.put).toHaveBeenCalledWith(saved);
  });

  it('restores presentation and selection through their session owners', () => {
    const viewStore = createMapViewStore({
      ...presentation,
      camera: { center: [-73.98, 40.75], zoom: 9 },
    });
    const selection = createSelectionController();
    const saved = localView({
      state: {
        ...presentation,
        selection: { source: 'document', kind: 'station', id: 'station-1' },
      },
    });

    restoreSavedView(saved, viewStore, selection);

    expect(viewStore.getSnapshot()).toEqual(presentation);
    expect(selection.getSnapshot()).toEqual({
      source: 'document',
      kind: 'station',
      id: 'station-1',
    });
  });

  it('keeps a local rename when its published title cannot update', async () => {
    const views = library();
    const updatePublication = vi.fn(() => Promise.reject(new Error('offline')));
    const result = await renameSavedView({
      view: localView({ publishedId: 'published-1', editToken: 'view-token' }),
      title: 'The Strip',
      library: views.value,
      updatePublication,
      now: () => 200,
    });

    expect(result.view.title).toBe('The Strip');
    expect(views.put).toHaveBeenCalledWith(expect.objectContaining({ title: 'The Strip' }));
    expect(result.publicationError).toEqual(new Error('offline'));
  });

  it('publishes the transit document before it creates the public View', async () => {
    const order: string[] = [];
    const views = library();
    const publishSystem = vi.fn(() => {
      order.push('system');
      return Promise.resolve({ id: 'share-1', url: 'https://example.test/s/share-1' });
    });
    const createPublication = vi.fn(() => {
      order.push('view');
      return Promise.resolve(publishedResponse());
    });

    const saved = await publishSavedView({
      view: localView(),
      system: { id: 'document-1' } as TransitSystem,
      library: views.value,
      publishSystem,
      createPublication,
      updatePublication: vi.fn(),
      now: () => 200,
    });

    expect(order).toEqual(['system', 'view']);
    expect(createPublication).toHaveBeenCalledWith(
      {
        title: 'Downtown buses',
        sharedSystemId: 'share-1',
        state: presentation,
      },
      expect.any(Object),
    );
    expect(saved).toMatchObject({
      publishedId: 'published-1',
      sharedSystemId: 'share-1',
      editToken: 'view-token',
      updatedAt: 200,
    });
    expect(views.put).toHaveBeenCalledWith(saved);
  });

  it('updates the same public View when its shared-system reference is stable', async () => {
    const views = library();
    const response: GetViewResponse = {
      ...publishedResponse(),
    };
    const updatePublication = vi.fn(() => Promise.resolve(response));
    const createPublication = vi.fn();

    await publishSavedView({
      view: localView({
        publishedId: 'published-1',
        sharedSystemId: 'share-1',
        editToken: 'view-token',
      }),
      system: { id: 'document-1' } as TransitSystem,
      library: views.value,
      publishSystem: vi.fn(() =>
        Promise.resolve({ id: 'share-1', url: 'https://example.test/s/share-1' }),
      ),
      createPublication,
      updatePublication,
      now: () => 200,
    });

    expect(createPublication).not.toHaveBeenCalled();
    expect(updatePublication).toHaveBeenCalledWith(
      'published-1',
      'view-token',
      { title: 'Downtown buses', description: null, state: presentation },
      expect.any(Object),
    );
  });

  it('deletes the public resource before removing its local authority', async () => {
    const views = library();
    const order: string[] = [];
    const deletePublication = vi.fn(() => {
      order.push('public');
      return Promise.resolve();
    });
    views.delete.mockImplementation(() => {
      order.push('local');
      return Promise.resolve();
    });

    await deleteSavedView({
      view: localView({ publishedId: 'published-1', editToken: 'view-token' }),
      library: views.value,
      deletePublication,
    });

    expect(order).toEqual(['public', 'local']);
  });

  it('preserves the local record when public deletion fails', async () => {
    const views = library();

    await expect(
      deleteSavedView({
        view: localView({ publishedId: 'published-1', editToken: 'view-token' }),
        library: views.value,
        deletePublication: vi.fn(() => Promise.reject(new Error('offline'))),
      }),
    ).rejects.toThrow('offline');

    expect(views.delete).not.toHaveBeenCalled();
  });
});
