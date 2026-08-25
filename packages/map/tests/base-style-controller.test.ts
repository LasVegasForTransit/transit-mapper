import { describe, expect, it, vi } from 'vitest';
import type { Map as MapLibreMap, MapOptions, StyleSpecification } from 'maplibre-gl';
import { createBaseStyleController } from '../src/index';
import { FakeMap, localStyle, remoteStyle } from './support/map-runtime-harness.test';

describe('createBaseStyleController', () => {
  it('contains a rebuilt theme callback failure before later style listeners run', async () => {
    const map = new FakeMap({
      container: {},
      center: [0, 0],
      zoom: 1,
      style: localStyle('light'),
    } as MapOptions);
    const hostFailure = new Error('host theme failed');
    const reportError = vi.fn(() => {
      throw new Error('error reporter failed');
    });
    const onUnavailable = vi.fn();
    const laterStyleListener = vi.fn();
    const controller = createBaseStyleController({
      map: map as unknown as MapLibreMap,
      initialTheme: 'light',
      local: localStyle,
      remoteUrl: (theme) => `https://styles.test/${theme}.json`,
      fetch: () => Promise.resolve(remoteStyle('dark')),
      onThemeApplied: () => {
        throw hostFailure;
      },
      reportError,
      timeoutMs: 250,
      online: () => true,
      isInteractionActive: () => false,
      onUnavailable,
    });
    map.on('style.load', laterStyleListener);
    let settled = false;
    const request = controller.request('dark').then(() => {
      settled = true;
    });
    await vi.waitFor(() => expect(map.pendingStyle).toEqual(remoteStyle('dark')));

    let dispatchError: unknown;
    try {
      map.settleStyle({ rebuilt: true });
    } catch (error) {
      dispatchError = error;
    }
    const settledBeforeDeadline = await Promise.race([
      request.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 20)),
    ]);
    controller.dispose();
    await request;

    expect(dispatchError).toBeUndefined();
    expect(settledBeforeDeadline).toBe(true);
    expect(settled).toBe(true);
    expect(laterStyleListener).toHaveBeenCalledOnce();
    expect(map.style.layers[0]?.id).toBe('remote-dark');
    expect(map.pendingStyle).toBeUndefined();
    expect(map.styles.map((style) => style.layers[0]?.id)).toEqual(['local-light', 'remote-dark']);
    expect(reportError).toHaveBeenCalledExactlyOnceWith(hostFailure);
    expect(onUnavailable).not.toHaveBeenCalled();
  });

  it('contains a synchronous theme callback failure without rolling back the applied style', async () => {
    const map = new FakeMap({
      container: {},
      center: [0, 0],
      zoom: 1,
      style: localStyle('light'),
    } as MapOptions);
    map.diffStyleBehavior = 'synchronous';
    const hostFailure = new Error('host theme failed');
    const reportError = vi.fn();
    const onUnavailable = vi.fn();
    const controller = createBaseStyleController({
      map: map as unknown as MapLibreMap,
      initialTheme: 'light',
      local: localStyle,
      remoteUrl: (theme) => `https://styles.test/${theme}.json`,
      fetch: () => Promise.resolve(remoteStyle('dark')),
      onThemeApplied: () => {
        throw hostFailure;
      },
      reportError,
      timeoutMs: 250,
      online: () => true,
      isInteractionActive: () => false,
      onUnavailable,
    });
    let settled = false;
    const request = controller.request('dark').then(() => {
      settled = true;
    });
    await vi.waitFor(() => expect(map.style.layers[0]?.id).toBe('remote-dark'));
    const settledBeforeDeadline = await Promise.race([
      request.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 20)),
    ]);
    const pendingBeforeDisposal = map.pendingStyle;
    controller.dispose();
    await request;

    expect(settledBeforeDeadline).toBe(true);
    expect(settled).toBe(true);
    expect(pendingBeforeDisposal).toBeUndefined();
    expect(map.style.layers[0]?.id).toBe('remote-dark');
    expect(map.styles.map((style) => style.layers[0]?.id)).toEqual(['local-light', 'remote-dark']);
    expect(reportError).toHaveBeenCalledExactlyOnceWith(hostFailure);
    expect(onUnavailable).not.toHaveBeenCalled();
  });

  it('publishes a rebuilt local theme before later style listeners restore host layers', async () => {
    const map = new FakeMap({
      container: {},
      center: [0, 0],
      zoom: 1,
      style: localStyle('light'),
    } as MapOptions);
    let hostTheme: 'light' | 'dark' = 'light';
    const controller = createBaseStyleController<'light' | 'dark'>({
      map: map as unknown as MapLibreMap,
      initialTheme: hostTheme,
      local: localStyle,
      remoteUrl: (theme) => `https://styles.test/${theme}.json`,
      fetch: () => Promise.resolve(remoteStyle('dark')),
      onThemeApplied: (theme) => {
        hostTheme = theme;
      },
      timeoutMs: 250,
      online: () => true,
      isInteractionActive: () => false,
      reportError: vi.fn(),
      onUnavailable: vi.fn(),
    });
    map.on('style.load', () => {
      const style = map.getStyle();
      map.style = {
        ...style,
        layers: style.layers.map((layer) =>
          layer.type === 'background'
            ? {
                ...layer,
                paint: { 'background-color': hostTheme === 'dark' ? '#111111' : '#eeeeee' },
              }
            : layer,
        ),
      };
    });

    const request = controller.selectLocal('dark');
    await vi.waitFor(() => expect(map.pendingStyle).toEqual(localStyle('dark')));
    map.settleStyle({ rebuilt: true });
    await request;

    expect(map.style.layers[0]).toMatchObject({
      paint: { 'background-color': '#111111' },
    });
    controller.dispose();
  });

  it('accepts a successful MapLibre diff without waiting for style.load', async () => {
    const map = new FakeMap({
      container: {},
      center: [0, 0],
      zoom: 1,
      style: localStyle('light'),
    } as MapOptions);
    map.diffStyleBehavior = 'synchronous';
    const onUnavailable = vi.fn();
    const controller = createBaseStyleController({
      map: map as unknown as MapLibreMap,
      initialTheme: 'light',
      local: localStyle,
      remoteUrl: (theme) => `https://styles.test/${theme}.json`,
      fetch: () => Promise.resolve(remoteStyle('dark')),
      timeoutMs: 250,
      online: () => true,
      isInteractionActive: () => false,
      reportError: vi.fn(),
      onUnavailable,
    });

    let settled = false;
    const request = controller.request('dark').then(() => {
      settled = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await vi.waitFor(() => expect(map.style.layers[0]?.id).toBe('remote-dark'));

    expect(settled).toBe(true);
    expect(onUnavailable).not.toHaveBeenCalled();

    controller.dispose();
    await request;
  });

  it('keeps transition identity when host carry returns a fresh style', async () => {
    const map = new FakeMap({
      container: {},
      center: [0, 0],
      zoom: 1,
      style: localStyle('light'),
    } as MapOptions);
    map.diffStyleBehavior = 'synchronous';
    const onUnavailable = vi.fn();
    const controller = createBaseStyleController({
      map: map as unknown as MapLibreMap,
      initialTheme: 'light',
      local: localStyle,
      remoteUrl: (theme) => `https://styles.test/${theme}.json`,
      fetch: () => Promise.resolve(remoteStyle('dark')),
      carry: (_previous, next) => ({
        version: 8,
        sources: { ...next.sources },
        layers: [...next.layers],
      }),
      timeoutMs: 250,
      online: () => true,
      isInteractionActive: () => false,
      reportError: vi.fn(),
      onUnavailable,
    });
    let settled = false;

    const request = controller.request('dark').then(() => {
      settled = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await vi.waitFor(() => expect(map.style.layers[0]?.id).toBe('remote-dark'));

    expect(settled).toBe(true);
    expect(onUnavailable).not.toHaveBeenCalled();

    controller.dispose();
    await request;
  });

  it('treats an embed starting on a remote style as already usable', async () => {
    const map = new FakeMap({
      container: {},
      center: [0, 0],
      zoom: 1,
      style: remoteStyle('light'),
    } as MapOptions);
    const fetchStyle = vi.fn(() => Promise.resolve(remoteStyle('light')));
    const controller = createBaseStyleController({
      map: map as unknown as MapLibreMap,
      initialTheme: 'light',
      initialStyle: 'remote',
      local: localStyle,
      remoteUrl: (theme) => `https://styles.test/${theme}.json`,
      fetch: fetchStyle,
      timeoutMs: 250,
      online: () => true,
      isInteractionActive: () => false,
      reportError: vi.fn(),
      onUnavailable: vi.fn(),
    });

    const request = controller.request('light');
    await Promise.resolve();
    await Promise.resolve();
    const fetchCalls = fetchStyle.mock.calls.length;
    controller.dispose();
    await request;

    expect(fetchCalls).toBe(0);
    expect(map.style).toEqual(remoteStyle('light'));
    expect(map.pendingStyle).toBeUndefined();
  });

  it('settles every operation without touching MapLibre after disposal', async () => {
    const map = new FakeMap({
      container: {},
      center: [0, 0],
      zoom: 1,
      style: localStyle('light'),
    } as MapOptions);
    const fetchStyle = vi.fn(() => Promise.resolve(remoteStyle('dark')));
    const controller = createBaseStyleController({
      map: map as unknown as MapLibreMap,
      initialTheme: 'light',
      local: localStyle,
      remoteUrl: (theme) => `https://styles.test/${theme}.json`,
      fetch: fetchStyle,
      timeoutMs: 250,
      online: () => true,
      isInteractionActive: () => false,
      reportError: vi.fn(),
      onUnavailable: vi.fn(),
    });

    controller.dispose();

    await expect(controller.request('dark')).resolves.toBeUndefined();
    await expect(controller.selectLocal('dark')).resolves.toBeUndefined();
    await expect(controller.flush()).resolves.toBeUndefined();
    expect(fetchStyle).not.toHaveBeenCalled();
    expect(map.pendingStyle).toBeUndefined();
  });

  it('settles an in-flight request when disposal aborts an uncooperative fetch', async () => {
    vi.useFakeTimers();
    const map = new FakeMap({
      container: {},
      center: [0, 0],
      zoom: 1,
      style: localStyle('light'),
    } as MapOptions);
    const controller = createBaseStyleController({
      map: map as unknown as MapLibreMap,
      initialTheme: 'light',
      local: localStyle,
      remoteUrl: (theme) => `https://styles.test/${theme}.json`,
      fetch: () => new Promise<StyleSpecification>(() => {}),
      timeoutMs: 250,
      online: () => true,
      isInteractionActive: () => false,
      reportError: vi.fn(),
      onUnavailable: vi.fn(),
    });

    const request = controller.request('dark');
    await Promise.resolve();
    controller.dispose();

    await expect(request).resolves.toBeUndefined();
    expect(map.pendingStyle).toBeUndefined();
    vi.useRealTimers();
  });

  it('reports a rejected active reachability probe once', async () => {
    vi.useFakeTimers();
    const map = new FakeMap({
      container: {},
      center: [0, 0],
      zoom: 1,
      style: localStyle('light'),
    } as MapOptions);
    const onUnavailable = vi.fn();
    const controller = createBaseStyleController({
      map: map as unknown as MapLibreMap,
      initialTheme: 'light',
      local: localStyle,
      remoteUrl: (theme) => `https://styles.test/${theme}.json`,
      fetch: () => new Promise<StyleSpecification>(() => {}),
      probe: () => Promise.reject(new Error('probe failed')),
      timeoutMs: 250,
      online: () => true,
      isInteractionActive: () => false,
      reportError: vi.fn(),
      onUnavailable,
    });

    const request = controller.request('dark');
    await vi.advanceTimersByTimeAsync(250);
    await request;
    await Promise.resolve();

    expect(onUnavailable).toHaveBeenCalledOnce();
    controller.dispose();
    vi.useRealTimers();
  });
});
