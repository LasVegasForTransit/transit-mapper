import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import {
  createEmbedStyleController,
  embedOverlayIsRetained,
} from '../../src/embed/embed-style-controller';
import { EMBED_SOURCE_IDS, embedLayerSpecsForScheme } from '../../src/embed/config';

const style = (id: string): StyleSpecification => ({
  version: 8,
  sources: {},
  layers: [{ id, type: 'background' }],
});

class EmbedMapFake {
  current = style('remote-light');
  readonly replacements: StyleSpecification[] = [];

  getStyle(): StyleSpecification {
    return this.current;
  }

  setStyle(next: StyleSpecification): this {
    this.replacements.push(next);
    this.current = next;
    return this;
  }

  on(): this {
    return this;
  }

  off(): this {
    return this;
  }
}

afterEach(() => vi.useRealTimers());

describe('createEmbedStyleController', () => {
  it('recognizes an empty embed overlay when every source and layer remains', () => {
    const emptyOverlay: StyleSpecification = {
      version: 8,
      sources: Object.fromEntries(
        [...EMBED_SOURCE_IDS].map((sourceId) => [
          sourceId,
          {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
          },
        ]),
      ),
      layers: embedLayerSpecsForScheme('light'),
    };

    expect(embedOverlayIsRetained(emptyOverlay, 'light')).toBe(true);
  });

  it('keeps the working remote style when a later theme fetch fails', async () => {
    const map = new EmbedMapFake();
    const onUnavailable = vi.fn();
    const controller = createEmbedStyleController<'light' | 'dark'>({
      map: map as unknown as MapLibreMap,
      initialTheme: 'light',
      local: (theme) => style(`local-${theme}`),
      remoteUrl: (theme) => `https://styles.test/${theme}.json`,
      fetch: () => Promise.reject(new Error('offline')),
      timeoutMs: 250,
      isInteractionActive: () => false,
      reportError: vi.fn(),
      onUnavailable,
    });

    await controller.request('dark');

    expect(map.current).toEqual(style('remote-light'));
    expect(map.replacements).toEqual([]);
    expect(onUnavailable).toHaveBeenCalledOnce();
  });

  it('keeps the working remote style when a later theme fetch exceeds its budget', async () => {
    vi.useFakeTimers();
    const map = new EmbedMapFake();
    const controller = createEmbedStyleController<'light' | 'dark'>({
      map: map as unknown as MapLibreMap,
      initialTheme: 'light',
      local: (theme) => style(`local-${theme}`),
      remoteUrl: (theme) => `https://styles.test/${theme}.json`,
      fetch: () => new Promise<StyleSpecification>(() => {}),
      probe: () => Promise.resolve(true),
      timeoutMs: 250,
      isInteractionActive: () => false,
      reportError: vi.fn(),
      onUnavailable: vi.fn(),
    });

    const request = controller.request('dark');
    await vi.advanceTimersByTimeAsync(250);
    await request;

    expect(map.current).toEqual(style('remote-light'));
    expect(map.replacements).toEqual([]);
  });
});
