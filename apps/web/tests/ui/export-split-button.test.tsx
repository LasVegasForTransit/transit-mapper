// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aSystem } from '@transitmapper/core/testing/fixtures';
import { createMapViewStore } from '@transitmapper/map';
import { MapViewProvider } from '@transitmapper/workspace';
import { EditorProvider } from '../../src/editor/EditorProvider';
import { createDocumentPresentationState } from '../../src/editor/document-view-adapter';
import { createEditorStore, type EditorStore } from '../../src/editor/store';
import { ExportSplitButton } from '../../src/ui/ExportSplitButton';

const { exportFullSystemSvg } = vi.hoisted(() => ({ exportFullSystemSvg: vi.fn() }));

vi.mock('../../src/share/svgExport', () => ({ exportFullSystemSvg }));
vi.mock('../../src/share/pngExport', () => ({ exportFullSystemPng: vi.fn() }));
vi.mock('../../src/ui/UiProvider', () => ({ useUi: () => ({ openDialog: vi.fn() }) }));

let container: HTMLDivElement;
let root: Root;
let store: EditorStore;

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  store = createEditorStore();
  store.commands.document.setSystem(aSystem({ name: 'Las Vegas test' }));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe('Export split button', () => {
  it('starts a quick SVG export after the person selects it from the menu', async () => {
    act(() => {
      root.render(
        <EditorProvider store={store}>
          <MapViewProvider store={createMapViewStore(createDocumentPresentationState())}>
            <ExportSplitButton />
          </MapViewProvider>
        </EditorProvider>,
      );
    });
    const menuTrigger = container.querySelector('button[aria-label="Quick export options"]');
    if (!(menuTrigger instanceof HTMLButtonElement)) throw new Error('Expected quick export menu.');
    act(() => {
      menuTrigger.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, button: 0, ctrlKey: false }),
      );
      // Pointer intent starts the deferred export preload. Native popover
      // activation still follows the button's click, as it does for a person.
      menuTrigger.click();
    });
    const svgOption = [...document.querySelectorAll('[role="menuitem"]')].find(
      (item) => item.textContent === 'Export SVG',
    );
    if (!(svgOption instanceof HTMLElement)) throw new Error('Expected SVG export option.');

    act(() => svgOption.click());
    await vi.waitFor(() => expect(exportFullSystemSvg).toHaveBeenCalledOnce());

    expect(exportFullSystemSvg).toHaveBeenCalledWith(
      store.getState().system,
      expect.objectContaining({ viewMode: 'network' }),
      'Las Vegas test.svg',
    );
  });
});
