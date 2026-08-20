// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildFeatures } from '@transitmapper/core/render/buildFeatures';
import {
  mountOnboardingMap,
  onboardingProductionLayerSpecs,
  resolveOnboardingSceneSystems,
} from '../../../src/ui/onboarding/onboarding-map-controller';
import { localBlankStyleForScheme } from '../../../src/map/mapTheme';
import { LYR_VEHICLES } from '../../../src/map/layers';
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
    const cleanup = mountOnboardingMap({
      container: document.createElement('div'),
      colorScheme: 'light',
      scene: 'welcome',
      reducedMotion: true,
      onFailure: vi.fn(),
    });
    const map = mapHarness.maps[0];
    map.emit('load');

    expect(map.fitBounds).toHaveBeenCalled();
    expect(map.cameraReadsBeforeFit).toEqual([]);

    cleanup();
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

  it('starts with the committed local context instead of a remote basemap', () => {
    const cleanup = mountOnboardingMap({
      container: document.createElement('div'),
      colorScheme: 'dark',
      scene: 'welcome',
      reducedMotion: true,
      onFailure: vi.fn(),
    });

    expect(mapHarness.maps).toHaveLength(1);
    expect(mapHarness.maps[0]?.options.style).toEqual(localBlankStyleForScheme('dark'));

    cleanup();
  });

  it('keeps the local context mounted when MapLibre reports an error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onFailure = vi.fn();
    const cleanup = mountOnboardingMap({
      container: document.createElement('div'),
      colorScheme: 'light',
      scene: 'welcome',
      reducedMotion: true,
      onFailure,
    });
    const map = mapHarness.maps[0];

    map.emit('style.load');
    map.emit('error', { error: new Error('tiles unavailable') });

    expect(map.setStyle).not.toHaveBeenCalled();
    expect(onFailure).not.toHaveBeenCalled();

    map.emit('load');

    expect(onFailure.mock.calls).toEqual([]);
    expect(map.sources.has('onboarding-street-context')).toBe(true);
    expect(map.layers.has('onboarding-streets')).toBe(true);
    expect(onFailure).not.toHaveBeenCalled();

    cleanup();
  });
});
