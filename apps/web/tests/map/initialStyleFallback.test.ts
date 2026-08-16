import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Map as MLMap, StyleSpecification } from 'maplibre-gl';
import {
  attachInitialStyleFallback,
  INITIAL_STYLE_FALLBACK_TIMEOUT_MS,
} from '../../src/map/initialStyleFallback';
import { localBlankStyleForScheme } from '../../src/map/mapTheme';

type StyleEvent = 'error' | 'style.load';

class FakeStyleMap {
  readonly listeners = new Map<StyleEvent, Set<() => void>>();
  readonly setStyle = vi.fn((_style: StyleSpecification, _options?: { diff: false }) => this);

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

  it('falls back on timeout but cancels the timer after the initial style loads', () => {
    vi.useFakeTimers();
    const timedOut = new FakeStyleMap();
    const fallback = vi.fn();
    attachInitialStyleFallback(timedOut as unknown as MLMap, {
      scheme: 'light',
      timeoutMs: 250,
      onFallback: fallback,
    });

    vi.advanceTimersByTime(250);
    expect(fallback).toHaveBeenCalledTimes(1);

    const loaded = new FakeStyleMap();
    const shouldNotFallback = vi.fn();
    attachInitialStyleFallback(loaded as unknown as MLMap, {
      scheme: 'light',
      timeoutMs: 250,
      onFallback: shouldNotFallback,
    });
    loaded.emit('style.load');
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
