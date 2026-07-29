// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aPattern, aRoad, aService, aStation, aSystem } from '@transitmapper/core/testing/fixtures';
import type { EditorState } from '../editor/store';
import { createEditorStore } from '../editor/store';
import { SidebarPanel } from './SidebarPanel';
import { ViewProvider } from './ViewProvider';

const editorState = vi.hoisted(() => ({ current: null as EditorState | null }));

vi.mock('../editor/EditorProvider', () => ({
  useEditor: <T,>(selector: (state: EditorState) => T): T => {
    if (!editorState.current) throw new Error('Editor state was not initialized');
    return selector(editorState.current);
  },
}));

let container: HTMLDivElement;
let root: Root;

function renderSidebar(): void {
  act(() => {
    root.render(
      <ViewProvider>
        <SidebarPanel />
      </ViewProvider>,
    );
  });
}

function click(button: Element | null | undefined): void {
  if (!(button instanceof HTMLButtonElement)) throw new Error('Expected a button');
  act(() => button.click());
}

function press(button: HTMLButtonElement, key: string): void {
  act(() => {
    button.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key }));
  });
}

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
  editorState.current = null;
  vi.restoreAllMocks();
});

describe('SidebarPanel interactions', () => {
  it('keeps one roving tab stop when a selected station appears in multiple corridors', () => {
    const west = aRoad('west', [
      [-115.2, 36.15],
      [-115.15, 36.15],
    ]);
    const east = aRoad('east', [
      [-115.15, 36.15],
      [-115.1, 36.15],
    ]);
    const hub = {
      ...aStation('hub', [-115.15, 36.15], { wayId: west.id, t: 1 }, { name: 'Hub' }),
      anchors: [
        { wayId: west.id, t: 1 },
        { wayId: east.id, t: 0 },
      ],
    };
    const system = aSystem({
      ways: [west, east],
      namedWays: [
        { id: 'west-corridor', name: 'West Corridor', wayIds: [west.id] },
        { id: 'east-corridor', name: 'East Corridor', wayIds: [east.id] },
      ],
      services: [aService('cross-town', [aPattern('main', [west, east], [west.id, east.id])])],
      stations: [hub],
    });
    const store = createEditorStore();
    store.getState().setSystem(system);
    store.getState().selectAndFocus({ kind: 'station', id: hub.id });
    editorState.current = store.getState();

    renderSidebar();
    click(
      [...container.querySelectorAll('button')].find(
        (button) => button.textContent === 'Corridors',
      ),
    );

    const collapsedRows = [
      ...container.querySelectorAll<HTMLButtonElement>('[data-sidebar-option]'),
    ];
    expect(collapsedRows.filter((button) => button.tabIndex === 0)).toEqual([collapsedRows[0]]);

    click(container.querySelector('button[aria-label="Expand West Corridor"]'));
    click(container.querySelector('button[aria-label="Expand East Corridor"]'));

    const stationRows = [
      ...container.querySelectorAll<HTMLButtonElement>('[data-sidebar-option]'),
    ].filter((button) => button.textContent?.includes('Hub'));

    expect(stationRows).toHaveLength(2);
    expect(stationRows.filter((button) => button.tabIndex === 0)).toHaveLength(1);
  });

  it('wires row navigation and show-more behavior through the mounted workspace', () => {
    const services = Array.from({ length: 151 }, (_, index) =>
      aService(`line-${index}`, [], { name: `Line ${String(index).padStart(3, '0')}` }),
    );
    const store = createEditorStore();
    store.getState().setSystem(aSystem({ services }));
    editorState.current = store.getState();

    renderSidebar();

    const initialRows = [...container.querySelectorAll<HTMLButtonElement>('[data-sidebar-option]')];
    expect(initialRows).toHaveLength(150);
    initialRows[0].focus();

    press(initialRows[0], 'ArrowDown');
    expect(document.activeElement).toBe(initialRows[1]);
    expect(store.getState().selection).toEqual({ kind: 'service', id: 'line-1' });

    press(initialRows[1], 'End');
    expect(document.activeElement).toBe(initialRows[149]);

    press(initialRows[149], 'Home');
    expect(document.activeElement).toBe(initialRows[0]);

    click(
      [...container.querySelectorAll('button')].find(
        (button) => button.textContent === 'Show 1 more…',
      ),
    );
    expect(container.querySelectorAll('[data-sidebar-option]')).toHaveLength(151);
  });
});
