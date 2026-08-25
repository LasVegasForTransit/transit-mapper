// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Map as MLMap } from 'maplibre-gl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEditorStore } from '../../src/editor/store';
import { attachKeyboard } from '../../src/editor/keymap';
import { SimProvider, useSim } from '../../src/ui/SimProvider';

function SimulationProbe() {
  const { paused, speedId } = useSim();
  return <output data-paused={String(paused)} data-speed={speedId} />;
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false })),
  );
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root.render(
      <SimProvider>
        <SimulationProbe />
      </SimProvider>,
    ),
  );
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function keydown(key: string, options: KeyboardEventInit = {}, target: Window | Element = window) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...options }));
  });
}

describe('simulation keyboard ownership', () => {
  it('runs the simulation before the map keymap attaches', () => {
    expect(host.querySelector('output')?.dataset.paused).toBe('false');

    keydown('k');

    expect(host.querySelector('output')?.dataset.paused).toBe('true');
  });

  it('handles a simulation key exactly once after the map keymap attaches', () => {
    const detachMapKeyboard = attachKeyboard({
      map: {} as MLMap,
      editor: createEditorStore(),
      setPanKeyHeld: vi.fn(),
      openShortcuts: vi.fn(),
      toggleUi: vi.fn(),
    });

    keydown('k');

    expect(host.querySelector('output')?.dataset.paused).toBe('true');
    detachMapKeyboard();
  });

  it('ignores typing targets, modifiers, and held-key repeats', () => {
    const input = document.createElement('input');
    host.append(input);

    keydown('k', {}, input);
    keydown('k', { ctrlKey: true });
    keydown('k', { metaKey: true });
    keydown('k', { repeat: true });

    expect(host.querySelector('output')?.dataset.paused).toBe('false');
  });
});
