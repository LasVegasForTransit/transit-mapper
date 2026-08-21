import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Map as MLMap, StyleSpecification } from 'maplibre-gl';
import {
  attachInitialStyleFallback,
  INITIAL_STYLE_FALLBACK_TIMEOUT_MS,
} from '../../src/map/initialStyleFallback';
import { LOCAL_BACKGROUND_LAYER_ID, localBlankStyleForScheme } from '../../src/map/mapTheme';

type StyleEvent = 'error' | 'load' | 'style.load';

class FakeStyleMap {
  readonly listeners = new Map<StyleEvent, Set<() => void>>();
  private localStyleCommitted = false;
  readonly setStyle = vi.fn(
    (_style: StyleSpecification | string, _options?: { diff: false }) => this,
  );

  getLayer(id: string): object | undefined {
    return id === LOCAL_BACKGROUND_LAYER_ID && this.localStyleCommitted ? {} : undefined;
  }

  on(event: StyleEvent, listener: () => void): this {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  off(event: StyleEvent, listener: () => void): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  emit(event: StyleEvent): void {
    for (const listener of this.listeners.get(event) ?? []) listener();
  }

  commitLocalStyle(): void {
    this.localStyleCommitted = true;
    this.emit('style.load');
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe('initial map style fallback', () => {
  it('falls back early enough to leave time inside the first-map budget', () => {
    expect(INITIAL_STYLE_FALLBACK_TIMEOUT_MS).toBeLessThan(3_500 / 2);
  });

  it('switches to the local blank style once when the remote style errors', () => {
    const map = new FakeStyleMap();
    const onFallback = vi.fn();
    const detach = attachInitialStyleFallback(map as unknown as MLMap, {
      scheme: 'dark',
      timeoutMs: 1_000,
      onFallback,
    });

    map.emit('error');
    map.emit('error');

    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(map.setStyle).toHaveBeenCalledTimes(1);
    expect(map.setStyle).toHaveBeenCalledWith(localBlankStyleForScheme('dark'), { diff: false });

    detach();
  });

  it('falls back when the style loads but its first useful map frame does not', () => {
    const map = new FakeStyleMap();
    const fallback = vi.fn();
    attachInitialStyleFallback(map as unknown as MLMap, {
      scheme: 'light',
      timeoutMs: 250,
      onFallback: fallback,
    });

    map.emit('style.load');
    map.emit('error');

    expect(fallback).toHaveBeenCalledTimes(1);
    expect(map.setStyle).toHaveBeenCalledWith(localBlankStyleForScheme('light'), { diff: false });
  });

  it('reports a failure only when the basemap is genuinely unreachable', async () => {
    vi.useFakeTimers();
    const map = new FakeStyleMap();
    const fallback = vi.fn();
    attachInitialStyleFallback(map as unknown as MLMap, {
      scheme: 'light',
      timeoutMs: 250,
      onFallback: fallback,
      probeBasemap: () => Promise.resolve(false),
    });

    vi.advanceTimersByTime(250);

    await vi.waitFor(() => expect(fallback).toHaveBeenCalledTimes(1));
    expect(map.setStyle).toHaveBeenCalledTimes(1);
    expect(map.setStyle).toHaveBeenCalledWith(localBlankStyleForScheme('light'), {
      diff: false,
    });
  });

  it('keeps the grid after a reachable basemap times out', async () => {
    vi.useFakeTimers();
    const timedOut = new FakeStyleMap();
    const fallback = vi.fn();
    const onLocalStyleSelected = vi.fn();
    attachInitialStyleFallback(timedOut as unknown as MLMap, {
      scheme: 'light',
      timeoutMs: 250,
      onFallback: fallback,
      onLocalStyleSelected,
      probeBasemap: () => Promise.resolve(true),
    });

    vi.advanceTimersByTime(250);
    expect(timedOut.setStyle).toHaveBeenCalledWith(localBlankStyleForScheme('light'), {
      diff: false,
    });
    await vi.waitFor(() => expect(timedOut.setStyle).toHaveBeenCalledTimes(1));
    expect(fallback).not.toHaveBeenCalled();
    expect(onLocalStyleSelected).toHaveBeenCalledOnce();
    expect(timedOut.setStyle).toHaveBeenLastCalledWith(localBlankStyleForScheme('light'), {
      diff: false,
    });
  });

  it('does not replace a map that produced its first usable frame', () => {
    vi.useFakeTimers();
    const loaded = new FakeStyleMap();
    const shouldNotFallback = vi.fn();
    attachInitialStyleFallback(loaded as unknown as MLMap, {
      scheme: 'light',
      timeoutMs: 250,
      onFallback: shouldNotFallback,
    });
    loaded.emit('load');
    vi.advanceTimersByTime(250);

    expect(shouldNotFallback).not.toHaveBeenCalled();
    expect(loaded.setStyle).not.toHaveBeenCalled();
  });

  it('settles startup when the remote map produces its first usable frame', () => {
    const map = new FakeStyleMap();
    const onSettled = vi.fn();
    attachInitialStyleFallback(map as unknown as MLMap, {
      scheme: 'light',
      timeoutMs: 250,
      onFallback: vi.fn(),
      onSettled,
    });

    map.emit('load');
    map.emit('load');

    expect(onSettled).toHaveBeenCalledOnce();
  });

  it('settles startup when the local fallback style becomes usable', () => {
    vi.useFakeTimers();
    const map = new FakeStyleMap();
    const onSettled = vi.fn();
    attachInitialStyleFallback(map as unknown as MLMap, {
      scheme: 'dark',
      timeoutMs: 250,
      onFallback: vi.fn(),
      onSettled,
    });

    vi.advanceTimersByTime(250);
    expect(onSettled).not.toHaveBeenCalled();

    map.commitLocalStyle();

    expect(onSettled).toHaveBeenCalledOnce();
  });

  it('does not settle on a late event from the abandoned remote style', () => {
    vi.useFakeTimers();
    const map = new FakeStyleMap();
    const onSettled = vi.fn();
    attachInitialStyleFallback(map as unknown as MLMap, {
      scheme: 'dark',
      timeoutMs: 250,
      onFallback: vi.fn(),
      onSettled,
    });

    vi.advanceTimersByTime(250);
    map.emit('style.load');
    map.emit('load');

    expect(onSettled).not.toHaveBeenCalled();

    map.commitLocalStyle();

    expect(onSettled).toHaveBeenCalledOnce();
  });

  it('does not adopt the remote style after the local fallback loads', () => {
    vi.useFakeTimers();
    const map = new FakeStyleMap();
    attachInitialStyleFallback(map as unknown as MLMap, {
      scheme: 'light',
      timeoutMs: 250,
      onFallback: vi.fn(),
    });

    vi.advanceTimersByTime(250);
    map.commitLocalStyle();
    map.emit('load');

    expect(map.setStyle).toHaveBeenCalledTimes(1);
    expect(map.setStyle).toHaveBeenLastCalledWith(localBlankStyleForScheme('light'), {
      diff: false,
    });
  });

  it('ignores a pending reachability probe after disposal', async () => {
    vi.useFakeTimers();
    const map = new FakeStyleMap();
    const fallback = vi.fn();
    let resolveProbe!: (reachable: boolean) => void;
    const probe = new Promise<boolean>((resolve) => {
      resolveProbe = resolve;
    });
    const detach = attachInitialStyleFallback(map as unknown as MLMap, {
      scheme: 'light',
      timeoutMs: 250,
      onFallback: fallback,
      probeBasemap: () => probe,
    });

    vi.advanceTimersByTime(250);
    detach();
    resolveProbe(false);
    await Promise.resolve();
    map.emit('error');

    expect(fallback).not.toHaveBeenCalled();
    expect(map.setStyle).toHaveBeenCalledTimes(1);
  });

  it('forgets an expired fallback timer before the replacement style loads', () => {
    vi.useFakeTimers();
    const map = new FakeStyleMap();
    const clearTimer = vi.spyOn(globalThis, 'clearTimeout');
    attachInitialStyleFallback(map as unknown as MLMap, {
      scheme: 'light',
      timeoutMs: 250,
      onFallback: vi.fn(),
    });

    vi.advanceTimersByTime(250);
    clearTimer.mockClear();
    map.emit('style.load');

    expect(clearTimer).not.toHaveBeenCalled();
  });
});
