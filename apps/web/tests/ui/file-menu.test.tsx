// @vitest-environment jsdom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aSystem } from '@transitmapper/core/testing/fixtures';
import { createMapViewStore, type MapViewStore } from '@transitmapper/map';
import { MapViewProvider } from '@transitmapper/workspace';
import { EditorProvider } from '../../src/editor/EditorProvider';
import { createDocumentPresentationState } from '@transitmapper/renderer/presentation';
import { createEditorStore, type EditorStore } from '../../src/editor/store';
import { FileMenu } from '../../src/ui/FileMenu';

const { exportSystemJson } = vi.hoisted(() => ({ exportSystemJson: vi.fn() }));

vi.mock('../../src/share/jsonExport', () => ({ exportSystemJson }));

vi.mock('../../src/ui/UiProvider', () => ({
  useUi: () => ({
    openDialog: () => undefined,
    openNewSystemLocation: () => undefined,
    uiHidden: false,
    toggleUi: () => undefined,
  }),
}));

let container: HTMLDivElement;
let root: Root;
let store: EditorStore;
let mapViewStore: MapViewStore;

function renderWithEditor(children: ReactNode): void {
  act(() => {
    root.render(
      <EditorProvider store={store}>
        <MapViewProvider store={mapViewStore}>{children}</MapViewProvider>
      </EditorProvider>,
    );
  });
}

function openMenu(): void {
  const trigger = container.querySelector('button');
  if (!(trigger instanceof HTMLButtonElement)) throw new Error('Expected menu trigger');
  act(() => trigger.click());
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  store = createEditorStore();
  store.commands.document.setSystem(aSystem({ name: 'Test system' }));
  mapViewStore = createMapViewStore(
    createDocumentPresentationState({ camera: store.getState().system.viewport }),
  );
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe('File menu', () => {
  it('keeps file actions and adds About and Privacy while editing', () => {
    renderWithEditor(<FileMenu />);
    openMenu();

    expect(document.body.textContent).toContain('New system');
    expect(document.body.textContent).toContain('My systems…');
    expect(document.body.textContent).toContain('Import streets…');
    expect(document.body.textContent).toContain('Export system data (.json)');
    expect(document.body.textContent).toContain('About TransitMapper…');
    expect(document.querySelector('a[href="/privacy"]')?.textContent).toContain('Privacy');
  });

  it('exports the current map camera without mutating the editor document', () => {
    const original = store.getState().system;
    mapViewStore.setCamera({ center: [-73.9857, 40.7484], zoom: 13 });
    renderWithEditor(<FileMenu />);
    openMenu();
    const exportItem = [...document.querySelectorAll('[role="menuitem"]')].find((item) =>
      item.textContent.includes('Export system data'),
    );
    if (!(exportItem instanceof HTMLElement)) throw new Error('Expected export item');

    act(() => exportItem.click());

    expect(exportSystemJson).toHaveBeenCalledWith(
      expect.objectContaining({ viewport: { center: [-73.9857, 40.7484], zoom: 13 } }),
    );
    expect(store.getState().system).toBe(original);
  });
});
