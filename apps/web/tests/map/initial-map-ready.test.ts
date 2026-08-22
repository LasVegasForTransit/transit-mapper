import { describe, expect, it, vi } from 'vitest';
import {
  attachInitialMapReady,
  shouldScheduleInitialReadyDocument,
  shouldProjectInitialDocument,
} from '../../src/map/initial-map-ready';

type StyleEvent = 'style.load' | 'idle';

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
    if (event === 'style.load') {
      this.styleLoaded = true;
      this.styleKnown = true;
    }
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
  it('does not project the placeholder while document bootstrap is still loading', () => {
    expect(shouldProjectInitialDocument('loading')).toBe(false);
    expect(shouldProjectInitialDocument('ready')).toBe(true);
  });

  it('requests the ready document when map setup finishes before subscription starts', () => {
    expect(shouldScheduleInitialReadyDocument('ready', false)).toBe(true);
    expect(shouldScheduleInitialReadyDocument('loading', false)).toBe(false);
    expect(shouldScheduleInitialReadyDocument('ready', true)).toBe(false);
  });

  it('starts the editor when the fallback style becomes usable', () => {
    const map = new FakeMap();
    const startEditor = vi.fn(() => true);

    attachInitialMapReady(map, startEditor);
    map.emit('style.load');

    expect(startEditor).toHaveBeenCalledTimes(1);
  });

  it('starts the editor when a cached style loaded before setup finished', () => {
    const map = new FakeMap();
    const startEditor = vi.fn(() => true);
    map.setStyleLoaded();

    attachInitialMapReady(map, startEditor);

    expect(startEditor).toHaveBeenCalledTimes(1);
  });

  it('waits for MapLibre to finish loading before mutating a parsed style', () => {
    const map = new FakeMap();
    const startEditor = vi.fn(() => true);
    map.setStyleKnown();

    attachInitialMapReady(map, startEditor);

    expect(startEditor).not.toHaveBeenCalled();

    map.emit('style.load');

    expect(startEditor).toHaveBeenCalledTimes(1);
  });

  it('retries initialization after a stale style event rejects overlay mutation', () => {
    const map = new FakeMap();
    const startEditor = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);

    attachInitialMapReady(map, startEditor);
    map.emit('style.load');

    expect(startEditor).toHaveBeenCalledOnce();

    map.emit('idle');

    expect(startEditor).toHaveBeenCalledTimes(2);
  });
});
