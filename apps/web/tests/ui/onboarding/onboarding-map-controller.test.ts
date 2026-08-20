// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildFeatures } from '@transitmapper/core/render/buildFeatures';
import {
  mountOnboardingMap,
  onboardingProductionLayerSpecs,
  resolveOnboardingSceneSystems,
} from '../../../src/ui/onboarding/onboarding-map-controller';
import { localBlankStyleForScheme } from '../../../src/map/mapTheme';
import { LYR_VEHICLES, SRC_PREVIEW, SRC_SERVICES, SRC_VEHICLES } from '../../../src/map/layers';
import { ONBOARDING_TEST_PRESENTATION } from '../../support/onboarding-presentation.test';

interface MapOptions {
  style: unknown;
}

type MapEvent = 'error' | 'load' | 'style.load';

const mapHarness = vi.hoisted(() => ({ maps: [] as FakeMap[] }));

class FakeMap {
  readonly listeners = new Map<MapEvent, Set<(event?: { error?: Error }) => void>>();
  readonly sources = new Map<string, { setData: ReturnType<typeof vi.fn> }>();
  readonly layers = new Map<string, unknown>();
  readonly setStyle = vi.fn();
  readonly remove = vi.fn();
  readonly setFeatureState = vi.fn();
  readonly resize = vi.fn();
  readonly fitBounds = vi.fn();
  /** Camera reads that happened before `fitBounds`, so a test can prove the
   *  presentation is derived from the fitted extent rather than the default. */
  readonly cameraReadsBeforeFit: string[] = [];

  constructor(readonly options: MapOptions) {}

  private recordCameraRead(name: string): void {
    if (this.fitBounds.mock.calls.length === 0) this.cameraReadsBeforeFit.push(name);
  }

  getBounds() {
    this.recordCameraRead('getBounds');
    return {
      getSouthWest: () => ({ lng: -115.16, lat: 36.15 }),
      getNorthEast: () => ({ lng: -115.13, lat: 36.18 }),
    };
  }

  getZoom(): number {
    this.recordCameraRead('getZoom');
    return 14;
  }

  getPixelRatio(): number {
    return 1;
  }

  getCanvas(): { clientWidth: number; clientHeight: number } {
    return { clientWidth: 640, clientHeight: 360 };
  }

  getContainer(): { clientWidth: number; clientHeight: number } {
    return { clientWidth: 640, clientHeight: 360 };
  }

  on(event: MapEvent, listener: (event?: { error?: Error }) => void): this {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  off(event: MapEvent, listener: (event?: { error?: Error }) => void): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  addControl(): this {
    return this;
  }

  addSource(id: string): this {
    this.sources.set(id, { setData: vi.fn() });
    return this;
  }

  getSource(id: string): unknown {
    return this.sources.get(id);
  }

  addLayer(layer: { id: string }): this {
    this.layers.set(layer.id, layer);
    return this;
  }

  getLayer(id: string): unknown {
    return this.layers.get(id);
  }

  hasImage(): boolean {
    return true;
  }

  removeImage(): this {
    return this;
  }

  addImage(): this {
    return this;
  }

  emit(event: MapEvent, payload?: { error?: Error }): void {
    for (const listener of this.listeners.get(event) ?? []) listener(payload);
  }
}

vi.mock('maplibre-gl', () => ({
  default: {
    Map: vi.fn(function FakeMapConstructor(options: MapOptions) {
      const map = new FakeMap(options);
      mapHarness.maps.push(map);
      return map;
    }),
    AttributionControl: class FakeAttributionControl {
      readonly kind = 'attribution';
    },
    Marker: class FakeMarker {
      setLngLat(): this {
        return this;
      }
      addTo(): this {
        return this;
      }
      getElement(): HTMLElement {
        return document.createElement('span');
      }
      remove(): void {}
    },
  },
}));

afterEach(() => {
  vi.useRealTimers();
  mapHarness.maps.length = 0;
  vi.restoreAllMocks();
});

describe('onboarding map controller', () => {
  it('frames the scene before it reads the camera the projection resolves against', () => {
    const controller = mountOnboardingMap({
      container: document.createElement('div'),
      colorScheme: 'light',
      reducedMotion: true,
      onFailure: vi.fn(),
    });
    controller.setScene('welcome');
    const map = mapHarness.maps[0];
    map.emit('load');

    expect(map.fitBounds).toHaveBeenCalled();
    expect(map.cameraReadsBeforeFit).toEqual([]);

    controller.dispose();
  });

  it('adds stops only after the drawn service is complete', () => {
    const systems = resolveOnboardingSceneSystems('draw');
    const view = { ...systems.resolvedView, presentation: ONBOARDING_TEST_PRESENTATION };
    const initial = buildFeatures(systems.baseSystem, null, [], view);
    const complete = buildFeatures(systems.completeSystem, null, [], view);

    expect(initial.services.features).toHaveLength(0);
    expect(initial.stops.features).toHaveLength(0);
    expect(complete.services.features.length).toBeGreaterThan(0);
    expect(complete.stops.features.length).toBeGreaterThan(0);
  });

  it('uses the production vehicle layer without an onboarding duplicate', () => {
    const vehicleLayers = onboardingProductionLayerSpecs('dark').filter(
      (layer) => 'source' in layer && layer.source === 'tm-vehicles',
    );

    expect(vehicleLayers).toHaveLength(1);
    expect(vehicleLayers[0]?.id).toBe(LYR_VEHICLES);
  });

  it('constructs one map with local context and removes it once', () => {
    vi.useFakeTimers();
    const controller = mountOnboardingMap({
      container: document.createElement('div'),
      colorScheme: 'dark',
      reducedMotion: true,
      onFailure: vi.fn(),
    });
    controller.setScene('welcome');
    controller.setScene('draw');

    expect(mapHarness.maps).toHaveLength(1);
    expect(mapHarness.maps[0]?.options.style).toEqual(localBlankStyleForScheme('dark'));

    mapHarness.maps[0].emit('load');
    expect(mapHarness.maps[0].sources.has('onboarding-street-context')).toBe(true);
    expect(mapHarness.maps[0].layers.has('onboarding-streets')).toBe(true);

    controller.dispose();
    controller.dispose();
    expect(mapHarness.maps[0].remove).toHaveBeenCalledTimes(1);
  });

  it('keeps the local context mounted when MapLibre reports an error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onFailure = vi.fn();
    const controller = mountOnboardingMap({
      container: document.createElement('div'),
      colorScheme: 'light',
      reducedMotion: true,
      onFailure,
    });
    const map = mapHarness.maps[0];

    map.emit('style.load');
    map.emit('error', { error: new Error('tiles unavailable') });

    expect(map.setStyle).not.toHaveBeenCalled();
    expect(onFailure).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('replaces scene source data on the existing map', () => {
    const controller = mountOnboardingMap({
      container: document.createElement('div'),
      colorScheme: 'light',
      reducedMotion: true,
      onFailure: vi.fn(),
    });
    const map = mapHarness.maps[0];
    controller.setScene('welcome');
    map.emit('load');
    const services = map.sources.get(SRC_SERVICES)?.setData;
    const preview = map.sources.get(SRC_PREVIEW)?.setData;
    const vehicles = map.sources.get(SRC_VEHICLES)?.setData;
    services?.mockClear();
    preview?.mockClear();
    vehicles?.mockClear();

    controller.setScene('draw');
    expect(services).toHaveBeenCalled();
    expect(preview).toHaveBeenCalled();
    expect(vehicles).toHaveBeenCalled();

    services?.mockClear();
    controller.setScene('infrastructure');
    expect(services).toHaveBeenCalled();

    controller.dispose();
  });

  it('ignores obsolete animation callbacks after a scene change', () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callbacks.set(++nextFrame, callback);
      return nextFrame;
    });
    vi.stubGlobal('cancelAnimationFrame', (frame: number) => callbacks.delete(frame));
    const controller = mountOnboardingMap({
      container: document.createElement('div'),
      colorScheme: 'light',
      reducedMotion: false,
      onFailure: vi.fn(),
    });
    const map = mapHarness.maps[0];
    controller.setScene('draw');
    map.emit('load');
    const obsolete = [...callbacks.values()][0];
    const preview = map.sources.get(SRC_PREVIEW)?.setData;
    preview?.mockClear();

    controller.setScene('simulate');
    obsolete(1_600);

    expect(preview).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it('publishes draw and vehicle motion at most once per animation frame', () => {
    let callbacks = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callbacks.set(++nextFrame, callback);
      return nextFrame;
    });
    vi.stubGlobal('cancelAnimationFrame', (frame: number) => callbacks.delete(frame));
    const pumpFrame = (atMs: number) => {
      const due = callbacks;
      callbacks = new Map();
      for (const callback of due.values()) callback(atMs);
    };
    const controller = mountOnboardingMap({
      container: document.createElement('div'),
      colorScheme: 'light',
      reducedMotion: false,
      onFailure: vi.fn(),
    });
    const map = mapHarness.maps[0];
    controller.setScene('draw');
    map.emit('load');
    const services = map.sources.get(SRC_SERVICES)?.setData;
    const preview = map.sources.get(SRC_PREVIEW)?.setData;
    services?.mockClear();
    preview?.mockClear();

    expect(callbacks).toHaveLength(1);
    expect(services).not.toHaveBeenCalled();
    expect(preview).not.toHaveBeenCalled();
    pumpFrame(1_600);
    expect(services).toHaveBeenCalledTimes(1);
    expect(preview).toHaveBeenCalledTimes(1);
    expect(callbacks).toHaveLength(1);

    controller.setScene('simulate');
    const vehicles = map.sources.get(SRC_VEHICLES)?.setData;
    vehicles?.mockClear();
    expect(callbacks).toHaveLength(1);
    pumpFrame(2_000);
    expect(vehicles).toHaveBeenCalledTimes(1);
    expect(callbacks).toHaveLength(1);

    controller.dispose();
  });

  it('cancels active animation while hidden and resumes the active scene when visible', () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    let visibility: DocumentVisibilityState = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callbacks.set(++nextFrame, callback);
      return nextFrame;
    });
    vi.stubGlobal('cancelAnimationFrame', (frame: number) => callbacks.delete(frame));
    const controller = mountOnboardingMap({
      container: document.createElement('div'),
      colorScheme: 'light',
      reducedMotion: false,
      onFailure: vi.fn(),
    });
    controller.setScene('simulate');
    mapHarness.maps[0].emit('load');
    expect(callbacks).toHaveLength(1);

    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(callbacks).toHaveLength(0);

    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(callbacks).toHaveLength(1);

    controller.dispose();
  });

  it('stops active animation when reduced motion becomes enabled', () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    let motionListener: ((event: MediaQueryListEvent) => void) | undefined;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callbacks.set(++nextFrame, callback);
      return nextFrame;
    });
    vi.stubGlobal('cancelAnimationFrame', (frame: number) => callbacks.delete(frame));
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: (_event: string, listener: (event: MediaQueryListEvent) => void) => {
        motionListener = listener;
      },
      removeEventListener: vi.fn(),
    }));
    const controller = mountOnboardingMap({
      container: document.createElement('div'),
      colorScheme: 'light',
      onFailure: vi.fn(),
    });
    controller.setScene('simulate');
    mapHarness.maps[0].emit('load');
    expect(callbacks).toHaveLength(1);

    motionListener?.({ matches: true } as MediaQueryListEvent);
    expect(callbacks).toHaveLength(0);

    motionListener?.({ matches: false } as MediaQueryListEvent);
    expect(callbacks).toHaveLength(1);

    controller.dispose();
  });

  it('does not schedule animation while hidden or reduced motion is active', () => {
    const requestFrame = vi.fn(() => 1);
    vi.stubGlobal('requestAnimationFrame', requestFrame);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const hiddenController = mountOnboardingMap({
      container: document.createElement('div'),
      colorScheme: 'light',
      reducedMotion: false,
      onFailure: vi.fn(),
    });
    hiddenController.setScene('simulate');
    mapHarness.maps[0].emit('load');
    expect(requestFrame).not.toHaveBeenCalled();
    hiddenController.dispose();

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const reducedController = mountOnboardingMap({
      container: document.createElement('div'),
      colorScheme: 'light',
      reducedMotion: true,
      onFailure: vi.fn(),
    });
    reducedController.setScene('draw');
    mapHarness.maps[1].emit('load');
    expect(requestFrame).not.toHaveBeenCalled();
    reducedController.dispose();
  });
});
