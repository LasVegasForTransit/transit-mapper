import type { EffectCallback } from 'react';
import { aRoad, aSystem } from '@transitmapper/core/testing/fixtures';
import type { ViewOptions } from '@transitmapper/core/render/buildFeatures';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeOnboardingMap {
  emitLoad(): void;
}

const onboardingHarness = vi.hoisted(() => ({
  container: { dataset: {}, clientWidth: 360, clientHeight: 240 },
  effects: [] as EffectCallback[],
  featureViews: [] as ViewOptions[],
  maps: [] as FakeOnboardingMap[],
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useEffect: (effect: EffectCallback) => {
      onboardingHarness.effects.push(effect);
    },
    useRef: () => ({ current: onboardingHarness.container }),
  };
});

vi.mock('@transitmapper/core/render/buildFeatures', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@transitmapper/core/render/buildFeatures')>();
  return {
    ...actual,
    buildFeatures: (...args: Parameters<typeof actual.buildFeatures>) => {
      onboardingHarness.featureViews.push(args[3]);
      return actual.buildFeatures(...args);
    },
  };
});

vi.mock('../../../src/theme/systemColorScheme', () => ({
  useSystemColorScheme: () => 'light',
}));

vi.mock('../../../src/map/layers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/map/layers')>();
  return { ...actual, registerMapIcons: vi.fn() };
});

vi.mock('maplibre-gl', () => {
  class FakeMap {
    private readonly sources = new Map<string, { setData(): void }>();
    private loadListener: (() => void) | undefined;
    private zoom = 1;
    private southwest = { lng: 0, lat: 0 };
    private northeast = { lng: 1, lat: 1 };

    constructor() {
      onboardingHarness.maps.push(this);
    }

    on(event: string, listener: () => void): this {
      if (event === 'load') this.loadListener = listener;
      return this;
    }

    once(event: string, listener: () => void): this {
      if (event === 'idle') listener();
      return this;
    }

    emitLoad(): void {
      this.loadListener?.();
    }

    addSource(id: string): this {
      this.sources.set(id, { setData: vi.fn() });
      return this;
    }

    getSource(id: string) {
      return this.sources.get(id);
    }

    addLayer(): this {
      return this;
    }

    getLayer(): undefined {
      return undefined;
    }

    resize(): void {}

    fitBounds(bounds: [[number, number], [number, number]]): void {
      this.southwest = { lng: bounds[0][0], lat: bounds[0][1] };
      this.northeast = { lng: bounds[1][0], lat: bounds[1][1] };
      this.zoom = 13.5;
    }

    getBounds() {
      return {
        getSouthWest: () => this.southwest,
        getNorthEast: () => this.northeast,
      };
    }

    getZoom(): number {
      return this.zoom;
    }

    getCanvas() {
      return { clientWidth: 720, clientHeight: 480 };
    }

    getContainer() {
      return onboardingHarness.container;
    }

    getPixelRatio(): number {
      return 2;
    }

    remove(): void {}
  }

  return { default: { Map: FakeMap } };
});

import { OnboardingPreviewMap } from '../../../src/ui/onboarding/OnboardingPreviewMap';

beforeEach(() => {
  onboardingHarness.effects.length = 0;
  onboardingHarness.featureViews.length = 0;
  onboardingHarness.maps.length = 0;
});

describe('onboarding preview presentation', () => {
  it('builds only after fitting the final thumbnail camera', () => {
    const way = aRoad('way-a', [
      [-115.24, 36.08],
      [-115.04, 36.24],
    ]);
    OnboardingPreviewMap({
      system: aSystem({ ways: [way] }),
      view: {
        viewMode: 'infrastructure',
        visibleModes: new Set(),
        visibleWayTypes: new Set(['road']),
      },
    });

    const cleanup = onboardingHarness.effects[0]?.();
    onboardingHarness.maps[0]?.emitLoad();

    expect(onboardingHarness.featureViews).toHaveLength(1);
    expect(onboardingHarness.featureViews[0]?.presentation).toEqual({
      bounds: {
        southwest: [-115.24, 36.08],
        northeast: [-115.04, 36.24],
      },
      zoom: 13.5,
      viewportWidthPx: 720,
      viewportHeightPx: 480,
      displayedWidthPx: 360,
      displayedHeightPx: 240,
      pixelRatio: 2,
    });

    cleanup?.();
  });
});
