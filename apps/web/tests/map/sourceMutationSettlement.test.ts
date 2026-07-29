import { describe, expect, it, vi } from 'vitest';
import {
  settleSourceMutationAfterRender,
  type SourceMutationSettlementHost,
  type SettledSourceDataEvent,
} from '../../src/map/sourceMutationSettlement';

function createHost() {
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
    triggerRepaint: vi.fn(),
  };
  return {
    host,
    fireLoading: (sourceId: string) => {
      for (const listener of [...loadingListeners]) listener(sourceId);
    },
    fireSource: (event: SettledSourceDataEvent) => {
      for (const listener of [...sourceListeners]) listener(event);
    },
    fireRender: () => {
      for (const listener of [...renderListeners]) listener();
    },
    listenerCount: () => loadingListeners.size + sourceListeners.size + renderListeners.size,
  };
}

describe('source mutation settlement', () => {
  it('keeps the preview until the named source loads and a later render occurs', () => {
    const map = createHost();
    const mutate = vi.fn();
    const settled = vi.fn();
    const fallback = vi.fn();

    settleSourceMutationAfterRender({
      host: map.host,
      sourceId: 'stations',
      mutate,
      onSettled: settled,
      onFallback: fallback,
    });

    expect(mutate).toHaveBeenCalledOnce();
    map.fireLoading('stations');
    map.fireSource({
      sourceId: 'stations',
      sourceDataType: 'content',
      isSourceLoaded: false,
    });
    map.fireSource({
      sourceId: 'stations',
      sourceDataType: 'content',
      isSourceLoaded: true,
    });

    expect(settled).not.toHaveBeenCalled();
    expect(map.host.triggerRepaint).toHaveBeenCalledOnce();

    map.fireRender();

    expect(settled).toHaveBeenCalledOnce();
    expect(fallback).not.toHaveBeenCalled();
    expect(map.listenerCount()).toBe(0);
  });

  it('ignores stale completion before the scheduled source mutation begins', () => {
    const map = createHost();
    const settled = vi.fn();

    settleSourceMutationAfterRender({
      host: map.host,
      sourceId: 'stations',
      mutate: () => {},
      onSettled: settled,
      onFallback: vi.fn(),
    });

    map.fireSource({
      sourceId: 'stations',
      sourceDataType: 'content',
      isSourceLoaded: true,
    });
    map.fireRender();
    expect(settled).not.toHaveBeenCalled();

    map.fireLoading('stations');
    map.fireSource({
      sourceId: 'stations',
      sourceDataType: 'content',
      isSourceLoaded: true,
    });
    map.fireRender();

    expect(settled).toHaveBeenCalledOnce();
    expect(map.listenerCount()).toBe(0);
  });

  it('waits for a newer mutation when the source starts loading before paint', () => {
    const map = createHost();
    const settled = vi.fn();

    settleSourceMutationAfterRender({
      host: map.host,
      sourceId: 'stations',
      mutate: () => {},
      onSettled: settled,
      onFallback: vi.fn(),
    });

    map.fireLoading('stations');
    map.fireSource({
      sourceId: 'stations',
      sourceDataType: 'content',
      isSourceLoaded: true,
    });
    map.fireLoading('stations');
    map.fireRender();
    expect(settled).not.toHaveBeenCalled();

    map.fireSource({
      sourceId: 'stations',
      sourceDataType: 'content',
      isSourceLoaded: true,
    });
    map.fireRender();

    expect(settled).toHaveBeenCalledOnce();
  });

  it('cleans up and falls back when the source never settles', async () => {
    vi.useFakeTimers();
    const map = createHost();
    const fallback = vi.fn();

    settleSourceMutationAfterRender({
      host: map.host,
      sourceId: 'stations',
      mutate: () => {},
      onSettled: vi.fn(),
      onFallback: fallback,
      timeoutMs: 20,
    });
    await vi.advanceTimersByTimeAsync(20);

    expect(fallback).toHaveBeenCalledOnce();
    expect(map.listenerCount()).toBe(0);
    vi.useRealTimers();
  });

  it('cancels stale completion without clearing a newer preview', () => {
    const map = createHost();
    const settled = vi.fn();
    const fallback = vi.fn();

    const cancel = settleSourceMutationAfterRender({
      host: map.host,
      sourceId: 'stations',
      mutate: () => {},
      onSettled: settled,
      onFallback: fallback,
    });
    cancel();
    map.fireSource({
      sourceId: 'stations',
      sourceDataType: 'content',
      isSourceLoaded: true,
    });
    map.fireRender();

    expect(settled).not.toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();
    expect(map.listenerCount()).toBe(0);
  });
});
