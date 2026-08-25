// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import * as workspace from '../src/index';
import { matchMediaFor } from './support/media-environment.test';

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return { ...actual, useLayoutEffect: actual.useEffect };
});

const { MapWorkspace } = workspace;

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

function renderMapWorkspace(narrow: boolean, chromeHidden = false): string {
  vi.stubGlobal('window', { matchMedia: matchMediaFor({ narrow }) });
  const slot = (name: string) => <span data-slot={name}>{name}</span>;
  return renderToStaticMarkup(
    <MapWorkspace
      mapSurface={<canvas data-slot="map" />}
      mapOverlay={slot('map-overlay')}
      slots={{
        brand: slot('brand'),
        primaryActions: slot('primary-actions'),
        representationControls: slot('representation-controls'),
        compactRepresentationControls: slot('compact-representation-controls'),
        simulationControls: slot('simulation-controls'),
        compactSimulationControls: slot('compact-simulation-controls'),
        mainPanel: slot('main-panel'),
        supplementalPanel: slot('supplemental-panel'),
        toolDock: slot('tool-dock'),
        importStatus: slot('import-status'),
        applicationNotices: {
          content: slot('application-notices'),
          placement: 'centered',
        },
      }}
      state={{
        representationLabel: 'Network',
        hasSupplementalContent: false,
        initialSupplementalDetent: null,
        chromeHidden,
        contentStatus: 'ready',
      }}
      actions={{ onToggleInterface: () => {}, onDismissSupplemental: () => {} }}
    />,
  );
}

function occurrences(markup: string, value: string): number {
  return markup.split(value).length - 1;
}

afterEach(() => vi.unstubAllGlobals());

describe('MapWorkspace composition', () => {
  it('keeps one map surface beside one Workbench tree', () => {
    const markup = renderMapWorkspace(false);

    expect(markup).toContain('class="app workspace-root"');
    expect(occurrences(markup, 'data-slot="map"')).toBe(1);
    expect(occurrences(markup, 'data-workbench')).toBe(1);
    expect(markup.indexOf('data-slot="map"')).toBeLessThan(markup.indexOf('data-workbench'));
  });

  it('keeps the map and application notices outside hidden chrome', () => {
    const markup = renderMapWorkspace(true, true);

    expect(markup).toContain('data-zen="true"');
    expect(markup).toContain('data-document-status="ready"');
    expect(occurrences(markup, 'data-slot="map"')).toBe(1);
    expect(occurrences(markup, 'data-slot="application-notices"')).toBe(1);
    expect(markup).toContain('workspace-application-notice is-centered');
    expect(markup.indexOf('data-slot="application-notices"')).toBeGreaterThan(
      markup.indexOf('data-workbench'),
    );
  });

  it('keeps a map-local overlay separate from Workbench slots', () => {
    const markup = renderMapWorkspace(false);
    const workbench = markup.slice(markup.indexOf('data-workbench'));

    expect(occurrences(markup, 'data-slot="map-overlay"')).toBe(1);
    expect(workbench).not.toContain('data-slot="map-overlay"');
  });

  it('preserves the exact canvas node while chrome visibility changes', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: matchMediaFor({ narrow: false }),
    });
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const container = document.createElement('div');
    const root = createRoot(container);
    const render = (chromeHidden: boolean) =>
      root.render(
        <MapWorkspace
          mapSurface={<canvas data-slot="map" />}
          slots={{
            brand: null,
            primaryActions: null,
            representationControls: null,
            compactRepresentationControls: null,
            simulationControls: null,
            compactSimulationControls: null,
            mainPanel: null,
            supplementalPanel: null,
            toolDock: null,
          }}
          state={{
            representationLabel: 'Network',
            hasSupplementalContent: false,
            initialSupplementalDetent: null,
            chromeHidden,
            contentStatus: 'ready',
          }}
          actions={{ onToggleInterface: () => {}, onDismissSupplemental: () => {} }}
        />,
      );

    act(() => render(false));
    const canvas = container.querySelector('canvas');
    act(() => render(true));

    expect(container.querySelector('canvas')).toBe(canvas);
    expect(container.querySelector('.app')?.getAttribute('data-zen')).toBe('true');
    act(() => root.unmount());
  });
});
