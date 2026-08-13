// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildFeatures } from '@transitmapper/core/render/buildFeatures';
import {
  mountOnboardingMap,
  onboardingProductionLayerSpecs,
  resolveOnboardingSceneSystems,
} from '../../../src/ui/onboarding/onboarding-map-controller';
import { basemapStyleForScheme, localBlankStyleForScheme } from '../../../src/map/mapTheme';
import { LYR_VEHICLES } from '../../../src/map/layers';

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

  constructor(readonly options: MapOptions) {}

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
  it('adds stops only after the drawn service is complete', () => {
    const systems = resolveOnboardingSceneSystems('draw');
    const initial = buildFeatures(systems.baseSystem, null, [], systems.resolvedView);
    const complete = buildFeatures(systems.completeSystem, null, [], systems.resolvedView);

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

  it('starts with the same real basemap as the editor', () => {
    vi.useFakeTimers();
    const cleanup = mountOnboardingMap({
      container: document.createElement('div'),
      colorScheme: 'dark',
      scene: 'welcome',
      reducedMotion: true,
      onFailure: vi.fn(),
    });

    expect(mapHarness.maps).toHaveLength(1);
    expect(mapHarness.maps[0]?.options.style).toBe(basemapStyleForScheme('dark'));

    cleanup();
  });

  it('keeps the map visible on a basemap failure by switching to local context', () => {
    vi.useFakeTimers();
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

    expect(map.setStyle).toHaveBeenCalledWith(localBlankStyleForScheme('light'), {
      diff: false,
    });
    expect(onFailure).not.toHaveBeenCalled();

    map.emit('load');

    expect(onFailure.mock.calls).toEqual([]);
    expect(map.sources.has('onboarding-street-context')).toBe(true);
    expect(map.layers.has('onboarding-streets')).toBe(true);
    expect(onFailure).not.toHaveBeenCalled();

    cleanup();
  });
});
