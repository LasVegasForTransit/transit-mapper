import { aSystem } from '@transitmapper/core/testing/fixtures';
import type { DocumentMapSceneAccepted, DocumentMapSession } from '@transitmapper/renderer/driver';
import { describe, expect, it, vi } from 'vitest';
import { attachDocumentMapPaintProof } from '../../src/map/document-map-paint-proof';

describe('document map paint proof', () => {
  it('publishes paint only after an accepted document reaches a rendered source', () => {
    const renderListeners = new Set<() => void>();
    const acceptedListeners = new Set<(event: DocumentMapSceneAccepted) => void>();
    const source = {};
    const map = {
      on: vi.fn((type: string, listener: () => void) => {
        if (type === 'render') renderListeners.add(listener);
      }),
      off: vi.fn((type: string, listener: () => void) => {
        if (type === 'render') renderListeners.delete(listener);
      }),
      getSource: vi.fn(() => source),
      isSourceLoaded: vi.fn(() => true),
      triggerRepaint: vi.fn(),
    };
    const session = {
      map,
      renderer: { activeSourceId: vi.fn(() => 'document-stations--bank-a') },
      subscribeAcceptedScene(listener: (event: DocumentMapSceneAccepted) => void) {
        acceptedListeners.add(listener);
        return () => acceptedListeners.delete(listener);
      },
    } as unknown as DocumentMapSession;
    const markPaint = vi.fn();
    const system = aSystem({ id: 'visible-system' });
    const detach = attachDocumentMapPaintProof({
      session,
      currentDocumentId: () => system.id,
      markPaint,
    });

    for (const listener of acceptedListeners) {
      listener({ snapshot: { status: 'ready', system }, update: {} } as DocumentMapSceneAccepted);
    }
    expect(map.triggerRepaint).toHaveBeenCalledOnce();
    expect(markPaint).not.toHaveBeenCalled();

    for (const listener of renderListeners) listener();
    expect(markPaint).toHaveBeenCalledOnce();

    for (const listener of renderListeners) listener();
    expect(markPaint).toHaveBeenCalledOnce();

    detach();
    expect(renderListeners).toHaveLength(0);
    expect(acceptedListeners).toHaveLength(0);
  });
});
