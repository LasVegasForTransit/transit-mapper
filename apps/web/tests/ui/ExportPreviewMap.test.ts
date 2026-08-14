import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
import { aRoad, aSystem } from '@transitmapper/core/testing/fixtures';
import type { ViewOptions } from '@transitmapper/core/render/buildFeatures';
import type { EffectCallback } from 'react';

interface FakeSource {
  setData: (data: GeoJSON.FeatureCollection) => void;
}

interface FakePreviewMap {
  emitLoad: () => void;
  emitMove: (zoom: number, bounds: [[number, number], [number, number]]) => void;
  sourceIds: () => string[];
}

const previewHarness = vi.hoisted(() => ({
  container: { dataset: {}, clientWidth: 390, clientHeight: 260 },
  effects: [] as EffectCallback[],
  maps: [] as FakePreviewMap[],
  featureViews: [] as ViewOptions[],
  refCalls: 0,
}));

interface ProjectionRequest {
  readonly view: ViewOptions;
}

vi.mock('../../src/map/feature-projection-worker', async () => {
  const { emptySystemFeatures } = await import('../../src/map/system-feature-sources');
  return {
    createFeatureProjectionWorker: () => ({
      project: ({ view }: ProjectionRequest) => {
        previewHarness.featureViews.push(view);
        return Promise.resolve({ features: emptySystemFeatures(), counts: null });
      },
      dispose: vi.fn(),
    }),
  };
});

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useEffect: (effect: EffectCallback) => {
      previewHarness.effects.push(effect);
    },
    useRef: <T>(initial: T) => {
      const current = previewHarness.refCalls++ === 0 ? (previewHarness.container as T) : initial;
      return { current };
    },
  };
});

vi.mock('maplibre-gl', () => {
  class FakeMap {
    private readonly sources = new Map<string, FakeSource>();
    private loadListener: (() => void) | undefined;
    private moveListener: (() => void) | undefined;
    private zoom = 2;
    private southwest = { lng: 0, lat: 0 };
    private northeast = { lng: 1, lat: 1 };

    constructor() {
      previewHarness.maps.push(this);
    }

    on(event: string, listener: () => void): this {
      if (event === 'load') this.loadListener = listener;
      if (event === 'moveend') this.moveListener = listener;
      return this;
    }

    off(): this {
      return this;
    }

    once(event: string, listener: () => void): this {
      if (event === 'idle') listener();
      return this;
    }

    emitLoad(): void {
      this.loadListener?.();
    }

    emitMove(zoom: number, bounds: [[number, number], [number, number]]): void {
      this.zoom = zoom;
      this.southwest = { lng: bounds[0][0], lat: bounds[0][1] };
      this.northeast = { lng: bounds[1][0], lat: bounds[1][1] };
      this.moveListener?.();
    }

    sourceIds(): string[] {
      return [...this.sources.keys()];
    }

    addSource(id: string): this {
      this.sources.set(id, { setData: vi.fn() });
      return this;
    }

    getSource(id: string): FakeSource | undefined {
      return this.sources.get(id);
    }

    addLayer(spec: { source?: unknown }): this {
      if (typeof spec.source === 'string' && !this.sources.has(spec.source)) {
        throw new Error(`Layer source "${spec.source}" was not registered first.`);
      }
      return this;
    }

    resize(): void {}

    fitBounds(bounds: [[number, number], [number, number]]): void {
      this.southwest = { lng: bounds[0][0], lat: bounds[0][1] };
      this.northeast = { lng: bounds[1][0], lat: bounds[1][1] };
      this.zoom = 12.25;
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
      return { clientWidth: 780, clientHeight: 520 };
    }

    getContainer() {
      return previewHarness.container;
    }

    getPixelRatio(): number {
      return 3;
    }

    remove(): void {}
  }

  return { default: { Map: FakeMap } };
});

vi.mock('../../src/map/layers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/map/layers')>();
  return { ...actual, registerMapIcons: vi.fn() };
});

import { LAYER_SPECS } from '../../src/map/layers';
import { ExportPreviewMap } from '../../src/ui/ExportPreviewMap';

beforeEach(() => {
  previewHarness.effects.length = 0;
  previewHarness.maps.length = 0;
  previewHarness.featureViews.length = 0;
  previewHarness.refCalls = 0;
  delete previewHarness.container.dataset.renderSettled;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}

      disconnect(): void {}
    },
  );
});

describe('export preview map', () => {
  it('settles only after worker-projected source data reaches MapLibre', async () => {
    ExportPreviewMap({
      system: createEmptySystem(),
      view: {
        viewMode: 'network',
        visibleModes: new Set(),
        visibleWayTypes: new Set(),
      },
      onReady: vi.fn(),
    });

    const cleanup = previewHarness.effects[0]?.();
    previewHarness.maps[0]?.emitLoad();

    // The first map idle belongs to the blank basemap. The feature worker has
    // not yielded its detached collection yet, so it cannot qualify as a
    // settled export preview.
    expect(previewHarness.container.dataset.renderSettled).toBeUndefined();
    await Promise.resolve();
    await Promise.resolve();
    expect(previewHarness.container.dataset.renderSettled).toBe('true');

    cleanup?.();
  });

  it('registers every layer source before adding the export layers', () => {
    ExportPreviewMap({
      system: createEmptySystem(),
      view: {
        viewMode: 'network',
        visibleModes: new Set(),
        visibleWayTypes: new Set(),
      },
      onReady: vi.fn(),
    });

    const cleanup = previewHarness.effects[0]?.();
    const map = previewHarness.maps[0];

    expect(() => map.emitLoad()).not.toThrow();

    const requiredSources = new Set(
      LAYER_SPECS.flatMap((spec) =>
        'source' in spec && typeof spec.source === 'string' ? [spec.source] : [],
      ),
    );
    expect(new Set(map.sourceIds())).toEqual(requiredSources);

    cleanup?.();
  });

  it('builds from the final fitted camera and displayed CSS size', () => {
    const way = aRoad('way-a', [
      [-115.3, 36.02],
      [-114.98, 36.31],
    ]);
    ExportPreviewMap({
      system: aSystem({ ways: [way] }),
      view: {
        viewMode: 'infrastructure',
        visibleModes: new Set(),
        visibleWayTypes: new Set(['road']),
      },
      onReady: vi.fn(),
    });

    const cleanup = previewHarness.effects[0]?.();
    previewHarness.maps[0]?.emitLoad();

    expect(previewHarness.featureViews.at(-1)?.presentation).toEqual({
      bounds: {
        southwest: [-115.3, 36.02],
        northeast: [-114.98, 36.31],
      },
      zoom: 12.25,
      viewportWidthPx: 780,
      viewportHeightPx: 520,
      displayedWidthPx: 390,
      displayedHeightPx: 260,
      pixelRatio: 3,
    });

    cleanup?.();
  });

  it('rebuilds presentation after the reader changes the export camera', () => {
    const way = aRoad('way-a', [
      [-115.3, 36.02],
      [-114.98, 36.31],
    ]);
    ExportPreviewMap({
      system: aSystem({ ways: [way] }),
      view: {
        viewMode: 'infrastructure',
        visibleModes: new Set(),
        visibleWayTypes: new Set(['road']),
      },
      onReady: vi.fn(),
    });

    const cleanup = previewHarness.effects[0]?.();
    const map = previewHarness.maps[0];
    map.emitLoad();
    map.emitMove(15, [
      [-115.14, 36.14],
      [-115.08, 36.2],
    ]);

    expect(previewHarness.featureViews).toHaveLength(2);
    expect(previewHarness.featureViews[1]?.presentation).toMatchObject({
      bounds: {
        southwest: [-115.14, 36.14],
        northeast: [-115.08, 36.2],
      },
      zoom: 15,
    });

    cleanup?.();
  });
});
