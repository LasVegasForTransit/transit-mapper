import { describe, expect, it, vi } from 'vitest';
import { attachInitialMapReady } from '../../src/map/initial-map-ready';

type StyleEvent = 'style.load';

class FakeMap {
  private readonly listeners = new Map<StyleEvent, Set<() => void>>();
  private styleLoaded = false;
  private styleKnown = false;

  isStyleLoaded(): boolean {
    return this.styleLoaded;
  }

  getStyle(): object | undefined {
    return this.styleKnown ? {} : undefined;
  }

  once(event: StyleEvent, listener: () => void): this {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  emit(event: StyleEvent): void {
    this.styleLoaded = true;
    this.styleKnown = true;
    for (const listener of this.listeners.get(event) ?? []) listener();
    this.listeners.delete(event);
  }

  setStyleLoaded(): void {
    this.styleLoaded = true;
    this.styleKnown = true;
  }

  setStyleKnown(): void {
    this.styleKnown = true;
  }
}

describe('initial map readiness', () => {
  it('starts the editor when the fallback style becomes usable', () => {
    const map = new FakeMap();
    const startEditor = vi.fn();

    attachInitialMapReady(map, startEditor);
    map.emit('style.load');

    expect(startEditor).toHaveBeenCalledTimes(1);
  });

  it('starts the editor when a cached style loaded before setup finished', () => {
    const map = new FakeMap();
    const startEditor = vi.fn();
    map.setStyleLoaded();

    attachInitialMapReady(map, startEditor);

    expect(startEditor).toHaveBeenCalledTimes(1);
  });

  it('waits for MapLibre to finish loading before mutating a parsed style', () => {
    const map = new FakeMap();
    const startEditor = vi.fn();
    map.setStyleKnown();

    attachInitialMapReady(map, startEditor);

    expect(startEditor).not.toHaveBeenCalled();

    map.emit('style.load');

    expect(startEditor).toHaveBeenCalledTimes(1);
  });
});
