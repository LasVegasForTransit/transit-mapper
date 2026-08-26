// @vitest-environment jsdom

import { aStop, aSystem } from '@transitmapper/core/testing/fixtures';
import { decodeMapViewState } from '@transitmapper/views';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ViewerApplication, type ViewerSessionResolver } from '../../src/viewer/viewer-application';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  window.history.replaceState(null, '', '/');
  root = createRoot(container);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  Reflect.deleteProperty(document, 'execCommand');
  vi.unstubAllGlobals();
});

describe('ViewerApplication', () => {
  it('keeps the reader shell mounted while the shared View resolves', async () => {
    let finish: (() => void) | undefined;
    const system = aSystem({
      name: 'Regional transit plan',
      stops: [aStop('central', [-115.17, 36.14], undefined, { name: 'Central' })],
    });
    const resolveSession: ViewerSessionResolver = () =>
      new Promise((resolve) => {
        finish = () =>
          resolve({
            system,
            state: {
              schemaVersion: 1,
              camera: system.viewport,
              representationId: 'network',
              filters: { modes: [], 'way-types': [], landmarks: true },
              selection: { source: 'document', kind: 'stop', id: 'central' },
            },
          });
      });
    const renderMap = (): ReactNode => <div role="region" aria-label="Map" />;
    const onFork = vi.fn();
    const onCopy = vi.fn();

    act(() => {
      root.render(
        <ViewerApplication
          routeIntent={{ kind: 'shared-system', shareId: 'share-1' }}
          resolveSession={resolveSession}
          fragmentValue={undefined}
          renderMap={renderMap}
          onFork={onFork}
          onCopyLink={onCopy}
          resolveFeatureDetails={async (_system, reference) => ({
            reference,
            title: 'Central',
            fields: [],
          })}
        />,
      );
    });

    expect(container.querySelector('[data-workbench]')).not.toBeNull();
    expect(container.textContent).toContain('Opening shared map…');

    await act(async () => {
      finish?.();
      await Promise.resolve();
    });
    await act(async () => {
      await vi.waitFor(() => expect(container.textContent).toContain('Central'));
    });

    expect(container.textContent).toContain('Regional transit plan');
    expect(container.textContent).toContain('Fork & edit');
    expect(container.textContent).toContain('Copy link to this view');
    expect(container.textContent).toContain('Central');
    expect(container.textContent).not.toContain('Undo');
    expect(container.querySelector('[role="region"][aria-label="Map"]')).not.toBeNull();

    const forkButton = container.querySelector<HTMLButtonElement>(
      'button[data-viewer-action="fork"]',
    );
    const copyButton = container.querySelector<HTMLButtonElement>(
      'button[data-viewer-action="copy"]',
    );
    if (!forkButton || !copyButton) throw new Error('The reader actions did not render.');
    act(() => {
      forkButton.click();
      copyButton.click();
    });
    expect(onFork).toHaveBeenCalledWith(system);
    expect(onCopy).toHaveBeenCalledOnce();

    const closeButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Close details"]',
    );
    if (!closeButton) throw new Error('The reader details did not render.');
    act(() => closeButton.click());
    expect(container.textContent).not.toContain('Central');
  });

  it('shows a reader error without replacing the workspace', async () => {
    const resolveSession: ViewerSessionResolver = () => Promise.reject(new Error('missing'));

    await act(async () => {
      root.render(
        <ViewerApplication
          routeIntent={{ kind: 'shared-system', shareId: 'missing' }}
          resolveSession={resolveSession}
          fragmentValue={undefined}
          renderMap={() => null}
        />,
      );
      await Promise.resolve();
    });

    expect(container.querySelector('[data-workbench]')).not.toBeNull();
    expect(container.textContent).toContain('This shared system could not be opened.');
  });

  it('writes the current View state to the transient fragment', async () => {
    let finish: (() => void) | undefined;
    const system = aSystem({
      stops: [aStop('central', [-115.17, 36.14], undefined, { name: 'Central' })],
    });
    const resolveSession: ViewerSessionResolver = () =>
      new Promise((resolve) => {
        finish = () =>
          resolve({
            system,
            state: {
              schemaVersion: 1,
              camera: { center: [-115.17, 36.14], zoom: 11 },
              representationId: 'network',
              filters: {
                modes: ['bus'],
                'way-types': ['road'],
                landmarks: true,
              },
              selection: { source: 'document', kind: 'stop', id: 'central' },
            },
          });
      });

    act(() => {
      root.render(
        <ViewerApplication
          routeIntent={{ kind: 'shared-system', shareId: 'share-1' }}
          resolveSession={resolveSession}
          fragmentValue={undefined}
          renderMap={() => <div role="region" aria-label="Map" />}
          resolveFeatureDetails={async (_system, reference) => ({
            reference,
            title: 'Central',
            fields: [],
          })}
        />,
      );
    });
    await act(async () => {
      finish?.();
      await Promise.resolve();
    });

    const representation = container.querySelector<HTMLSelectElement>('select[aria-label="View"]');
    if (!representation) throw new Error('The representation control did not render.');
    act(() => {
      representation.value = 'infrastructure';
      representation.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(container.querySelector('.viewer-panel .panel-section-label')?.textContent).toBe(
      'Infrastructure',
    );

    const interfaceToggle = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Hide interface"]',
    );
    if (!interfaceToggle) throw new Error('The interface toggle did not render.');
    act(() => interfaceToggle.click());
    expect(container.querySelector('[data-zen="true"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Show interface"]')).not.toBeNull();

    expect(window.location.hash).toMatch(/^#view=/);
    expect(decodeMapViewState(window.location.hash.slice('#view='.length))).toEqual({
      schemaVersion: 1,
      camera: { center: [-115.17, 36.14], zoom: 11 },
      representationId: 'infrastructure',
      filters: {
        modes: ['bus'],
        'way-types': ['road'],
        landmarks: true,
      },
      selection: { source: 'document', kind: 'stop', id: 'central' },
    });

    await act(async () => {
      await vi.waitFor(() =>
        expect(container.querySelector('button[aria-label="Close details"]')).not.toBeNull(),
      );
    });

    const close = container.querySelector<HTMLButtonElement>('button[aria-label="Close details"]');
    if (!close) throw new Error('The selected feature details did not render.');
    act(() => close.click());

    expect(decodeMapViewState(window.location.hash.slice('#view='.length))).toEqual({
      schemaVersion: 1,
      camera: { center: [-115.17, 36.14], zoom: 11 },
      representationId: 'infrastructure',
      filters: {
        modes: ['bus'],
        'way-types': ['road'],
        landmarks: true,
      },
    });

    const writeText = vi.fn().mockRejectedValue(new DOMException('blocked', 'NotAllowedError'));
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const copy = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: copy });
    const copyButton = container.querySelector<HTMLButtonElement>(
      'button[data-viewer-action="copy"]',
    );
    if (!copyButton) throw new Error('The copy action did not render.');
    await act(async () => copyButton.click());
    expect(writeText).toHaveBeenCalledWith(window.location.href);
    expect(copy).toHaveBeenCalledWith('copy');
  });
});
