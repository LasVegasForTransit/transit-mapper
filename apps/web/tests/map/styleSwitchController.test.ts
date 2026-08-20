import { describe, expect, it, vi, type Mock } from 'vitest';
import type { StyleSpecification } from 'maplibre-gl';
import { MAP_THEMES } from '../../src/map/mapTheme';
import {
  carryTransitMapperStyle,
  createStyleSwitchController,
  type StyleSwitchMap,
} from '../../src/map/styleSwitchController';
const style = (id: string): StyleSpecification => ({
  version: 8,
  sources: {},
  layers: [{ id, type: 'background', paint: { 'background-color': '#fff' } }],
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface StyleSwitchMapHarness extends StyleSwitchMap {
  setStyle: Mock<StyleSwitchMap['setStyle']>;
}

function createMap(): StyleSwitchMapHarness {
  const setStyle = vi.fn<StyleSwitchMap['setStyle']>((..._args) => undefined);
  return {
    getStyle: () => style('current'),
    setStyle,
  };
}

describe('style switch controller', () => {
  it('defers a scheme change until drawing or dragging finishes', async () => {
    const map = createMap();
    let active = true;
    const fetchStyle = vi.fn(() => Promise.resolve(style('dark')));
    const controller = createStyleSwitchController({
      map,
      fetchStyle,
      isInteractionActive: () => active,
    });

    await controller.request('dark');
    expect(fetchStyle).not.toHaveBeenCalled();
    expect(map.setStyle).not.toHaveBeenCalled();

    active = false;
    await controller.flush();
    expect(fetchStyle).toHaveBeenCalledWith(MAP_THEMES.dark.basemapStyle, expect.any(AbortSignal));
    expect(map.setStyle).toHaveBeenCalledOnce();
  });

  it('keeps a deferred change queued until committed preview geometry has painted', async () => {
    const map = createMap();
    let gestureActive = true;
    let settlementOwnsPreview = false;
    const fetchStyle = vi.fn(async () => style('dark'));
    const controller = createStyleSwitchController({
      map,
      fetchStyle,
      isInteractionActive: () => gestureActive || settlementOwnsPreview,
    });

    await controller.request('dark');
    gestureActive = false;
    settlementOwnsPreview = true;
    await controller.flush();

    expect(fetchStyle).not.toHaveBeenCalled();
    expect(map.setStyle).not.toHaveBeenCalled();

    settlementOwnsPreview = false;
    await controller.flush();

    expect(fetchStyle).toHaveBeenCalledOnce();
    expect(map.setStyle).toHaveBeenCalledOnce();
  });

  it('drops a deferred change that reverses to the already-applied scheme', async () => {
    const map = createMap();
    let active = true;
    const fetchStyle = vi.fn(async () => style('dark'));
    const controller = createStyleSwitchController({
      map,
      initialScheme: 'light',
      fetchStyle,
      isInteractionActive: () => active,
    });

    await controller.request('dark');
    await controller.request('light');
    active = false;
    await controller.flush();
    await controller.flush();

    expect(fetchStyle).not.toHaveBeenCalled();
    expect(map.setStyle).not.toHaveBeenCalled();
  });

  it('keeps a gesture-time reversal newer than an in-flight style response', async () => {
    const map = createMap();
    const darkStyle = deferred<StyleSpecification>();
    let active = false;
    const fetchStyle = vi
      .fn()
      .mockImplementationOnce(() => darkStyle.promise)
      .mockResolvedValue(style('dark'));
    const controller = createStyleSwitchController({
      map,
      initialScheme: 'light',
      fetchStyle,
      isInteractionActive: () => active,
    });

    const stale = controller.request('dark');
    active = true;
    await controller.request('light');
    darkStyle.resolve(style('dark'));
    await stale;
    active = false;
    await controller.flush();

    expect(fetchStyle).toHaveBeenCalledOnce();
    expect(map.setStyle).not.toHaveBeenCalled();
  });

  it('aborts and ignores stale style responses', async () => {
    const map = createMap();
    const first = deferred<StyleSpecification>();
    const second = deferred<StyleSpecification>();
    const fetchStyle = vi
      .fn()
      .mockImplementationOnce((_url: string, signal: AbortSignal) => {
        signal.addEventListener('abort', () =>
          first.reject(new DOMException('aborted', 'AbortError')),
        );
        return first.promise;
      })
      .mockImplementationOnce(() => second.promise);
    const controller = createStyleSwitchController({
      map,
      fetchStyle,
      isInteractionActive: () => false,
    });

    const stale = controller.request('dark');
    const current = controller.request('light');
    second.resolve(style('light'));
    await Promise.all([stale, current]);

    expect(map.setStyle).toHaveBeenCalledOnce();
    expect(map.setStyle.mock.calls[0]?.[0]).toEqual(style('light'));
  });

  it('keeps the working style and reports a runtime fetch failure', async () => {
    const map = createMap();
    const onUnavailable = vi.fn();
    const controller = createStyleSwitchController({
      map,
      fetchStyle: async () => {
        throw new Error('offline');
      },
      isInteractionActive: () => false,
      onUnavailable,
    });

    await controller.request('dark');

    expect(map.setStyle).not.toHaveBeenCalled();
    expect(onUnavailable).toHaveBeenCalledWith('dark', expect.any(Error));
  });

  it('uses a full rebuild and the shared recovery path if diffing throws', async () => {
    const map = createMap();
    map.setStyle.mockImplementationOnce(() => {
      throw new Error('diff failed');
    });
    const recover = vi.fn();
    const controller = createStyleSwitchController({
      map,
      fetchStyle: async () => style('dark'),
      isInteractionActive: () => false,
      recover,
    });

    await controller.request('dark');

    expect(map.setStyle.mock.calls[0]?.[0]).toEqual(style('dark'));
    expect(map.setStyle.mock.calls[0]?.[1]?.diff).toBe(true);
    expect(typeof map.setStyle.mock.calls[0]?.[1]?.transformStyle).toBe('function');
    expect(map.setStyle).toHaveBeenNthCalledWith(2, style('dark'), { diff: false });
    expect(recover).toHaveBeenCalledWith('dark', true);
  });

  it('reports a healthy differential switch as preserving renderer state', async () => {
    const map = createMap();
    const recover = vi.fn();
    const controller = createStyleSwitchController({
      map,
      fetchStyle: () => Promise.resolve(style('dark')),
      isInteractionActive: () => false,
      recover,
    });

    await controller.request('dark');

    expect(map.setStyle).toHaveBeenCalledOnce();
    expect(map.setStyle.mock.calls[0]?.[0]).toEqual(style('dark'));
    expect(map.setStyle.mock.calls[0]?.[1]?.diff).toBe(true);
    expect(typeof map.setStyle.mock.calls[0]?.[1]?.transformStyle).toBe('function');
    expect(recover).toHaveBeenCalledWith('dark', false);
  });

  it('keeps later theme changes local after the initial basemap fallback', async () => {
    const map = createMap();
    const fetchStyle = vi.fn(() => Promise.resolve(style('remote-dark')));
    const recover = vi.fn();
    const controller = createStyleSwitchController({
      map,
      initialScheme: 'light',
      fetchStyle,
      isInteractionActive: () => false,
      recover,
    });

    controller.lockToLocal('light');
    await controller.request('dark');

    expect(fetchStyle).not.toHaveBeenCalled();
    expect(map.setStyle).toHaveBeenCalledOnce();
    const nextStyle = map.setStyle.mock.calls[0]?.[0];
    expect(typeof nextStyle).not.toBe('string');
    expect(typeof nextStyle === 'string' ? [] : nextStyle.layers.map((layer) => layer.id)).toEqual([
      'transitmapper-local-background',
    ]);
    expect(map.setStyle.mock.calls[0]?.[1]?.diff).toBe(true);
    expect(typeof map.setStyle.mock.calls[0]?.[1]?.transformStyle).toBe('function');
    expect(recover).toHaveBeenCalledWith('dark', false);
  });
});

describe('TransitMapper style preservation', () => {
  it('carries live sources forward and replaces app layers with themed specs', () => {
    const previous: StyleSpecification = {
      version: 8,
      sources: {
        streets: { type: 'vector', url: 'map://streets' },
        'tm-routes': { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      },
      layers: [
        { id: 'street', type: 'line', source: 'streets' },
        { id: 'tm-old', type: 'line', source: 'tm-routes' },
      ],
    };
    const next = style('new-basemap');
    const themed = [
      {
        id: 'tm-new',
        type: 'line' as const,
        source: 'tm-routes',
        paint: { 'line-color': MAP_THEMES.dark.ink },
      },
    ];

    const carried = carryTransitMapperStyle(previous, next, themed);

    expect(carried.sources['tm-routes']).toEqual(previous.sources['tm-routes']);
    expect(carried.layers.map((layer) => layer.id)).toEqual(['new-basemap', 'tm-new']);
  });
});
