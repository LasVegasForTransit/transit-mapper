// @vitest-environment jsdom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aRoad } from '@transitmapper/core/testing/fixtures';
import type { ImportedNetwork } from '@transitmapper/core/model/import';
import { EditorProvider } from '../../src/editor/EditorProvider';
import { createEditorStore, type EditorStore } from '../../src/editor/store';
import { NewSystemLocationDialog } from '../../src/ui/newSystem/NewSystemLocationDialog';

interface MockModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

vi.mock('../../src/ui/Modal', () => ({
  Modal: ({ title, children, footer }: MockModalProps) => (
    <section aria-label={title}>
      {children}
      {footer}
    </section>
  ),
}));

// The real LocationPickerMap owns an actual MapLibre instance — this stub
// exposes the same imperative handle (flyTo resolves immediately, getBounds
// returns a fixed box) without mounting one, the same way OnboardingDialog's
// test stubs OnboardingPreviewMap.
vi.mock('../../src/ui/newSystem/LocationPickerMap', () => ({
  LocationPickerMap: ({
    handleRef,
  }: {
    onPick: (center: [number, number]) => void;
    handleRef: { current: unknown };
  }) => {
    handleRef.current = {
      flyTo: () => Promise.resolve(),
      getBounds: () => ({ west: -115.3, south: 36.0, east: -115.1, north: 36.2 }),
    };
    return <div />;
  },
}));

vi.mock('../../src/storage/localStore', () => ({
  setActiveId: () => undefined,
}));

type ImportOsmNetwork = (typeof import('../../src/import/import-osm-network'))['importOsmNetwork'];

const importOsmNetworkMock = vi.fn<ImportOsmNetwork>();
vi.mock('../../src/import/import-osm-network', () => ({
  importOsmNetwork: (...args: Parameters<ImportOsmNetwork>) => importOsmNetworkMock(...args),
}));

const searchPlacesMock = vi.fn(
  (
    _query: string,
    _options?: unknown,
  ): Promise<{ label: string; center: [number, number]; countryCode?: string }[]> =>
    Promise.resolve([]),
);
vi.mock('@transitmapper/core/model/geocode', () => ({
  searchPlaces: (query: string, options?: unknown) => searchPlacesMock(query, options),
}));

let container: HTMLDivElement;
let root: Root;
let store: EditorStore;

function importedNetwork(): ImportedNetwork {
  return {
    ways: [
      aRoad('w1', [
        [-115.15, 36.1],
        [-115.14, 36.2],
      ]),
    ],
    nodes: [],
    namedWays: [],
    medians: [],
    turnRestrictions: [],
  };
}

function renderDialog(onClose: () => void): void {
  act(() => {
    root.render(
      <EditorProvider store={store}>
        <NewSystemLocationDialog onClose={onClose} mode="create" />
      </EditorProvider>,
    );
  });
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  store = createEditorStore();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

function findButton(label: string): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')].find((b) =>
    b.textContent.includes(label),
  );
  if (!button) throw new Error(`Expected a "${label}" button`);
  return button;
}

// Drives a real pick through the search flow (the only user-facing path this
// test can reach — the map itself is stubbed out): type a query, let the
// debounce elapse, click the one result it resolves to.
async function pickViaSearch(): Promise<void> {
  searchPlacesMock.mockResolvedValue([{ label: 'Las Vegas, NV', center: [-115.14, 36.17] }]);
  const input = container.querySelector('input');
  if (!input) throw new Error('Expected the search input');
  const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
  if (!descriptor?.set) throw new Error('Expected the native input value setter');
  act(() => {
    descriptor.set?.call(input, 'Las Vegas');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    vi.advanceTimersByTime(400);
    await Promise.resolve();
    await Promise.resolve();
  });
  const result = findButton('Las Vegas, NV');
  await act(async () => {
    result.click();
    await Promise.resolve();
  });
}

describe('NewSystemLocationDialog', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('creates and activates the system before the import is attempted, and imports afterward', async () => {
    let systemActiveWhenImportStarted: string | undefined;
    importOsmNetworkMock.mockImplementation(() => {
      systemActiveWhenImportStarted = store.getState().system.id;
      return Promise.resolve(importedNetwork());
    });
    const originalSystem = store.getState().system;
    const onClose = vi.fn();
    renderDialog(onClose);

    await pickViaSearch();

    const confirmBtn = findButton('Use this location');
    expect(confirmBtn.disabled).toBe(false);
    await act(async () => {
      confirmBtn.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // The system was created+activated before the OSM Worker ever ran — if
    // Overpass were down, this order is what leaves the user on a real,
    // correctly-centered system instead of stuck behind the dialog.
    expect(systemActiveWhenImportStarted).not.toBe(originalSystem.id);
    expect(systemActiveWhenImportStarted).toBe(store.getState().system.id);
    expect(store.getState().system.ways.map((way) => way.id)).toEqual(['w1']);
    expect(store.getState().tool).toBe('way');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('leaves a correctly-centered, usable system in place when the import fails', async () => {
    importOsmNetworkMock.mockRejectedValue(new Error('OSM import failed — no server answered.'));
    const originalSystem = store.getState().system;
    const onClose = vi.fn();
    renderDialog(onClose);

    await pickViaSearch();
    const confirmBtn = findButton('Use this location');
    await act(async () => {
      confirmBtn.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // The system still got created and activated even though the import
    // itself failed — the dialog stays open (onClose not called) so the
    // user can retry, but they are not stuck on a blank, uninitialized app.
    expect(store.getState().system.id).not.toBe(originalSystem.id);
    expect(store.getState().system.viewport).toEqual({ center: [-115.14, 36.17], zoom: 16 });
    expect(store.getState().system.ways).toEqual([]);
    expect(onClose).not.toHaveBeenCalled();
    expect(container.textContent).toContain('OSM import failed');
  });

  it('lets a blank canvas skip stand in for a failed or declined import', () => {
    const originalSystem = store.getState().system;
    const onClose = vi.fn();
    renderDialog(onClose);

    const skipBtn = [...container.querySelectorAll('button')].find((b) =>
      b.textContent.includes('Continue with a blank canvas'),
    );
    if (!skipBtn) throw new Error('Expected the skip button');
    act(() => skipBtn.click());

    expect(store.getState().system.id).not.toBe(originalSystem.id);
    expect(store.getState().tool).toBe('way');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(importOsmNetworkMock).not.toHaveBeenCalled();
  });
});
