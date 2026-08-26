import { createEmptySystem } from '@transitmapper/core/model/serialize';
import { encodeMapViewState } from '@transitmapper/views';
import { describe, expect, it, vi } from 'vitest';
import { resolveSharedSystemSession } from '../../src/viewer/shared-system-session';
import { resolveViewerSession } from '../../src/viewer/viewer-session';

function sharedSystem() {
  return {
    ...createEmptySystem(),
    id: 'shared-document',
    name: 'Southern Nevada transit',
    viewport: { center: [-115.1728, 36.1147] as [number, number], zoom: 9 },
  };
}

describe('shared-system viewer sessions', () => {
  it('derives a synthetic View from the shared system viewport and document defaults', async () => {
    const system = sharedSystem();
    const fetchSharedSystem = vi.fn(() => Promise.resolve(system));
    const signal = new AbortController().signal;

    const session = await resolveSharedSystemSession('share-1', undefined, signal, {
      fetchSharedSystem,
    });

    expect(fetchSharedSystem).toHaveBeenCalledWith('share-1', { signal });
    expect(session.system).toBe(system);
    expect(session.state).toMatchObject({
      schemaVersion: 1,
      camera: system.viewport,
      representationId: 'network',
      filters: { landmarks: true },
    });
  });

  it('restores a valid transient View and clears unsupported map vocabulary', async () => {
    const state = encodeMapViewState({
      schemaVersion: 1,
      camera: { center: [-73.98, 40.75], zoom: 12 },
      representationId: 'infrastructure',
      filters: { modes: ['bus', 'not-a-mode'], unexpected: true },
      selection: { source: 'document', kind: 'station', id: 'station-1' },
    });

    const session = await resolveSharedSystemSession(
      'share-1',
      state,
      new AbortController().signal,
      { fetchSharedSystem: () => Promise.resolve(sharedSystem()) },
    );

    expect(session.state).toMatchObject({
      camera: { center: [-73.98, 40.75], zoom: 12 },
      representationId: 'infrastructure',
      filters: { modes: ['bus'] },
      selection: { source: 'document', kind: 'station', id: 'station-1' },
    });
    expect(session.state.filters).not.toHaveProperty('unexpected');
  });

  it('ignores an invalid transient fragment without blocking the shared system', async () => {
    const session = await resolveSharedSystemSession(
      'share-1',
      'not+base64',
      new AbortController().signal,
      { fetchSharedSystem: () => Promise.resolve(sharedSystem()) },
    );

    expect(session.state.camera).toEqual(sharedSystem().viewport);
    expect(session.state.representationId).toBe('network');
  });

  it('loads a published View and its referenced shared system through the same viewer session', async () => {
    const system = sharedSystem();
    const fetchPublishedView = vi.fn(() =>
      Promise.resolve({
        view: {
          schemaVersion: 1 as const,
          id: 'view-1',
          title: 'Buses across the valley',
          map: { kind: 'shared-system' as const, id: 'share-1' },
          state: {
            schemaVersion: 1 as const,
            camera: { center: [-115.2, 36.2] as [number, number], zoom: 10 },
            representationId: 'infrastructure',
            filters: { modes: ['bus'] },
          },
        },
        createdAt: 10,
        updatedAt: 20,
      }),
    );
    const fetchSharedSystem = vi.fn(() => Promise.resolve(system));
    const signal = new AbortController().signal;

    const session = await resolveViewerSession(
      { kind: 'published-view', viewId: 'view-1' },
      undefined,
      signal,
      { fetchPublishedView, fetchSharedSystem },
    );

    expect(fetchPublishedView).toHaveBeenCalledWith('view-1', { signal });
    expect(fetchSharedSystem).toHaveBeenCalledWith('share-1', { signal });
    expect(session).toMatchObject({
      system,
      title: 'Buses across the valley',
      state: {
        camera: { center: [-115.2, 36.2], zoom: 10 },
        representationId: 'infrastructure',
        filters: { modes: ['bus'] },
      },
    });
  });
});
