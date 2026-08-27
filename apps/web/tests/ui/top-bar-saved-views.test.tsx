// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TopBarActions } from '../../src/ui/TopBar';
import { UiProvider, useUi } from '../../src/ui/UiProvider';

vi.mock('../../src/editor/EditorProvider', () => ({
  useEditor: <T,>(selector: (state: Record<string, unknown>) => T): T =>
    selector({ canUndo: false, canRedo: false }),
  useEditorStore: () => ({ getState: () => ({ system: { id: 'document-1' } }) }),
  useEditorCommands: () => ({
    document: { setSystem: vi.fn() },
    history: { undo: vi.fn(), redo: vi.fn() },
  }),
}));

vi.mock('../../src/ui/LayersPopover', () => ({ LayersPopover: () => null }));
vi.mock('../../src/ui/DrivingSidePopover', () => ({ DrivingSidePopover: () => null }));
vi.mock('../../src/ui/ExportSplitButton', () => ({ ExportSplitButton: () => null }));

function DialogProbe() {
  return <output aria-label="Active dialog">{useUi().activeDialog ?? 'none'}</output>;
}

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
  act(() => {
    root.render(
      <UiProvider>
        <TopBarActions />
        <DialogProbe />
      </UiProvider>,
    );
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('Saved views editor action', () => {
  it('opens the app-level Saved views dialog slot', () => {
    const button = [...container.querySelectorAll('button')].find(
      (candidate) => candidate.textContent.trim() === 'Saved views',
    );
    if (!button) throw new Error('Expected the Saved views action.');

    act(() => button.click());

    expect(container.querySelector('output')?.textContent).toBe('savedViews');
  });
});
