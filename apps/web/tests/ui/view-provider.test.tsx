// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMapViewStore } from '@transitmapper/map';
import { ViewProvider, useMapViewStore, useView } from '../../src/ui/ViewProvider';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('ViewProvider', () => {
  it('adapts the existing controls to one supplied map View store', () => {
    const store = createMapViewStore({
      schemaVersion: 1,
      camera: { center: [-115.1728, 36.1147], zoom: 11 },
      representationId: 'network',
      filters: {
        modes: ['bus', 'ferry'],
        'way-types': ['road', 'water'],
        landmarks: true,
      },
    });

    function Probe() {
      const view = useView();
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
          <button type="button" onClick={view.toggleLandmarks}>
            Hide landmarks
          </button>
        </>
      );
    }

    act(() => root.render(<ViewProvider store={store}>{<Probe />}</ViewProvider>));

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

  it('creates a private store with current defaults when none is supplied', () => {
    function Probe() {
      const view = useView();
      const store = useMapViewStore();
      return (
        <output>
          {view.viewMode}:{store.getSnapshot().camera.zoom}:
          {view.visibleModes.has('bus') ? 'bus' : ''}
        </output>
      );
    }

    act(() =>
      root.render(
        <ViewProvider initialViewMode="diagram">
          <Probe />
        </ViewProvider>,
      ),
    );

    expect(container.textContent).toBe('diagram:10.4:bus');
  });

  it('does not rerender View controls for a camera-only change', () => {
    const store = createMapViewStore({
      schemaVersion: 1,
      camera: { center: [-115.1728, 36.1147], zoom: 11 },
      representationId: 'network',
      filters: { modes: ['bus'], 'way-types': ['road'], landmarks: true },
    });
    let renders = 0;

    function Probe() {
      useView();
      renders += 1;
      return null;
    }

    act(() => root.render(<ViewProvider store={store}>{<Probe />}</ViewProvider>));
    expect(renders).toBe(1);

    act(() => store.setCamera({ center: [-115.16, 36.12], zoom: 12 }));

    expect(renders).toBe(1);
  });
});
