// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stepDetent } from '../src/sheet-handle';
import { Workbench, type WorkspaceState } from '../src/index';
import { matchMediaFor } from './support/media-environment.test';

let container: HTMLDivElement;
let root: Root;
let viewportHeight: number;
let viewportOffsetTop: number;
let viewportListeners: Record<string, Set<() => void>>;

const slot = (name: string) => <span data-slot={name}>{name}</span>;
const slots = {
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
};

function renderWorkbench(
  state: Partial<WorkspaceState> = {},
  actions: { onToggleInterface?: () => void; onDismissSupplemental?: () => void } = {},
): void {
  const nextState: WorkspaceState = {
    representationLabel: 'Network',
    hasSupplementalContent: false,
    initialSupplementalDetent: null,
    chromeHidden: false,
    contentStatus: 'ready',
    ...state,
  };
  act(() => {
    root.render(
      <Workbench
        slots={slots}
        state={nextState}
        actions={{
          onToggleInterface: actions.onToggleInterface ?? (() => {}),
          onDismissSupplemental: actions.onDismissSupplemental ?? (() => {}),
        }}
      />,
    );
  });
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: matchMediaFor({ narrow: true }),
  });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
  viewportHeight = 844;
  viewportOffsetTop = 0;
  viewportListeners = { resize: new Set(), scroll: new Set() };
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    value: {
      get height() {
        return viewportHeight;
      },
      get offsetTop() {
        return viewportOffsetTop;
      },
      addEventListener(type: string, listener: () => void) {
        viewportListeners[type].add(listener);
      },
      removeEventListener(type: string, listener: () => void) {
        viewportListeners[type].delete(listener);
      },
    },
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Workbench actions and state', () => {
  it('dismisses supplemental content through the injected action', () => {
    const onDismissSupplemental = vi.fn();
    renderWorkbench(
      { hasSupplementalContent: true, initialSupplementalDetent: 'half' },
      { onDismissSupplemental },
    );

    const back = container.querySelector<HTMLButtonElement>('.sheet-back');
    act(() => back?.click());

    expect(onDismissSupplemental).toHaveBeenCalledOnce();
  });

  it('uses the injected detent when supplemental content appears', () => {
    renderWorkbench();
    expect(container.querySelector('.compact-workbench')?.className).toContain('is-closed');

    renderWorkbench({ hasSupplementalContent: true, initialSupplementalDetent: 'half' });

    expect(container.querySelector('.compact-workbench')?.className).toContain('is-half');
  });

  it('keeps the sheet above the on-screen keyboard', () => {
    viewportHeight = 508;
    renderWorkbench();

    expect(container.querySelector<HTMLElement>('.compact-workbench')?.style.bottom).toBe('336px');
  });

  it('makes hidden compact chrome inert and leaves its restore action active', () => {
    const onToggleInterface = vi.fn();
    renderWorkbench({ chromeHidden: true }, { onToggleInterface });
    const sheet = container.querySelector<HTMLElement>('.compact-workbench');
    const restore = container.querySelector<HTMLButtonElement>('.zen-restore');

    expect(sheet?.inert).toBe(true);
    act(() => restore?.click());
    expect(onToggleInterface).toHaveBeenCalledOnce();
  });
});

describe('Workbench detents', () => {
  it('moves one stop per drag direction', () => {
    expect(stepDetent('closed', 1)).toBe('half');
    expect(stepDetent('half', 1)).toBe('full');
    expect(stepDetent('full', -1)).toBe('half');
    expect(stepDetent('half', -1)).toBe('closed');
  });

  it('clamps at both ends', () => {
    expect(stepDetent('closed', -1)).toBe('closed');
    expect(stepDetent('full', 1)).toBe('full');
  });
});
