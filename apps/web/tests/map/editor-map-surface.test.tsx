// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  createMapViewStore,
  createSelectionController,
  type MapDriver,
  type MapDriverAttachment,
  type MapRuntime,
} from '@transitmapper/map';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDocumentPresentationState } from '../../src/editor/document-view-adapter';
import { EditorMapSurfaceFrame } from '../../src/map/editor-map-surface';

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function testRuntime(panBy: () => void, dispose: () => void = vi.fn()): MapRuntime<'light'> {
  return {
    host: {
      map: { panBy } as never,
      reportError: vi.fn(),
    },
    map: { panBy } as never,
    milestones: {
      contentCommitted: vi.fn(),
      interactive: vi.fn(),
    },
    requestTheme: vi.fn(() => Promise.resolve()),
    flushTheme: vi.fn(() => Promise.resolve()),
    refreshPadding: vi.fn(),
    dispose,
  };
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe('the editor map surface', () => {
  it('publishes a responsive map before document attachment resolves', async () => {
    const attachment = deferred<MapDriverAttachment>();
    const attach = vi.fn(() => attachment.promise);
    const driver: MapDriver = {
      definition: {
        id: 'document',
        title: 'Document',
        representations: [],
        filters: [],
        attribution: [],
      },
      attach,
    };
    const panBy = vi.fn();
    const runtime = testRuntime(panBy);
    let startAttachment: (() => void) | undefined;

    act(() => {
      root.render(
        <EditorMapSurfaceFrame
          contentIdentity="document"
          driver={driver}
          selection={createSelectionController()}
          viewStore={createMapViewStore(createDocumentPresentationState())}
          theme="light"
          createRuntime={() => runtime}
          scheduleAttachment={(start) => {
            startAttachment = start;
            return () => {};
          }}
        />,
      );
    });

    expect(host.querySelector('.workspace-map-surface')).not.toBeNull();
    expect(host.querySelector('[role="status"]')).toBeNull();
    expect(attach).not.toHaveBeenCalled();

    runtime.map.panBy([40, 0]);
    expect(panBy).toHaveBeenCalledExactlyOnceWith([40, 0]);

    await act(async () => {
      startAttachment?.();
      await Promise.resolve();
    });
    expect(attach).toHaveBeenCalledOnce();
  });

  it('disposes an attachment that resolves after the editor unmounts', async () => {
    const attachment = deferred<MapDriverAttachment>();
    const lateDispose = vi.fn();
    const driver: MapDriver = {
      definition: {
        id: 'document',
        title: 'Document',
        representations: [],
        filters: [],
        attribution: [],
      },
      attach: () => attachment.promise,
    };
    const disposeRuntime = vi.fn();
    const runtime = testRuntime(vi.fn(), disposeRuntime);

    await act(async () => {
      root.render(
        <EditorMapSurfaceFrame
          contentIdentity="document"
          driver={driver}
          selection={createSelectionController()}
          viewStore={createMapViewStore(createDocumentPresentationState())}
          theme="light"
          createRuntime={() => runtime}
          scheduleAttachment={(start) => {
            start();
            return () => {};
          }}
        />,
      );
      await Promise.resolve();
    });

    act(() => root.unmount());
    await act(async () => {
      attachment.resolve({ resolveFeature: () => Promise.resolve(null), dispose: lateDispose });
      await attachment.promise;
    });

    expect(lateDispose).toHaveBeenCalledOnce();
    expect(disposeRuntime).toHaveBeenCalledOnce();
  });
});
