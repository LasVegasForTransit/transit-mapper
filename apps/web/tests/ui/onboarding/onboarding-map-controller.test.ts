// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountOnboardingMap } from '../../../src/ui/onboarding/onboarding-map-controller';
import { basemapStyleForScheme, localBlankStyleForScheme } from '../../../src/map/mapTheme';

interface MapOptions {
  style: unknown;
}

type MapEvent = 'error' | 'load' | 'style.load';

const mapHarness = vi.hoisted(() => ({ maps: [] as FakeMap[] }));

class FakeMap {
  readonly listeners = new Map<MapEvent, Set<(event?: { error?: Error }) => void>>();
  readonly setStyle = vi.fn();
  readonly remove = vi.fn();

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
  },
}));

afterEach(() => {
  vi.useRealTimers();
  mapHarness.maps.length = 0;
  vi.restoreAllMocks();
});

describe('onboarding map controller', () => {
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

    map.emit('error', { error: new Error('tiles unavailable') });

    expect(map.setStyle).toHaveBeenCalledWith(localBlankStyleForScheme('light'), {
      diff: false,
    });
    expect(onFailure).not.toHaveBeenCalled();

    cleanup();
  });
});
