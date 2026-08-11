import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
import type { EffectCallback } from 'react';

interface FakeSource {
  setData: (data: GeoJSON.FeatureCollection) => void;
}

interface FakePreviewMap {
  emitLoad: () => void;
  sourceIds: () => string[];
}

const previewHarness = vi.hoisted(() => ({
  container: { dataset: {} },
  effects: [] as EffectCallback[],
  maps: [] as FakePreviewMap[],
  refCalls: 0,
}));

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

    constructor() {
      previewHarness.maps.push(this);
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

    fitBounds(): void {}

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
  previewHarness.refCalls = 0;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}

      disconnect(): void {}
    },
  );
});

describe('export preview map', () => {
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
});
