import { describe, expect, it, vi } from 'vitest';
import {
  attachInitialMapReady,
  publishDocumentMapStartup,
  resumeInitialReadyDocument,
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

  it('requests the ready document when no scene has reached a renderer bank', () => {
    expect(shouldScheduleInitialReadyDocument('ready', false)).toBe(true);
    expect(shouldScheduleInitialReadyDocument('loading', false)).toBe(false);
    expect(shouldScheduleInitialReadyDocument('ready', true)).toBe(false);
  });

  it('releases the deferred base style when an accepted scene settles', () => {
    const contentCommitted = vi.fn();
    const interactive = vi.fn();
    const flushTheme = vi.fn();

    publishDocumentMapStartup({
      documentReady: true,
      documentHasContent: true,
      hasAcceptedScene: true,
      interactionsAttached: true,
      milestones: { contentCommitted, interactive },
      flushTheme,
    });

    expect(contentCommitted).toHaveBeenCalledOnce();
    expect(interactive).toHaveBeenCalledOnce();
    expect(flushTheme).toHaveBeenCalledOnce();
  });

  it('requests the remote style for the production empty document', () => {
    const remoteUrl = 'https://tiles.openfreemap.org/styles/liberty';
    const requestRemoteStyle = vi.fn();

    publishDocumentMapStartup({
      documentReady: true,
      documentHasContent: false,
      hasAcceptedScene: false,
      interactionsAttached: true,
      milestones: {
        contentCommitted: () => {
          requestRemoteStyle(remoteUrl);
        },
        interactive: vi.fn(),
      },
      flushTheme: vi.fn(),
    });

    expect(requestRemoteStyle).toHaveBeenCalledWith(remoteUrl);
  });

  it('requests the remote style when an empty document was ready before subscription', () => {
    const remoteUrl = 'https://tiles.openfreemap.org/styles/liberty';
    const requestRemoteStyle = vi.fn();
    const scheduleProjection = vi.fn();

    resumeInitialReadyDocument({
      documentStatus: 'ready',
      documentHasContent: false,
      hasAcceptedScene: false,
      scheduleProjection,
      publishStartup: () => {
        requestRemoteStyle(remoteUrl);
      },
    });

    expect(scheduleProjection).not.toHaveBeenCalled();
    expect(requestRemoteStyle).toHaveBeenCalledWith(remoteUrl);
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

  it('retries setup from idle when MapLibre exposes a parsed but mutable-incomplete style', () => {
    const map = new FakeMap();
    const startEditor = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    map.setStyleKnown();

    attachInitialMapReady(map, startEditor);

    expect(startEditor).toHaveBeenCalledOnce();

    map.emit('idle');

    expect(startEditor).toHaveBeenCalledTimes(2);
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
