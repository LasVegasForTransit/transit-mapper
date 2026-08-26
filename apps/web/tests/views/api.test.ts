import { describe, expect, it, vi } from 'vitest';
import type { CreateViewResponse, GetViewResponse } from '@transitmapper/views';
import {
  createPublishedView,
  deletePublishedView,
  fetchPublishedView,
  updatePublishedView,
} from '../../src/views/api';

const state = {
  schemaVersion: 1 as const,
  camera: { center: [-115.17, 36.14] as [number, number], zoom: 11 },
  representationId: 'network',
  filters: { modes: ['bus'] },
};

const response: GetViewResponse = {
  view: {
    schemaVersion: 1,
    id: 'view-1',
    title: 'Downtown buses',
    map: { kind: 'shared-system', id: 'share-1' },
    state,
  },
  createdAt: 100,
  updatedAt: 100,
};

describe('published View client', () => {
  it('creates a View from the portable request contract', async () => {
    const created: CreateViewResponse = { ...response, editToken: 'secret' };
    const fetcher = vi.fn(() =>
      Promise.resolve(Response.json(created, { status: 201 })),
    ) as typeof fetch;

    await expect(
      createPublishedView(
        { title: 'Downtown buses', sharedSystemId: 'share-1', state },
        { fetcher },
      ),
    ).resolves.toEqual(created);

    expect(fetcher).toHaveBeenCalledWith(
      '/api/v1/views',
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Downtown buses', sharedSystemId: 'share-1', state }),
      }),
    );
  });

  it('loads a public View without an ownership token', async () => {
    const fetcher = vi.fn(() => Promise.resolve(Response.json(response))) as typeof fetch;

    await expect(fetchPublishedView('view/1', { fetcher })).resolves.toEqual(response);
    expect(fetcher).toHaveBeenCalledWith('/api/v1/views/view%2F1', expect.any(Object));
  });

  it('sends the edit token in the header for updates and deletion', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ...response, updatedAt: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 })) as typeof fetch;

    await updatePublishedView('view-1', 'secret', { title: 'The Strip' }, { fetcher });
    await deletePublishedView('view-1', 'secret', { fetcher });

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      '/api/v1/views/view-1',
      expect.objectContaining({
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-edit-token': 'secret' },
        body: JSON.stringify({ title: 'The Strip' }),
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      '/api/v1/views/view-1',
      expect.objectContaining({ method: 'DELETE', headers: { 'x-edit-token': 'secret' } }),
    );
  });

  it('treats an already deleted View as deleted', async () => {
    const fetcher = vi.fn(() =>
      Promise.resolve(new Response(null, { status: 404 })),
    ) as typeof fetch;

    await expect(deletePublishedView('missing', 'secret', { fetcher })).resolves.toBeUndefined();
  });

  it('reports the Worker error without hiding its status', async () => {
    const fetcher = vi.fn(() =>
      Promise.resolve(Response.json({ error: 'Shared system not found' }, { status: 404 })),
    ) as typeof fetch;

    await expect(fetchPublishedView('missing', { fetcher })).rejects.toThrow(
      'Could not load the View (404): Shared system not found',
    );
  });
});
