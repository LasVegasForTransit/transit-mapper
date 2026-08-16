// @vitest-environment jsdom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aSystem } from '@transitmapper/core/testing/fixtures';
import { EditorProvider } from '../../src/editor/EditorProvider';
import { createEditorStore, type EditorStore } from '../../src/editor/store';
import { FileMenu } from '../../src/ui/FileMenu';
import { TopBarBrand } from '../../src/ui/TopBar';

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

function renderWithEditor(children: ReactNode): void {
  act(() => {
    root.render(<EditorProvider store={store}>{children}</EditorProvider>);
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

  it('offers About and Privacy on a shared read-only system', () => {
    store.commands.document.setSystem(store.getState().system, { readOnly: true });
    renderWithEditor(<FileMenu />);
    openMenu();

    expect(document.body.textContent).toContain('About TransitMapper…');
    expect(document.querySelector('a[href="/privacy"]')?.textContent).toContain('Privacy');
    expect(document.body.textContent).not.toContain('New system');
    expect(document.body.textContent).not.toContain('My systems…');
    expect(document.body.textContent).not.toContain('Import streets…');
    expect(document.body.textContent).not.toContain('Export system data (.json)');
  });

  it('keeps the application menu mounted in the read-only brand row', () => {
    store.commands.document.setSystem(store.getState().system, { readOnly: true });
    renderWithEditor(<TopBarBrand />);

    expect(container.querySelector('button[aria-label="TransitMapper menu"]')).not.toBeNull();
    expect(container.textContent).toContain('Test system');
  });
});
