import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Map as MLMap, StyleSpecification } from 'maplibre-gl';
import {
  attachInitialStyleFallback,
  INITIAL_STYLE_FALLBACK_TIMEOUT_MS,
} from '../../src/map/initialStyleFallback';
import { basemapStyleForScheme, localBlankStyleForScheme } from '../../src/map/mapTheme';

type StyleEvent = 'error' | 'load' | 'style.load';

class FakeStyleMap {
  readonly listeners = new Map<StyleEvent, Set<() => void>>();
  readonly setStyle = vi.fn(
    (_style: StyleSpecification | string, _options?: { diff: false }) => this,
  );

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
    const adopted = vi.fn();
    attachInitialStyleFallback(map as unknown as MLMap, {
      scheme: 'light',
      timeoutMs: 250,
      onFallback: fallback,
      onAdopted: adopted,
      probeBasemap: () => Promise.resolve(false),
    });

    vi.advanceTimersByTime(250);

    await vi.waitFor(() => expect(fallback).toHaveBeenCalledTimes(1));
    expect(adopted).not.toHaveBeenCalled();
    expect(map.setStyle).toHaveBeenCalledTimes(1);
  });

  it('shows the grid on timeout without reporting a failure', async () => {
    vi.useFakeTimers();
    const timedOut = new FakeStyleMap();
    const fallback = vi.fn();
    const adopted = vi.fn();
    attachInitialStyleFallback(timedOut as unknown as MLMap, {
      scheme: 'light',
      timeoutMs: 250,
      onFallback: fallback,
      onAdopted: adopted,
      probeBasemap: () => Promise.resolve(true),
    });

    vi.advanceTimersByTime(250);
    // The grid arrives immediately so the editor is usable...
    expect(timedOut.setStyle).toHaveBeenCalledWith(localBlankStyleForScheme('light'), {
      diff: false,
    });
    // ...but a slow basemap is not a broken one, so nobody is told it failed.
    await vi.waitFor(() => expect(adopted).toHaveBeenCalledTimes(1));
    expect(fallback).not.toHaveBeenCalled();
    expect(timedOut.setStyle).toHaveBeenLastCalledWith(basemapStyleForScheme('light'), {
      diff: false,
    });

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
