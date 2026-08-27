// @vitest-environment jsdom

import { createEmptySystem } from '@transitmapper/core/model/serialize';
import type { TransitSystem } from '@transitmapper/core/model/system';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SystemsDialog } from '../../src/ui/SystemsDialog';
import type { LibraryEntry, SaveOutcome } from '../../src/storage/browserLibrary';

const state = vi.hoisted(() => ({
  currentId: 'current-system',
  currentName: 'Current system',
  setName: vi.fn(),
  setSystem: vi.fn(),
  setActiveId: vi.fn(),
  openNewSystemLocation: vi.fn(),
  listLibrary: vi.fn(),
  loadSystemEntry: vi.fn(),
  saveToLibrary: vi.fn(),
  deleteFromLibrary: vi.fn(),
  getMyShare: vi.fn(),
  stopSharing: vi.fn(),
  loadSystemPreviews: vi.fn(),
}));

vi.mock('../../src/editor/EditorProvider', () => ({
  useEditor: <T,>(selector: (editor: Record<string, unknown>) => T): T =>
    selector({
      system: { id: state.currentId, name: state.currentName },
    }),
  useEditorCommands: () => ({
    document: {
      setName: state.setName,
      setSystem: state.setSystem,
    },
  }),
}));

vi.mock('../../src/ui/UiProvider', () => ({
  useUi: () => ({ openNewSystemLocation: state.openNewSystemLocation }),
}));

vi.mock('../../src/storage/browserLibrary', () => ({
  listLibrary: state.listLibrary,
  loadSystemEntry: state.loadSystemEntry,
  saveToLibrary: state.saveToLibrary,
  deleteFromLibrary: state.deleteFromLibrary,
}));

vi.mock('../../src/storage/localStore', () => ({
  setActiveId: state.setActiveId,
}));

vi.mock('../../src/share/myShares', () => ({
  getMyShare: state.getMyShare,
}));

vi.mock('../../src/share/api', () => ({
  stopSharing: state.stopSharing,
}));

vi.mock('../../src/ui/system-previews', () => ({
  loadSystemPreviews: state.loadSystemPreviews,
}));

const currentEntry: LibraryEntry = {
  id: 'current-system',
  name: 'Current system',
  updatedAt: 2,
};
const savedEntry: LibraryEntry = {
  id: 'saved-system',
  name: 'Saved system',
  updatedAt: 1,
};

let container: HTMLDivElement;
let root: Root;
let onClose: ReturnType<typeof vi.fn<() => void>>;
let onCorrupt: ReturnType<typeof vi.fn<() => void>>;
let flushPendingSave: ReturnType<typeof vi.fn<() => Promise<SaveOutcome>>>;
let recordSaveOutcome: ReturnType<typeof vi.fn<(id: string, outcome: SaveOutcome) => void>>;
let discardPendingSave: ReturnType<typeof vi.fn<(id: string) => void>>;

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function buttonNamed(name: string): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
  if (!button) throw new Error(`Expected button named "${name}"`);
  return button;
}

async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.click();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderDialog(): Promise<void> {
  act(() => {
    root.render(
      <SystemsDialog
        onClose={onClose}
        onCorrupt={onCorrupt}
        flushPendingSave={flushPendingSave}
        recordSaveOutcome={recordSaveOutcome}
        discardPendingSave={discardPendingSave}
      />,
    );
  });
  await settle();
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  vi.clearAllMocks();
  state.currentId = currentEntry.id;
  state.currentName = currentEntry.name;
  state.listLibrary.mockResolvedValue({
    status: 'ok',
    entries: [currentEntry, savedEntry],
    source: 'complete',
  });
  state.loadSystemEntry.mockImplementation((id: string) =>
    Promise.resolve({
      status: 'ok',
      system: { ...createEmptySystem(), id, name: id === savedEntry.id ? savedEntry.name : '' },
    }),
  );
  state.saveToLibrary.mockResolvedValue('saved');
  state.deleteFromLibrary.mockResolvedValue('saved');
  state.getMyShare.mockReturnValue(null);
  state.stopSharing.mockResolvedValue(undefined);
  state.loadSystemPreviews.mockResolvedValue(undefined);
  onClose = vi.fn();
  onCorrupt = vi.fn();
  flushPendingSave = vi.fn(() => Promise.resolve('saved' as const));
  recordSaveOutcome = vi.fn();
  discardPendingSave = vi.fn();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.replaceChildren();
});

describe('My systems dialog', () => {
  it('labels opening as a visible primary action', async () => {
    await renderDialog();

    expect(buttonNamed('Open Saved system').textContent).toContain('Open');
    expect(document.body.textContent).toContain('Current');
  });

  it('flushes the current system before loading and opening another system', async () => {
    const order: string[] = [];
    flushPendingSave.mockImplementation(() => {
      order.push('flush');
      return Promise.resolve('saved');
    });
    const savedSystem = { ...createEmptySystem(), id: savedEntry.id, name: savedEntry.name };
    state.loadSystemEntry.mockImplementation(() => {
      order.push('load');
      return Promise.resolve({ status: 'ok', system: savedSystem });
    });
    await renderDialog();

    await click(buttonNamed('Open Saved system'));

    expect(order).toEqual(['flush', 'load']);
    expect(state.setActiveId).toHaveBeenCalledWith(savedSystem.id);
    expect(state.setSystem).toHaveBeenCalledWith(savedSystem);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps the current system open when its pending save is not durable', async () => {
    flushPendingSave.mockResolvedValue('full');
    await renderDialog();

    await click(buttonNamed('Open Saved system'));

    expect(state.loadSystemEntry).not.toHaveBeenCalled();
    expect(state.setSystem).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(buttonNamed('Delete Saved system').disabled).toBe(false);
  });

  it('does not reopen the current system', async () => {
    await renderDialog();

    const current = buttonNamed('Current system');
    expect(current.disabled).toBe(true);
    expect(current.closest('li')?.getAttribute('aria-current')).toBe('true');
  });

  it('does not race a second request while a switch is pending', async () => {
    let finishFlush: ((outcome: SaveOutcome) => void) | undefined;
    flushPendingSave.mockImplementation(
      () =>
        new Promise<SaveOutcome>((resolve) => {
          finishFlush = resolve;
        }),
    );
    await renderDialog();
    const open = buttonNamed('Open Saved system');

    await act(async () => {
      open.click();
      open.click();
      await Promise.resolve();
    });

    expect(flushPendingSave).toHaveBeenCalledOnce();
    finishFlush?.('saved');
    await settle();
  });

  it('reports a corrupt system and leaves the dialog open', async () => {
    state.loadSystemEntry.mockResolvedValue({ status: 'corrupt' });
    await renderDialog();

    await click(buttonNamed('Open Saved system'));

    expect(onCorrupt).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('refreshes a missing system out of the library', async () => {
    state.loadSystemEntry.mockResolvedValue({ status: 'missing' });
    await renderDialog();

    await click(buttonNamed('Open Saved system'));

    expect(state.listLibrary).toHaveBeenCalledTimes(2);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps retry available when opening cannot reach storage', async () => {
    state.loadSystemEntry.mockResolvedValue({ status: 'unavailable' });
    await renderDialog();

    await click(buttonNamed('Open Saved system'));

    expect(document.body.textContent).toContain('Saved systems are temporarily unavailable.');
    expect(document.body.textContent).toContain('Try again');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('duplicates a saved system and refreshes the library', async () => {
    await renderDialog();

    await click(buttonNamed('Duplicate Saved system'));

    expect(state.saveToLibrary).toHaveBeenCalledOnce();
    const duplicate = state.saveToLibrary.mock.calls.at(0)?.at(0) as TransitSystem | undefined;
    expect(duplicate?.id).not.toBe(savedEntry.id);
    expect(recordSaveOutcome).toHaveBeenCalledWith(duplicate?.id, 'saved');
    expect(state.listLibrary).toHaveBeenCalledTimes(2);
  });

  it('flushes before deleting and discards pending recovery state', async () => {
    const order: string[] = [];
    flushPendingSave.mockImplementation(() => {
      order.push('flush');
      return Promise.resolve('saved');
    });
    state.deleteFromLibrary.mockImplementation(() => {
      order.push('delete');
      return Promise.resolve('saved');
    });
    discardPendingSave.mockImplementation(() => order.push('discard'));
    await renderDialog();

    await click(buttonNamed('Delete Saved system'));
    const confirm = document.querySelector<HTMLButtonElement>('.systems-confirm .danger-btn');
    if (!confirm) throw new Error('Expected the inline delete confirmation');
    await click(confirm);

    expect(order).toEqual(['flush', 'delete', 'discard']);
    expect(state.deleteFromLibrary).toHaveBeenCalledWith(savedEntry.id);
    expect(state.listLibrary).toHaveBeenCalledTimes(2);
  });

  it('shows the same Open action in list and card views and remembers the choice', async () => {
    await renderDialog();
    expect(buttonNamed('Cards view').getAttribute('aria-pressed')).toBe('true');

    await click(buttonNamed('List view'));

    expect(buttonNamed('Open Saved system')).not.toBeNull();
    expect(buttonNamed('List view').getAttribute('aria-pressed')).toBe('true');
    act(() => root.unmount());
    root = createRoot(container);
    await renderDialog();
    expect(buttonNamed('List view').getAttribute('aria-pressed')).toBe('true');
  });

  it('renders a local map preview for each card', async () => {
    state.loadSystemPreviews.mockImplementation(
      ({
        ids,
        onPreview,
      }: {
        ids: string[];
        onPreview: (id: string, preview: unknown) => void;
      }) => {
        for (const id of ids) {
          onPreview(id, { status: 'ready', svg: `<svg data-system="${id}" />` });
        }
        return Promise.resolve();
      },
    );

    await renderDialog();

    expect(document.querySelector('img[alt="Map preview of Saved system"]')).not.toBeNull();
    expect(buttonNamed('Open map preview of Saved system')).not.toBeNull();
  });

  it('keeps Open and Delete reachable when a preview is unavailable', async () => {
    state.loadSystemPreviews.mockImplementation(
      ({
        ids,
        onPreview,
      }: {
        ids: string[];
        onPreview: (id: string, preview: unknown) => void;
      }) => {
        for (const id of ids) onPreview(id, { status: 'unavailable' });
        return Promise.resolve();
      },
    );

    await renderDialog();

    expect(document.body.textContent).toContain('Preview unavailable');
    expect(buttonNamed('Open Saved system').disabled).toBe(false);
    expect(buttonNamed('Delete Saved system').disabled).toBe(false);
  });

  it('does not load map previews in list view', async () => {
    localStorage.setItem('transitmapper:systemsView', 'list');

    await renderDialog();

    expect(state.loadSystemPreviews).not.toHaveBeenCalled();
    expect(document.querySelector('.systems-preview')).toBeNull();
  });
});
