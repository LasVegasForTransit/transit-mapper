// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileMenu } from '../../src/ui/FileMenu';
import { TopBarBrand } from '../../src/ui/TopBar';

const state = vi.hoisted(() => ({ readOnly: false }));

vi.mock('../../src/editor/EditorProvider', () => ({
  useEditor: <T,>(selector: (editor: Record<string, unknown>) => T): T =>
    selector({
      readOnly: state.readOnly,
      system: { name: 'Test system' },
      setName: () => undefined,
    }),
  useEditorStore: () => ({ getState: () => ({ system: {} }) }),
}));

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

function openMenu(): void {
  const trigger = container.querySelector('button');
  if (!(trigger instanceof HTMLButtonElement)) throw new Error('Expected menu trigger');
  act(() => {
    trigger.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, button: 0, ctrlKey: false }),
    );
  });
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  state.readOnly = false;
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
  it('keeps file actions and adds About while editing', () => {
    act(() => root.render(<FileMenu />));
    openMenu();

    expect(document.body.textContent).toContain('New system');
    expect(document.body.textContent).toContain('My systems…');
    expect(document.body.textContent).toContain('Import streets…');
    expect(document.body.textContent).toContain('Export system data (.json)');
    expect(document.body.textContent).toContain('About TransitMapper…');
  });

  it('offers only About on a shared read-only system', () => {
    state.readOnly = true;
    act(() => root.render(<FileMenu />));
    openMenu();

    expect(document.body.textContent).toContain('About TransitMapper…');
    expect(document.body.textContent).not.toContain('New system');
    expect(document.body.textContent).not.toContain('My systems…');
    expect(document.body.textContent).not.toContain('Import streets…');
    expect(document.body.textContent).not.toContain('Export system data (.json)');
  });

  it('keeps the application menu mounted in the read-only brand row', () => {
    state.readOnly = true;
    act(() => root.render(<TopBarBrand />));

    expect(container.querySelector('button[aria-label="TransitMapper menu"]')).not.toBeNull();
  });
});
