// @vitest-environment jsdom

import { act, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaceResult } from '@transitmapper/core/model/geocode';
import { NewSystemLocationDialog } from '../../src/ui/newSystem/NewSystemLocationDialog';

interface MockModalProps {
  title: string;
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

const camera = {
  center: [-115.05, 36.12] as [number, number],
  zoom: 10.25,
  bounds: { west: -115.3, south: 35.95, east: -114.8, north: 36.35 },
};
let currentCamera = camera;
const fitBoundsMock = vi.fn(async () => {});
const flyToMock = vi.fn(async () => {});

vi.mock('../../src/ui/newSystem/LocationPickerMap', () => ({
  LocationPickerMap: ({
    handleRef,
    onCameraChange,
  }: {
    handleRef: { current: unknown };
    onCameraChange: (value: typeof camera) => void;
  }) => {
    handleRef.current = {
      flyTo: flyToMock,
      fitBounds: fitBoundsMock,
      getCamera: () => currentCamera,
    };
    useEffect(() => onCameraChange(camera), [onCameraChange]);
    return <div aria-label="Location map" />;
  },
}));

const calls = {
  setSystem: [] as unknown[],
  setTool: [] as string[],
  setViewMode: [] as string[],
  background: [] as unknown[],
};
let mockSystem: { id: string; drivingSide: 'right' | 'left'; viewport?: unknown };
const store = {
  commands: {
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
      setDrivingSide: (drivingSide: 'right' | 'left') => {
        mockSystem = { ...mockSystem, drivingSide };
      },
    },
    tools: { setTool: (tool: string) => calls.setTool.push(tool) },
  },
  getState: () => ({ system: mockSystem }),
};

vi.mock('../../src/editor/EditorProvider', () => ({ useEditorStore: () => store }));
vi.mock('../../src/storage/localStore', () => ({ setActiveId: () => undefined }));
vi.mock('../../src/ui/UiProvider', () => ({
  useImportProgress: () => ({ importProgress: null, setImportProgress: vi.fn() }),
}));
vi.mock('../../src/ui/ViewProvider', () => ({
  useView: () => ({ setViewMode: (mode: string) => calls.setViewMode.push(mode) }),
}));
vi.mock('../../src/import/background-osm-import', () => ({
  beginBackgroundOsmImport: (options: unknown) => calls.background.push(options),
}));

const searchPlacesMock =
  vi.fn<(query: string, options?: { signal?: AbortSignal }) => Promise<PlaceResult[]>>();
vi.mock('../../src/network/search-places', () => ({
  searchPlaces: (query: string, options?: { signal?: AbortSignal }) =>
    searchPlacesMock(query, options),
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
  calls.setTool = [];
  calls.setViewMode = [];
  calls.background = [];
  currentCamera = camera;
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

function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((candidate) =>
    candidate.textContent.includes(label),
  );
  if (!found) throw new Error(`Expected button ${label}`);
  return found;
}

function setSearchInput(value: string): void {
  const input = container.querySelector('input');
  if (!(input instanceof HTMLInputElement)) throw new Error('Expected the place search input.');
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  const setValue = descriptor?.set?.bind(input);
  if (!setValue) throw new Error('Expected the native input value setter.');
  act(() => {
    setValue(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function searchAndChoose(result: {
  label: string;
  center: [number, number];
  boundingBox?: typeof camera.bounds;
}) {
  searchPlacesMock.mockResolvedValue([result]);
  setSearchInput('Las Vegas Valley');
  await act(async () => {
    button('Search').click();
    await Promise.resolve();
    await Promise.resolve();
  });
  await act(async () => {
    button(result.label).click();
    await Promise.resolve();
  });
}

describe('NewSystemLocationDialog', () => {
  it('searches only on submission and fits a validated metro bounding box', async () => {
    act(() => root.render(<NewSystemLocationDialog onClose={vi.fn()} mode="create" />));
    setSearchInput('Las Vegas');
    expect(searchPlacesMock).not.toHaveBeenCalled();

    await searchAndChoose({
      label: 'Las Vegas Valley',
      center: [-115.1, 36.1],
      boundingBox: camera.bounds,
    });

    expect(searchPlacesMock).toHaveBeenCalledTimes(1);
    expect(fitBoundsMock).toHaveBeenCalledWith(camera.bounds);
    expect(flyToMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain('km²');
    expect(container.textContent).toContain('tiles');
  });

  it('creates the target once, preserves the metro camera, and lands in Infrastructure Select before background import', async () => {
    const onClose = vi.fn();
    act(() => root.render(<NewSystemLocationDialog onClose={onClose} mode="create" />));
    await searchAndChoose({
      label: 'Las Vegas Valley',
      center: [-115.1, 36.1],
      boundingBox: camera.bounds,
    });

    await act(async () => {
      button('Use this metro area').click();
      button('Use this metro area').click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(calls.setSystem).toHaveLength(1);
    expect(calls.setSystem[0]).toMatchObject({
      id: 'new-system',
      viewport: { center: camera.center, zoom: camera.zoom },
    });
    expect(calls.setTool).toEqual(['select']);
    expect(calls.setViewMode).toEqual(['infrastructure']);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(calls.background).toHaveLength(1);
    expect(calls.background[0]).toMatchObject({
      targetSystemId: 'new-system',
      bounds: camera.bounds,
      categories: ['road', 'bike'],
    });
  });

  it('rechecks the settled camera before creating a system', async () => {
    let settleFit = () => {};
    fitBoundsMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          settleFit = resolve;
        }),
    );
    act(() => root.render(<NewSystemLocationDialog onClose={vi.fn()} mode="create" />));
    await searchAndChoose({
      label: 'Las Vegas Valley',
      center: [-115.1, 36.1],
      boundingBox: camera.bounds,
    });
    currentCamera = {
      ...camera,
      bounds: { west: -120, south: 30, east: -110, north: 40 },
    };

    await act(async () => {
      button('Use this metro area').click();
      settleFit();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(calls.setSystem).toEqual([]);
    expect(calls.background).toEqual([]);
    expect(container.textContent).toContain(
      'Zoom in until the visible area is 5,000 km² or smaller.',
    );
  });

  it('shows place-search failures instead of silently presenting no results', async () => {
    searchPlacesMock.mockRejectedValue(new Error('Place search is temporarily unavailable.'));
    act(() => root.render(<NewSystemLocationDialog onClose={vi.fn()} mode="create" />));
    setSearchInput('Las Vegas');
    await act(async () => {
      button('Search').click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Place search is temporarily unavailable.');
  });
});
