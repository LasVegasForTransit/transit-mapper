import { describe, expect, it, vi } from 'vitest';
import { SRC_STATIONS } from './layers';
import { createStationGestureSettlementController } from './stationGestureSettlement';
import type {
  SettledSourceDataEvent,
  SourceMutationSettlementHost,
} from './sourceMutationSettlement';

function createSettlementHost() {
  const loadingListeners = new Set<(sourceId: string) => void>();
  const sourceListeners = new Set<(event: SettledSourceDataEvent) => void>();
  const renderListeners = new Set<() => void>();
  const host: SourceMutationSettlementHost = {
    onSourceLoading(listener) {
      loadingListeners.add(listener);
      return () => loadingListeners.delete(listener);
    },
    onSourceData(listener) {
      sourceListeners.add(listener);
      return () => sourceListeners.delete(listener);
    },
    onRender(listener) {
      renderListeners.add(listener);
      return () => renderListeners.delete(listener);
    },
    triggerRepaint() {},
  };
  return {
    host,
    fireLoaded() {
      for (const listener of [...loadingListeners]) listener(SRC_STATIONS);
      for (const listener of [...sourceListeners]) {
        listener({
          sourceId: SRC_STATIONS,
          sourceDataType: 'content',
          isSourceLoaded: true,
        });
      }
    },
    fireRender() {
      for (const listener of [...renderListeners]) listener();
    },
    listenerCount: () => loadingListeners.size + sourceListeners.size + renderListeners.size,
  };
}

describe('station gesture settlement ownership', () => {
  it('releases a painted diff immediately when no gesture has taken over', () => {
    const map = createSettlementHost();
    const released = vi.fn();
    const controller = createStationGestureSettlementController({
      host: map.host,
      sourceId: SRC_STATIONS,
      isGestureActive: () => false,
      onRelease: released,
    });

    controller.beginDiff({ mutate() {}, fallback() {} });
    map.fireLoaded();
    map.fireRender();

    expect(released).toHaveBeenCalledOnce();
    expect(controller.ownsPreview()).toBe(false);
    expect(map.listenerCount()).toBe(0);
  });

  it('keeps a ready preview owned by an overlapping gesture until its end', () => {
    const map = createSettlementHost();
    let gestureActive = true;
    const released = vi.fn();
    const controller = createStationGestureSettlementController({
      host: map.host,
      sourceId: SRC_STATIONS,
      isGestureActive: () => gestureActive,
      onRelease: released,
    });

    controller.beginDiff({ mutate() {}, fallback() {} });
    map.fireLoaded();
    map.fireRender();

    expect(released).not.toHaveBeenCalled();
    expect(controller.ownsPreview()).toBe(true);
    gestureActive = false;
    expect(controller.releaseIfReady()).toBe(true);
    expect(released).toHaveBeenCalledOnce();
  });

  it('transfers a failed diff into one paint-safe full refresh', async () => {
    const map = createSettlementHost();
    const fallback = vi.fn();
    const released = vi.fn();
    const controller = createStationGestureSettlementController({
      host: map.host,
      sourceId: SRC_STATIONS,
      isGestureActive: () => false,
      onRelease: released,
    });

    controller.beginDiff({
      mutate() {
        throw new Error('diff unavailable');
      },
      fallback,
    });
    await Promise.resolve();

    expect(fallback).toHaveBeenCalledOnce();
    expect(released).not.toHaveBeenCalled();
    map.fireLoaded();
    map.fireRender();
    expect(released).toHaveBeenCalledOnce();
  });

  it('re-arms a full refresh before releasing a superseded diff', () => {
    const map = createSettlementHost();
    const released = vi.fn();
    const refresh = vi.fn();
    const controller = createStationGestureSettlementController({
      host: map.host,
      sourceId: SRC_STATIONS,
      isGestureActive: () => false,
      onRelease: released,
    });

    controller.beginDiff({ mutate() {}, fallback() {} });
    controller.beginFull({ mutate: refresh });
    map.fireLoaded();
    map.fireRender();

    expect(refresh).toHaveBeenCalledOnce();
    expect(released).toHaveBeenCalledOnce();
  });
});
