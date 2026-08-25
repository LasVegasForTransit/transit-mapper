import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StyleSpecification } from 'maplibre-gl';
import {
  createHarness,
  deferred,
  localStyle,
  remoteStyle,
} from './support/map-runtime-harness.test';

afterEach(() => {
  vi.useRealTimers();
});

describe('createMapRuntime', () => {
  it('constructs the map from the View camera and local bootstrap style', () => {
    const { map, observer } = createHarness();

    expect(map.options.center).toEqual([-115.1728, 36.1147]);
    expect(map.options.zoom).toBe(11);
    expect(map.options.style).toEqual(localStyle('light'));
    expect(map.options.dragPan).toBe(false);
    expect(map.options.attributionControl).toBe(false);
    expect(map.touchZoomRotate.disableRotation).toHaveBeenCalledOnce();
    expect(observer.observed).toBe(map.options.container);
    expect(map.paddings).toEqual([{ top: 10, right: 20, bottom: 30, left: 40 }]);
  });

  it('owns optional controls and releases every browser resource', () => {
    const { runtime, map, observer } = createHarness({
      controls: {
        navigation: { position: 'bottom-right', showCompass: false },
        attribution: { position: 'bottom-right', compact: true },
      },
    });

    expect(map.controls.map(({ position }) => position)).toEqual(['bottom-right', 'bottom-right']);

    runtime.dispose();
    runtime.dispose();

    expect(observer.disconnected).toBe(true);
    expect(map.removed).toBe(true);
    expect(map.listeners.get('moveend')?.size ?? 0).toBe(0);
    expect(map.listeners.get('resize')?.size ?? 0).toBe(0);
  });

  it('resizes the map and refreshes chrome padding when its container changes', () => {
    let top = 10;
    const onResize = vi.fn();
    const { map, observer } = createHarness({
      padding: () => ({ top, right: 20, bottom: 30, left: 40 }),
      onResize,
    });

    top = 50;
    observer.notify();

    expect(map.resizeCount).toBe(1);
    expect(map.paddings.at(-1)).toEqual({ top: 50, right: 20, bottom: 30, left: 40 });
    expect(onResize).toHaveBeenCalledOnce();
  });

  it('publishes a moveend camera without replacing representation or filters', () => {
    const { map, viewStore } = createHarness();
    map.center = [-73.9857, 40.7484];
    map.zoom = 13;

    map.emit('moveend');

    expect(viewStore.getSnapshot()).toEqual({
      schemaVersion: 1,
      camera: { center: [-73.9857, 40.7484], zoom: 13 },
      representationId: 'network',
      filters: { modes: ['bus'] },
    });
  });

  it('restores an external camera replacement without feeding it back to the store', () => {
    const { map, viewStore } = createHarness();
    const listener = vi.fn();
    viewStore.subscribe(listener);

    viewStore.replace({
      schemaVersion: 1,
      camera: { center: [-122.3321, 47.6062], zoom: 10 },
      representationId: 'diagram',
      filters: { modes: ['rail'] },
    });

    expect(map.jumpHistory).toEqual([{ center: [-122.3321, 47.6062], zoom: 10 }]);
    expect(listener).toHaveBeenCalledOnce();
  });

  it('does not move MapLibre when only representation or filters change', () => {
    const { map, viewStore } = createHarness();

    viewStore.setRepresentationId('infrastructure');
    viewStore.setFilter('modes', ['rail']);

    expect(map.jumpHistory).toEqual([]);
  });

  it('hands the local style to the same-theme remote style after content commits', async () => {
    const { runtime, map, fetchStyle, recoverDocumentLayers } = createHarness();

    runtime.milestones.contentCommitted();
    await runtime.flushTheme();

    expect(fetchStyle).toHaveBeenCalledWith(
      'https://styles.test/light.json',
      expect.any(AbortSignal),
    );
    expect(map.style).toEqual(remoteStyle('light'));
    expect(recoverDocumentLayers).toHaveBeenCalledWith('light', false);
  });

  it('defers a theme request until content commits', async () => {
    const fetchStyle = vi.fn((_url: string, _signal: AbortSignal) =>
      Promise.resolve(remoteStyle('dark')),
    );
    const { runtime, map } = createHarness({
      style: {
        local: localStyle,
        remoteUrl: (theme) => `https://styles.test/${theme}.json`,
        fetch: fetchStyle,
        timeoutMs: 1_500,
        online: () => true,
        isInteractionActive: () => false,
        onBaseStyleUnavailable: vi.fn(),
      },
    });

    await runtime.requestTheme('dark');

    expect(fetchStyle).not.toHaveBeenCalled();
    expect(map.style).toEqual(localStyle('dark'));

    runtime.milestones.contentCommitted();
    await runtime.flushTheme();

    expect(fetchStyle).toHaveBeenCalledWith(
      'https://styles.test/dark.json',
      expect.any(AbortSignal),
    );
    expect(map.style).toEqual(remoteStyle('dark'));
  });

  it('keeps the local grid without requesting a style while offline', async () => {
    const reportError = vi.fn();
    const onBaseStyleUnavailable = vi.fn();
    const fetchStyle = vi.fn();
    const { runtime, map } = createHarness({
      reportError,
      style: {
        local: localStyle,
        remoteUrl: (theme) => `https://styles.test/${theme}.json`,
        fetch: fetchStyle,
        timeoutMs: 1_500,
        online: () => false,
        isInteractionActive: () => false,
        onBaseStyleUnavailable,
      },
    });

    runtime.milestones.contentCommitted();
    await runtime.flushTheme();

    expect(fetchStyle).not.toHaveBeenCalled();
    expect(map.style).toEqual(localStyle('light'));
    expect(onBaseStyleUnavailable).toHaveBeenCalledOnce();
    expect(reportError).not.toHaveBeenCalled();
  });

  it('keeps the local grid after the strict style budget without calling a slow host broken', async () => {
    vi.useFakeTimers();
    const pending = deferred<StyleSpecification>();
    const fetchStyle = vi.fn(() => pending.promise);
    const reportError = vi.fn();
    const probe = vi.fn(() => Promise.resolve(true));
    const { runtime, map } = createHarness({
      reportError,
      style: {
        local: localStyle,
        remoteUrl: (theme) => `https://styles.test/${theme}.json`,
        fetch: fetchStyle,
        probe,
        timeoutMs: 250,
        online: () => true,
        isInteractionActive: () => false,
        onBaseStyleUnavailable: vi.fn(),
      },
    });

    runtime.milestones.contentCommitted();
    await vi.advanceTimersByTimeAsync(250);
    await runtime.flushTheme();

    expect(probe).toHaveBeenCalledWith('https://styles.test/light.json');
    expect(reportError).not.toHaveBeenCalled();
    expect(map.style).toEqual(localStyle('light'));
  });

  it('settles the strict style budget without waiting for a stalled reachability probe', async () => {
    vi.useFakeTimers();
    const pendingStyle = deferred<StyleSpecification>();
    const pendingProbe = deferred<boolean>();
    const { runtime, map } = createHarness({
      style: {
        local: localStyle,
        remoteUrl: (theme) => `https://styles.test/${theme}.json`,
        fetch: () => pendingStyle.promise,
        probe: () => pendingProbe.promise,
        timeoutMs: 250,
        online: () => true,
        isInteractionActive: () => false,
        onBaseStyleUnavailable: vi.fn(),
      },
    });
    let settled = false;

    runtime.milestones.contentCommitted();
    void runtime.flushTheme().then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(250);
    await Promise.resolve();

    expect(settled).toBe(true);
    expect(map.style).toEqual(localStyle('light'));
  });

  it('reports an unavailable base style and preserves the local grid', async () => {
    const fetchStyle = vi.fn(() => Promise.reject(new Error('unavailable')));
    const reportError = vi.fn();
    const onBaseStyleUnavailable = vi.fn();
    const { runtime, map } = createHarness({
      reportError,
      style: {
        local: localStyle,
        remoteUrl: (theme) => `https://styles.test/${theme}.json`,
        fetch: fetchStyle,
        timeoutMs: 1_500,
        online: () => true,
        isInteractionActive: () => false,
        onBaseStyleUnavailable,
      },
    });

    runtime.milestones.contentCommitted();
    await runtime.flushTheme();

    expect(onBaseStyleUnavailable).toHaveBeenCalledWith(expect.any(Error));
    expect(reportError).not.toHaveBeenCalled();
    expect(map.style).toEqual(localStyle('light'));
  });

  it('applies later theme requests and ignores stale style responses', async () => {
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
    const { runtime, map } = createHarness({
      style: {
        local: localStyle,
        remoteUrl: (theme) => `https://styles.test/${theme}.json`,
        fetch: fetchStyle,
        timeoutMs: 1_500,
        online: () => true,
        isInteractionActive: () => false,
        onBaseStyleUnavailable: vi.fn(),
      },
    });

    runtime.milestones.contentCommitted();
    const stale = runtime.flushTheme();
    const current = runtime.requestTheme('dark');
    second.resolve(remoteStyle('dark'));
    await Promise.all([stale, current]);

    expect(map.style).toEqual(remoteStyle('dark'));
    expect(map.styles).not.toContainEqual(remoteStyle('light'));
  });

  it('preserves the accepted scene and invokes full recovery when diffing fails', async () => {
    const carry = vi.fn((_previous: StyleSpecification | undefined, next: StyleSpecification) => ({
      ...next,
      metadata: { acceptedScene: true },
    }));
    const recoverDocumentLayers = vi.fn();
    const { runtime, map } = createHarness({
      style: {
        local: localStyle,
        remoteUrl: (theme) => `https://styles.test/${theme}.json`,
        fetch: () => Promise.resolve(remoteStyle('light')),
        carry,
        recoverDocumentLayers,
        timeoutMs: 1_500,
        online: () => true,
        isInteractionActive: () => false,
        onBaseStyleUnavailable: vi.fn(),
      },
    });
    map.failDifferentialStyle = true;

    runtime.milestones.contentCommitted();
    await runtime.flushTheme();

    expect(carry).toHaveBeenCalledOnce();
    expect(map.style.metadata).toEqual({ acceptedScene: true });
    expect(recoverDocumentLayers).toHaveBeenCalledWith('light', true);
  });

  it('carries the current runtime style when MapLibre omits it from the transform callback', async () => {
    const { runtime, map } = createHarness({
      style: {
        local: localStyle,
        remoteUrl: (theme) => `https://styles.test/${theme}.json`,
        fetch: () => Promise.resolve(remoteStyle('light')),
        carry: (previous, next) => ({
          ...next,
          sources: { ...next.sources, ...previous?.sources },
        }),
        timeoutMs: 1_500,
        online: () => true,
        isInteractionActive: () => false,
        onBaseStyleUnavailable: vi.fn(),
      },
    });
    map.style = {
      ...localStyle('light'),
      sources: {
        'tm-stations': {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        },
      },
    };
    map.omitTransformPrevious = true;

    runtime.milestones.contentCommitted();
    await runtime.flushTheme();

    expect(map.style.sources).toHaveProperty('tm-stations');
  });
});
