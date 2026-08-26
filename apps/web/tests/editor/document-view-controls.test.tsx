// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMapViewStore } from '@transitmapper/map';
import { MapViewProvider, useMapViewStore } from '@transitmapper/workspace';
import { useDocumentView } from '../../src/editor/document-view-controls';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function createViewStore() {
  return createMapViewStore({
    schemaVersion: 1,
    camera: { center: [-115.1728, 36.1147], zoom: 11 },
    representationId: 'network',
    filters: {
      modes: ['bus', 'ferry'],
      'way-types': ['road', 'water'],
      landmarks: true,
    },
  });
}

describe('document View controls', () => {
  it('adapts document controls to the workspace map View store', () => {
    const store = createViewStore();

    function Probe() {
      const view = useDocumentView();
      const suppliedStore = useMapViewStore();
      return (
        <>
          <output data-testid="representation">{view.viewMode}</output>
          <output data-testid="modes">{[...view.visibleModes].join(',')}</output>
          <output data-testid="store">{String(suppliedStore === store)}</output>
          <button type="button" onClick={() => view.setViewMode('infrastructure')}>
            Show infrastructure
          </button>
          <button type="button" onClick={() => view.toggleMode('bus')}>
            Hide bus
          </button>
          <button type="button" onClick={() => view.toggleLandmarks()}>
            Hide landmarks
          </button>
        </>
      );
    }

    act(() => root.render(<MapViewProvider store={store}>{<Probe />}</MapViewProvider>));

    expect(container.querySelector('[data-testid="representation"]')?.textContent).toBe('network');
    expect(container.querySelector('[data-testid="modes"]')?.textContent).toBe('bus,ferry');
    expect(container.querySelector('[data-testid="store"]')?.textContent).toBe('true');

    const buttons = container.querySelectorAll('button');
    act(() => {
      buttons[0].click();
      buttons[1].click();
      buttons[2].click();
    });

    expect(store.getSnapshot()).toEqual({
      schemaVersion: 1,
      camera: { center: [-115.1728, 36.1147], zoom: 11 },
      representationId: 'infrastructure',
      filters: {
        modes: ['ferry'],
        'way-types': ['road', 'water'],
        landmarks: false,
      },
    });
  });

  it('does not rerender document controls for a camera-only change', () => {
    const store = createViewStore();
    let renders = 0;

    function Probe() {
      useDocumentView();
      renders += 1;
      return null;
    }

    act(() => root.render(<MapViewProvider store={store}>{<Probe />}</MapViewProvider>));
    expect(renders).toBe(1);

    act(() => store.setCamera({ center: [-115.16, 36.12], zoom: 12 }));

    expect(renders).toBe(1);
  });
});
