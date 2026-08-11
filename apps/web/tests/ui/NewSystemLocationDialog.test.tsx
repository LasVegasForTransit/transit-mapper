// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { NewSystemLocationDialog } from '../../src/ui/newSystem/NewSystemLocationDialog';

interface MockModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

interface MockImportedNetworkRequest {
  network: unknown;
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

const calls: { setSystem: unknown[]; importWays: unknown[]; setTool: unknown[] } = {
  setSystem: [],
  importWays: [],
  setTool: [],
};
let mockSystem: { id: string; drivingSide: string; viewport?: unknown } = {
  id: 'existing',
  drivingSide: 'right',
};

vi.mock('../../src/editor/EditorProvider', () => ({
  useEditor: <Value,>(selector: (state: { system: typeof mockSystem }) => Value): Value =>
    selector({ system: mockSystem }),
  useEditorCommands: () => ({
    document: {
      setSystem: (system: typeof mockSystem) => {
        calls.setSystem.push(system);
        mockSystem = system;
      },
      setViewport: (viewport: unknown) => {
        mockSystem = { ...mockSystem, viewport };
      },
    },
    network: {
      setDrivingSide: (side: string) => {
        mockSystem = { ...mockSystem, drivingSide: side };
      },
    },
    imports: {
      applyImportedNetwork: (request: MockImportedNetworkRequest) => {
        calls.importWays.push(request.network);
        return { added: 1, skipped: 0 };
      },
    },
    tools: {
      setTool: (tool: string) => calls.setTool.push(tool),
    },
  }),
}));

vi.mock('../../src/storage/localStore', () => ({
  setActiveId: () => undefined,
}));

const importOsmWaysMock = vi.fn();
vi.mock('@transitmapper/core/model/import', () => ({
  importOsmWays: (...args: unknown[]) => importOsmWaysMock(...args),
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

vi.mock('@transitmapper/core/model/serialize', () => ({
  createEmptySystem: () => ({ id: 'new-system', drivingSide: 'right', ways: [] }),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  calls.setSystem = [];
  calls.importWays = [];
  calls.setTool = [];
  mockSystem = { id: 'existing', drivingSide: 'right' };
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
    b.textContent?.includes(label),
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
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, 'Las Vegas');
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
    importOsmWaysMock.mockImplementation(() => {
      systemActiveWhenImportStarted = mockSystem.id;
      return { ways: [{ id: 'w1' }], nodes: [], namedWays: [], medians: [], turnRestrictions: [] };
    });
    const onClose = vi.fn();
    act(() => root.render(<NewSystemLocationDialog onClose={onClose} mode="create" />));

    await pickViaSearch();

    const confirmBtn = findButton('Use this location');
    expect(confirmBtn.disabled).toBe(false);
    await act(async () => {
      confirmBtn.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // The system was created+activated before importOsmWays ever ran — if
    // Overpass were down, this order is what leaves the user on a real,
    // correctly-centered system instead of stuck behind the dialog.
    expect(calls.setSystem).toHaveLength(1);
    expect(systemActiveWhenImportStarted).toBe('new-system');
    expect(calls.importWays).toHaveLength(1);
    expect(calls.setTool).toEqual(['way']);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('leaves a correctly-centered, usable system in place when the import fails', async () => {
    importOsmWaysMock.mockRejectedValue(new Error('OSM import failed — no server answered.'));
    const onClose = vi.fn();
    act(() => root.render(<NewSystemLocationDialog onClose={onClose} mode="create" />));

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
    expect(calls.setSystem).toHaveLength(1);
    expect(calls.setSystem[0]).toMatchObject({ id: 'new-system' });
    expect(onClose).not.toHaveBeenCalled();
    expect(container.textContent).toContain('OSM import failed');
  });

  it('lets a blank canvas skip stand in for a failed or declined import', async () => {
    const onClose = vi.fn();
    act(() => root.render(<NewSystemLocationDialog onClose={onClose} mode="create" />));

    const skipBtn = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Continue with a blank canvas'),
    );
    if (!skipBtn) throw new Error('Expected the skip button');
    act(() => skipBtn.click());

    expect(calls.setSystem).toHaveLength(1);
    expect(calls.setSystem[0]).toMatchObject({ id: 'new-system' });
    expect(calls.setTool).toEqual(['way']);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(importOsmWaysMock).not.toHaveBeenCalled();
  });
});
