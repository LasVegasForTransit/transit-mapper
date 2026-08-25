// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { aPattern, aRoad, aService, aStop, aSystem } from '@transitmapper/core/testing/fixtures';
import { EditorProvider } from '../../src/editor/EditorProvider';
import { createEditorStore, type EditorStore } from '../../src/editor/store';
import { SidebarPanel } from '../../src/ui/SidebarPanel';
import { ViewProvider, type DocumentRepresentationId } from '../../src/ui/ViewProvider';

let container: HTMLDivElement;
let root: Root;

function renderSidebar(store: EditorStore, viewMode: DocumentRepresentationId = 'network'): void {
  act(() => {
    root.render(
      <EditorProvider store={store}>
        <ViewProvider initialViewMode={viewMode}>
          <SidebarPanel />
        </ViewProvider>
      </EditorProvider>,
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

function search(value: string): void {
  const input = container.querySelector<HTMLInputElement>('input[type="search"]');
  if (!input) throw new Error('Expected a search field');
  act(() => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (!descriptor?.set) throw new Error('Expected the native value setter');
    descriptor.set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
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
});

describe('SidebarPanel interactions', () => {
  it('publishes row hover without changing durable selection', () => {
    const store = createEditorStore();
    store.commands.document.setSystem(aSystem({ services: [aService('red', [])] }));

    renderSidebar(store);
    const row = container.querySelector<HTMLButtonElement>('[data-sidebar-option]');
    if (!row) throw new Error('Expected a Line row');
    void act(() => row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));

    expect(store.getState().outlineHover).toEqual({ kind: 'line', id: 'red' });
    expect(store.getState().selection).toBeNull();

    void act(() => row.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })));
    expect(store.getState().outlineHover).toBeNull();
  });

  it('keeps one roving tab stop when a selected stop appears under a line and in Stops', () => {
    const west = aRoad('west', [
      [-115.2, 36.15],
      [-115.15, 36.15],
    ]);
    const east = aRoad('east', [
      [-115.15, 36.15],
      [-115.1, 36.15],
    ]);
    const hub = {
      ...aStop('hub', [-115.15, 36.15], { wayId: west.id, t: 1 }, { name: 'Hub' }),
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
      stops: [hub],
    });
    const store = createEditorStore();
    store.commands.document.setSystem(system);
    store.commands.selection.selectAndFocus({ kind: 'stop', id: hub.id });
    renderSidebar(store);
    const collapsedRows = [
      ...container.querySelectorAll<HTMLButtonElement>('[data-sidebar-option]'),
    ];
    expect(collapsedRows.filter((button) => button.tabIndex === 0)).toHaveLength(1);

    click(container.querySelector('button.sidebar-disclosure'));

    const stopRows = [
      ...container.querySelectorAll<HTMLButtonElement>('[data-sidebar-option]'),
    ].filter((button) => button.textContent.includes('Hub'));

    expect(stopRows.length).toBeGreaterThanOrEqual(2);
    expect(stopRows.filter((button) => button.tabIndex === 0)).toHaveLength(1);
  });

  it('wires row navigation and show-more behavior through the mounted workspace', () => {
    const services = Array.from({ length: 151 }, (_, index) =>
      aService(`line-${index}`, [], { name: `Line ${String(index).padStart(3, '0')}` }),
    );
    const store = createEditorStore();
    store.commands.document.setSystem(aSystem({ services }));
    renderSidebar(store);

    const initialRows = [...container.querySelectorAll<HTMLButtonElement>('[data-sidebar-option]')];
    expect(initialRows).toHaveLength(150);
    initialRows[0].focus();

    press(initialRows[0], 'ArrowDown');
    expect(document.activeElement).toBe(initialRows[1]);
    expect(store.getState().selection).toEqual({ kind: 'line', id: 'line-1' });

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
  }, 15_000);

  it('bounds large Infrastructure sections and expands only the requested collection', () => {
    const ways = Array.from({ length: 151 }, (_, index) =>
      aRoad(`road-${index}`, [
        [-115.2, 36.1 + index * 0.0001],
        [-115.1, 36.1 + index * 0.0001],
      ]),
    );
    const store = createEditorStore();
    store.commands.document.setSystem(
      aSystem({
        ways,
        namedWays: ways.map((way, index) => ({
          id: `road-name-${index}`,
          name: `Road ${index}`,
          wayIds: [way.id],
        })),
      }),
    );

    renderSidebar(store, 'infrastructure');

    expect(container.querySelectorAll('[data-sidebar-option]')).toHaveLength(150);
    click(
      [...container.querySelectorAll('button')].find(
        (button) => button.textContent === 'Show 1 more…',
      ),
    );
    expect(container.querySelectorAll('[data-sidebar-option]')).toHaveLength(151);
  });

  it('selects every segment represented by a named infrastructure row', () => {
    const west = aRoad('west', [
      [-115.2, 36.1],
      [-115.15, 36.1],
    ]);
    const east = aRoad('east', [
      [-115.15, 36.1],
      [-115.1, 36.1],
    ]);
    const store = createEditorStore();
    store.commands.document.setSystem(
      aSystem({
        ways: [west, east],
        namedWays: [{ id: 'main-street', name: 'Main Street', wayIds: [west.id, east.id] }],
      }),
    );

    renderSidebar(store, 'infrastructure');
    click(container.querySelector('[data-sidebar-option]'));

    expect(store.getState().selection).toEqual({
      kind: 'way',
      id: west.id,
      relatedIds: [west.id, east.id],
    });
  });

  it('opens a collapsed section for search and renders only matching Stop context', () => {
    const road = aRoad('road', [
      [-115.2, 36.1],
      [-115.1, 36.1],
    ]);
    const stops = Array.from({ length: 20 }, (_, index) =>
      aStop(
        `stop-${index}`,
        [-115.2 + index * 0.005, 36.1],
        { wayId: road.id, t: index / 20 },
        { name: index === 12 ? 'Needle' : `Haystack ${index}` },
      ),
    );
    const store = createEditorStore();
    store.commands.document.setSystem(
      aSystem({
        ways: [road],
        services: [aService('local', [aPattern('local', [road], [road.id])])],
        stops,
      }),
    );

    renderSidebar(store);
    for (const button of container.querySelectorAll('button.sidebar-section-head')) click(button);
    expect(container.textContent).not.toContain('Needle');

    search('Needle');

    expect(container.textContent).toContain('Needle');
    expect(container.textContent).not.toContain('Haystack');
  });

  it('keeps network search rendering within the outline row budget', () => {
    const road = aRoad('road', [
      [-115.2, 36.1],
      [-115.1, 36.1],
    ]);
    const stops = Array.from({ length: 200 }, (_, index) =>
      aStop(
        `stop-${index}`,
        [-115.2 + index * 0.0005, 36.1],
        { wayId: road.id, t: index / 200 },
        { name: `Match ${index}` },
      ),
    );
    const store = createEditorStore();
    store.commands.document.setSystem(
      aSystem({
        ways: [road],
        services: [aService('local', [aPattern('local', [road], [road.id])])],
        stops,
      }),
    );

    renderSidebar(store);
    search('Match');

    expect(container.querySelectorAll('[data-sidebar-option]').length).toBeLessThanOrEqual(150);
  });

  it('shares the search row budget across Infrastructure sections', () => {
    const ways = Array.from({ length: 151 }, (_, index) =>
      aRoad(`road-${index}`, [
        [-115.2, 36.1 + index * 0.0001],
        [-115.1, 36.1 + index * 0.0001],
      ]),
    );
    const store = createEditorStore();
    store.commands.document.setSystem(
      aSystem({
        ways,
        namedWays: ways.map((way, index) => ({
          id: `match-road-${index}`,
          name: `Match Road ${index}`,
          wayIds: [way.id],
        })),
        stops: [
          aStop(
            'match-stop',
            [-115.15, 36.1],
            { wayId: ways[0].id, t: 0.5 },
            { name: 'Match Stop' },
          ),
        ],
      }),
    );

    renderSidebar(store, 'infrastructure');
    search('Match');

    expect(container.querySelectorAll('[data-sidebar-option]').length).toBeLessThanOrEqual(150);
  });
});
