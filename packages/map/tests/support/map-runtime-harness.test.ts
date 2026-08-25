import { vi } from 'vitest';
import type {
  ControlPosition,
  IControl,
  Map as MapLibreMap,
  MapOptions,
  PaddingOptions,
  StyleSpecification,
} from 'maplibre-gl';
import {
  createMapRuntime,
  createMapViewStore,
  type MapRuntime,
  type MapRuntimeOptions,
  type MapRuntimeResizeObserver,
} from '../../src/index';

type MapEvent = 'moveend' | 'resize';

interface RotationHandler {
  disableRotation: () => void;
}

export const localStyle = (theme: string): StyleSpecification => ({
  version: 8,
  sources: {},
  layers: [{ id: `local-${theme}`, type: 'background' }],
});

export const remoteStyle = (theme: string): StyleSpecification => ({
  version: 8,
  sources: {},
  layers: [{ id: `remote-${theme}`, type: 'background' }],
});

export class FakeMap {
  readonly listeners = new Map<MapEvent, Set<() => void>>();
  readonly controls: Array<{ control: IControl; position?: ControlPosition }> = [];
  readonly paddings: PaddingOptions[] = [];
  readonly styles: StyleSpecification[] = [];
  readonly jumpHistory: Array<{ center: [number, number]; zoom: number }> = [];
  removed = false;
  resizeCount = 0;
  center: [number, number];
  zoom: number;
  style: StyleSpecification;
  failDifferentialStyle = false;
  failFullStyle = false;
  omitTransformPrevious = false;
  readonly touchZoomRotate: RotationHandler = { disableRotation: vi.fn() };

  constructor(readonly options: MapOptions) {
    this.center = options.center as [number, number];
    this.zoom = options.zoom ?? 0;
    this.style = options.style as StyleSpecification;
    this.styles.push(this.style);
  }

  on(event: MapEvent, listener: () => void): this {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  off(event: MapEvent, listener: () => void): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  emit(event: MapEvent): void {
    for (const listener of this.listeners.get(event) ?? []) listener();
  }

  addControl(control: IControl, position?: ControlPosition): this {
    this.controls.push({ control, position });
    return this;
  }

  setPadding(padding: PaddingOptions): this {
    this.paddings.push(padding);
    return this;
  }

  getCenter(): { lng: number; lat: number } {
    return { lng: this.center[0], lat: this.center[1] };
  }

  getZoom(): number {
    return this.zoom;
  }

  jumpTo(camera: { center?: [number, number]; zoom?: number }): this {
    if (camera.center) this.center = camera.center;
    if (camera.zoom !== undefined) this.zoom = camera.zoom;
    this.jumpHistory.push({ center: [...this.center], zoom: this.zoom });
    this.emit('moveend');
    return this;
  }

  getStyle(): StyleSpecification {
    return this.style;
  }

  setStyle(
    next: StyleSpecification,
    options?: {
      diff?: boolean;
      transformStyle?: (
        previous: StyleSpecification | undefined,
        incoming: StyleSpecification,
      ) => StyleSpecification;
    },
  ): this {
    if (options?.diff && this.failDifferentialStyle) {
      this.failDifferentialStyle = false;
      throw new Error('diff failed');
    }
    if (options?.diff === false && this.failFullStyle) throw new Error('full failed');
    this.style =
      options?.transformStyle?.(this.omitTransformPrevious ? undefined : this.style, next) ?? next;
    this.styles.push(this.style);
    return this;
  }

  resize(): this {
    this.resizeCount += 1;
    this.emit('resize');
    return this;
  }

  remove(): void {
    this.removed = true;
  }
}

export class FakeResizeObserver implements MapRuntimeResizeObserver {
  observed: Element | undefined;
  disconnected = false;

  constructor(readonly listener: () => void) {}

  observe(target: Element): void {
    this.observed = target;
  }

  disconnect(): void {
    this.disconnected = true;
  }

  notify(): void {
    this.listener();
  }
}

export interface RuntimeHarness {
  runtime: MapRuntime;
  map: FakeMap;
  observer: FakeResizeObserver;
  viewStore: ReturnType<typeof createMapViewStore>;
  fetchStyle: ReturnType<typeof vi.fn>;
  reportError: ReturnType<typeof vi.fn>;
  recoverDocumentLayers: ReturnType<typeof vi.fn>;
}

export function createHarness(overrides: Partial<MapRuntimeOptions<string>> = {}): RuntimeHarness {
  let map: FakeMap | undefined;
  let observer: FakeResizeObserver | undefined;
  const viewStore = createMapViewStore({
    schemaVersion: 1,
    camera: { center: [-115.1728, 36.1147], zoom: 11 },
    representationId: 'network',
    filters: { modes: ['bus'] },
  });
  const fetchStyle = vi.fn((_url: string, _signal: AbortSignal) =>
    Promise.resolve(remoteStyle('light')),
  );
  const reportError = vi.fn();
  const recoverDocumentLayers = vi.fn();
  const container = {} as HTMLElement;
  const runtime = createMapRuntime<string>({
    container,
    viewStore,
    initialTheme: 'light',
    style: {
      local: localStyle,
      remoteUrl: (theme) => `https://styles.test/${theme}.json`,
      fetch: fetchStyle,
      carry: (_previous, next) => next,
      recoverDocumentLayers,
      timeoutMs: 1_500,
      online: () => true,
      isInteractionActive: () => false,
      onBaseStyleUnavailable: vi.fn(),
    },
    interaction: {
      dragPan: false,
      dragRotate: false,
      doubleClickZoom: false,
      keyboard: false,
      boxZoom: false,
      touchZoomRotate: true,
      touchPitch: false,
    },
    controls: { navigation: false, attribution: false },
    mapOptions: { fadeDuration: 0, refreshExpiredTiles: false },
    padding: () => ({ top: 10, right: 20, bottom: 30, left: 40 }),
    reportError,
    createMap: (mapOptions) => {
      map = new FakeMap(mapOptions);
      return map as unknown as MapLibreMap;
    },
    createNavigationControl: () => ({}) as IControl,
    createAttributionControl: () => ({}) as IControl,
    createResizeObserver: (listener) => {
      observer = new FakeResizeObserver(listener);
      return observer;
    },
    ...overrides,
  });
  if (!map || !observer) throw new Error('Runtime did not create its owned resources.');
  return {
    runtime,
    map,
    observer,
    viewStore,
    fetchStyle,
    reportError,
    recoverDocumentLayers,
  };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
