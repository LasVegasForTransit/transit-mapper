/* eslint-disable max-lines -- Style lifecycle cases share one asynchronous MapLibre fake. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StyleSpecification } from 'maplibre-gl';
import type { ObservableMapStartupMilestones } from '../src/index';
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

  it('settles every public operation without changing state after disposal', async () => {
    const { runtime, map, observer, fetchStyle, recoverDocumentLayers } = createHarness();
    const milestones = runtime.milestones as ObservableMapStartupMilestones;
    const initialPaddingCount = map.paddings.length;

    runtime.dispose();
    await expect(runtime.requestTheme('dark')).resolves.toBeUndefined();
    milestones.contentCommitted();
    milestones.interactive();
    await expect(runtime.flushTheme()).resolves.toBeUndefined();
    runtime.refreshPadding();
    observer.notify();

    expect(milestones.getSnapshot()).toEqual({ contentCommitted: false, interactive: false });
    expect(fetchStyle).not.toHaveBeenCalled();
    expect(recoverDocumentLayers).not.toHaveBeenCalled();
    expect(map.pendingStyle).toBeUndefined();
    expect(map.paddings).toHaveLength(initialPaddingCount);
    expect(map.resizeCount).toBe(0);
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
    await vi.waitFor(() => expect(map.pendingStyle).toEqual(remoteStyle('light')));
    map.settleStyle();
    await runtime.flushTheme();

    expect(fetchStyle).toHaveBeenCalledWith(
      'https://styles.test/light.json',
      expect.any(AbortSignal),
    );
    expect(map.style).toEqual(remoteStyle('light'));
    expect(recoverDocumentLayers).toHaveBeenCalledWith('light', false);
  });

  it('waits for MapLibre to load a replacement before applying its theme or recovery mode', async () => {
    const { runtime, map, recoverDocumentLayers } = createHarness();

    runtime.milestones.contentCommitted();
    await vi.waitFor(() => expect(map.pendingStyle).toEqual(remoteStyle('light')));

    expect(map.style).toEqual(localStyle('light'));
    expect(recoverDocumentLayers).not.toHaveBeenCalled();

    map.settleStyle();
    await runtime.flushTheme();

    expect(map.style).toEqual(remoteStyle('light'));
    expect(recoverDocumentLayers).toHaveBeenCalledWith('light', false);
  });

  it('does not treat an ordinary MapLibre error as a failed style replacement', async () => {
    const onBaseStyleUnavailable = vi.fn();
    const recoverDocumentLayers = vi.fn();
    const { runtime, map } = createHarness({
      style: {
        local: localStyle,
        remoteUrl: (theme) => `https://styles.test/${theme}.json`,
        fetch: () => Promise.resolve(remoteStyle('light')),
        timeoutMs: 1_500,
        online: () => true,
        isInteractionActive: () => false,
        recoverDocumentLayers,
        onBaseStyleUnavailable,
      },
    });

    runtime.milestones.contentCommitted();
    await vi.waitFor(() => expect(map.pendingStyle).toEqual(remoteStyle('light')));
    map.emit('error', { error: new Error('sprite image is missing') });
    await Promise.resolve();
    await Promise.resolve();

    expect(map.pendingStyle).toEqual(remoteStyle('light'));
    expect(onBaseStyleUnavailable).not.toHaveBeenCalled();
    expect(recoverDocumentLayers).not.toHaveBeenCalled();

    map.settleStyle();
    await runtime.flushTheme();

    expect(map.style).toEqual(remoteStyle('light'));
    expect(recoverDocumentLayers).toHaveBeenCalledWith('light', false);
  });

  it('restores the last usable style when a replacement never reaches style.load', async () => {
    vi.useFakeTimers();
    const onBaseStyleUnavailable = vi.fn();
    const { runtime, map } = createHarness({
      style: {
        local: localStyle,
        remoteUrl: (theme) => `https://styles.test/${theme}.json`,
        fetch: () => Promise.resolve(remoteStyle('light')),
        timeoutMs: 250,
        online: () => true,
        isInteractionActive: () => false,
        onBaseStyleUnavailable,
      },
    });

    runtime.milestones.contentCommitted();
    await vi.advanceTimersByTimeAsync(0);
    expect(map.pendingStyle).toEqual(remoteStyle('light'));

    await vi.advanceTimersByTimeAsync(250);

    expect(map.pendingStyle).toEqual(localStyle('light'));
    expect(onBaseStyleUnavailable).toHaveBeenCalledOnce();

    map.settleStyle();
    await runtime.flushTheme();
    expect(map.style).toEqual(localStyle('light'));
  });

  it('restores the last usable remote style when a later replacement never loads', async () => {
    vi.useFakeTimers();
    const onBaseStyleUnavailable = vi.fn();
    const { runtime, map } = createHarness({
      style: {
        local: localStyle,
        remoteUrl: (theme) => `https://styles.test/${theme}.json`,
        fetch: (url) => Promise.resolve(remoteStyle(url.includes('/dark.json') ? 'dark' : 'light')),
        timeoutMs: 250,
        online: () => true,
        isInteractionActive: () => false,
        onBaseStyleUnavailable,
      },
    });

    runtime.milestones.contentCommitted();
    await vi.advanceTimersByTimeAsync(0);
    map.settleStyle();
    await runtime.flushTheme();

    const darkRequest = runtime.requestTheme('dark');
    await vi.advanceTimersByTimeAsync(0);
    expect(map.pendingStyle).toEqual(remoteStyle('dark'));
    map.failStyle(new Error('dark style failed'));
    await vi.advanceTimersByTimeAsync(250);
    expect(map.pendingStyle).toEqual(remoteStyle('light'));
    map.settleStyle();
    await darkRequest;

    expect(map.style).toEqual(remoteStyle('light'));
    expect(onBaseStyleUnavailable).toHaveBeenCalledOnce();
  });

  it('lets only the current transition settle from a later style.load event', async () => {
    const recoverDocumentLayers = vi.fn();
    const { runtime, map } = createHarness({
      style: {
        local: localStyle,
        remoteUrl: (theme) => `https://styles.test/${theme}.json`,
        fetch: (url) => Promise.resolve(remoteStyle(url.includes('/dark.json') ? 'dark' : 'light')),
        timeoutMs: 1_500,
        online: () => true,
        isInteractionActive: () => false,
        recoverDocumentLayers,
        onBaseStyleUnavailable: vi.fn(),
      },
    });

    runtime.milestones.contentCommitted();
    await vi.waitFor(() => expect(map.pendingStyle).toEqual(remoteStyle('light')));
    const current = runtime.requestTheme('dark');
    await vi.waitFor(() => expect(map.pendingStyle).toEqual(remoteStyle('dark')));

    map.emit('style.load');
    await Promise.resolve();
    expect(recoverDocumentLayers).not.toHaveBeenCalled();

    map.settleStyle();
    await current;

    expect(map.style).toEqual(remoteStyle('dark'));
    expect(recoverDocumentLayers.mock.calls).toEqual([['dark', false]]);
  });

  it('never records an unsettled replacement as the rollback style', async () => {
    vi.useFakeTimers();
    const { runtime, map } = createHarness({
      style: {
        local: localStyle,
        remoteUrl: (theme) => `https://styles.test/${theme}.json`,
        fetch: (url) => Promise.resolve(remoteStyle(url.includes('/dark.json') ? 'dark' : 'light')),
        timeoutMs: 250,
        online: () => true,
        isInteractionActive: () => false,
        onBaseStyleUnavailable: vi.fn(),
      },
    });

    runtime.milestones.contentCommitted();
    await vi.advanceTimersByTimeAsync(0);
    expect(map.pendingStyle).toEqual(remoteStyle('light'));
    map.style = remoteStyle('unsettled-light');

    const current = runtime.requestTheme('dark');
    await vi.advanceTimersByTimeAsync(0);
    expect(map.pendingStyle).toEqual(remoteStyle('dark'));
    map.failStyle(new Error('dark style failed'));
    await vi.advanceTimersByTimeAsync(250);

    expect(map.pendingStyle).toEqual(localStyle('light'));
    map.settleStyle();
    await current;
    expect(map.style).toEqual(localStyle('light'));
  });

  it('reports a full recovery only after MapLibre settles without the carried document state', async () => {
    const recoverDocumentLayers = vi.fn();
    const { runtime, map } = createHarness({
      style: {
        local: localStyle,
        remoteUrl: (theme) => `https://styles.test/${theme}.json`,
        fetch: () => Promise.resolve(remoteStyle('light')),
        carry: (_previous, next) => ({
          ...next,
          sources: {
            ...next.sources,
            'tm-stations': {
              type: 'geojson',
              data: { type: 'FeatureCollection', features: [] },
            },
          },
        }),
        isDocumentStateRetained: () => false,
        recoverDocumentLayers,
        timeoutMs: 1_500,
        online: () => true,
        isInteractionActive: () => false,
        onBaseStyleUnavailable: vi.fn(),
      },
    });

    runtime.milestones.contentCommitted();
    await vi.waitFor(() => expect(map.pendingStyle).toBeDefined());
    map.settleStyle({ rebuilt: true });
    await runtime.flushTheme();

    expect(map.style.sources).not.toHaveProperty('tm-stations');
    expect(recoverDocumentLayers).toHaveBeenCalledWith('light', true);
  });

  it('restores the local bootstrap after the initial remote replacement fails asynchronously', async () => {
    vi.useFakeTimers();
    const onBaseStyleUnavailable = vi.fn();
    const { runtime, map } = createHarness({
      style: {
        local: localStyle,
        remoteUrl: (theme) => `https://styles.test/${theme}.json`,
        fetch: () => Promise.resolve(remoteStyle('light')),
        timeoutMs: 250,
        online: () => true,
        isInteractionActive: () => false,
        onBaseStyleUnavailable,
      },
    });

    runtime.milestones.contentCommitted();
    await vi.advanceTimersByTimeAsync(0);
    expect(map.pendingStyle).toEqual(remoteStyle('light'));
    map.failStyle(new Error('style source failed'));
    await vi.advanceTimersByTimeAsync(250);
    expect(map.pendingStyle).toEqual(localStyle('light'));
    map.settleStyle();
    await runtime.flushTheme();

    expect(map.style).toEqual(localStyle('light'));
    expect(onBaseStyleUnavailable).toHaveBeenCalledOnce();
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

    const localRequest = runtime.requestTheme('dark');
    await vi.waitFor(() => expect(map.pendingStyle).toEqual(localStyle('dark')));
    map.settleStyle();
    await localRequest;

    expect(fetchStyle).not.toHaveBeenCalled();
    expect(map.style).toEqual(localStyle('dark'));

    runtime.milestones.contentCommitted();
    await vi.waitFor(() => expect(map.pendingStyle).toEqual(remoteStyle('dark')));
    map.settleStyle();
    await runtime.flushTheme();

    expect(fetchStyle).toHaveBeenCalledWith(
      'https://styles.test/dark.json',
      expect.any(AbortSignal),
    );
    expect(map.style).toEqual(remoteStyle('dark'));
  });

  it('changes the pre-content bootstrap without document carry or recovery', async () => {
    const carry = vi.fn(
      (_previous: StyleSpecification | undefined, next: StyleSpecification) => next,
    );
    const recoverDocumentLayers = vi.fn();
    const { runtime, map } = createHarness({
      style: {
        local: localStyle,
        remoteUrl: (theme) => `https://styles.test/${theme}.json`,
        fetch: () => Promise.resolve(remoteStyle('dark')),
        carry,
        recoverDocumentLayers,
        timeoutMs: 1_500,
        online: () => true,
        isInteractionActive: () => false,
        onBaseStyleUnavailable: vi.fn(),
      },
    });

    const request = runtime.requestTheme('dark');
    await vi.waitFor(() => expect(map.pendingStyle).toEqual(localStyle('dark')));

    expect(carry).not.toHaveBeenCalled();
    expect(recoverDocumentLayers).not.toHaveBeenCalled();

    map.settleStyle();
    await request;

    expect(map.style).toEqual(localStyle('dark'));
    expect(carry).not.toHaveBeenCalled();
    expect(recoverDocumentLayers).not.toHaveBeenCalled();
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

  it('ignores a rejected reachability probe after disposal without an unhandled rejection', async () => {
    vi.useFakeTimers();
    const pendingStyle = deferred<StyleSpecification>();
    const pendingProbe = deferred<boolean>();
    const onBaseStyleUnavailable = vi.fn();
    const { runtime, map } = createHarness({
      style: {
        local: localStyle,
        remoteUrl: (theme) => `https://styles.test/${theme}.json`,
        fetch: () => pendingStyle.promise,
        probe: () => pendingProbe.promise,
        timeoutMs: 250,
        online: () => true,
        isInteractionActive: () => false,
        onBaseStyleUnavailable,
      },
    });

    runtime.milestones.contentCommitted();
    await vi.advanceTimersByTimeAsync(250);
    runtime.dispose();
    pendingProbe.reject(new Error('probe failed'));
    await Promise.resolve();
    await Promise.resolve();

    await expect(runtime.requestTheme('dark')).resolves.toBeUndefined();
    await expect(runtime.flushTheme()).resolves.toBeUndefined();
    expect(map.pendingStyle).toBeUndefined();
    expect(onBaseStyleUnavailable).not.toHaveBeenCalled();
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
    await vi.waitFor(() => expect(map.pendingStyle).toEqual(remoteStyle('dark')));
    map.settleStyle();
    await Promise.all([stale, current]);

    expect(map.style).toEqual(remoteStyle('dark'));
    expect(map.styles).not.toContainEqual(remoteStyle('light'));
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
    await vi.waitFor(() => expect(map.pendingStyle).toBeDefined());
    map.settleStyle();
    await runtime.flushTheme();

    expect(map.style.sources).toHaveProperty('tm-stations');
  });
});
