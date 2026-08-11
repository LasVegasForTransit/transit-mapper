import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GestureAffectedEntities } from '../../src/map/gestureProjection';
import {
  createGesturePaintSettlementController,
  gestureNeedsCommittedPaint,
  waitForGestureRenderBoundary,
} from '../../src/map/render-settlement';

function affected(overrides: Partial<GestureAffectedEntities>): GestureAffectedEntities {
  return {
    wayIds: [],
    stationIds: [],
    facilityIds: [],
    groupIds: [],
    nodeIds: [],
    ...overrides,
  };
}

function deferred(): {
  promise: Promise<void>;
  resolve(): void;
  reject(error: Error): void;
} {
  let resolve: () => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('generic gesture paint settlement', () => {
  it('settles on the next animation render without waiting for global idle', async () => {
    const listeners = new Set<() => void>();
    const triggerRepaint = vi.fn();
    const controller = new AbortController();
    const settled = waitForGestureRenderBoundary(
      {
        onRender(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        triggerRepaint,
      },
      controller.signal,
    );

    expect(triggerRepaint).toHaveBeenCalledOnce();
    expect(listeners.size).toBe(1);
    for (const listener of [...listeners]) listener();

    await expect(settled).resolves.toBeUndefined();
    expect(listeners.size).toBe(0);
  });

  it('classifies every non-station gesture that masks committed geometry', () => {
    expect(gestureNeedsCommittedPaint(affected({ wayIds: ['way'] }))).toBe(true);
    expect(gestureNeedsCommittedPaint(affected({ nodeIds: ['node'] }))).toBe(true);
    expect(gestureNeedsCommittedPaint(affected({ facilityIds: ['facility'] }))).toBe(true);
    expect(gestureNeedsCommittedPaint(affected({ groupIds: ['group'] }))).toBe(true);
    expect(gestureNeedsCommittedPaint(affected({ stationIds: ['station'] }))).toBe(false);
    expect(gestureNeedsCommittedPaint(affected({}))).toBe(false);
  });

  it('releases only after the complete renderer generation and final paint settle', async () => {
    const paint = deferred();
    const released = vi.fn();
    const mutate = vi.fn();
    const controller = createGesturePaintSettlementController({
      settlePaint: () => paint.promise,
      isGestureActive: () => false,
      onRelease: released,
    });

    controller.begin({ mutate });
    expect(mutate).toHaveBeenCalledOnce();
    expect(released).not.toHaveBeenCalled();

    paint.resolve();
    await paint.promise;
    await Promise.resolve();

    expect(released).toHaveBeenCalledOnce();
    expect(controller.ownsPreview()).toBe(false);
  });

  it('prevents a superseded settlement from clearing the newer preview', async () => {
    const first = deferred();
    const second = deferred();
    const settlements = [first, second];
    const signals: AbortSignal[] = [];
    const released = vi.fn();
    const controller = createGesturePaintSettlementController({
      settlePaint: (signal) => {
        signals.push(signal);
        return settlements.shift()?.promise ?? Promise.resolve();
      },
      isGestureActive: () => false,
      onRelease: released,
    });

    controller.begin({ mutate() {} });
    controller.begin({ mutate() {} });
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
    first.resolve();
    await first.promise;
    await Promise.resolve();
    expect(released).not.toHaveBeenCalled();

    second.resolve();
    await second.promise;
    await Promise.resolve();
    expect(released).toHaveBeenCalledOnce();
  });

  it('holds a ready handoff while a newer gesture is active', async () => {
    const paint = deferred();
    let gestureActive = true;
    const released = vi.fn();
    const controller = createGesturePaintSettlementController({
      settlePaint: () => paint.promise,
      isGestureActive: () => gestureActive,
      onRelease: released,
    });

    controller.begin({ mutate() {} });
    paint.resolve();
    await paint.promise;
    await Promise.resolve();

    expect(released).not.toHaveBeenCalled();
    expect(controller.ownsPreview()).toBe(true);
    gestureActive = false;
    expect(controller.releaseIfReady()).toBe(true);
    expect(released).toHaveBeenCalledOnce();
  });

  it('retains a non-blocking fallback when renderer settlement rejects', async () => {
    const paint = deferred();
    const released = vi.fn();
    const unsettled = vi.fn();
    const controller = createGesturePaintSettlementController({
      settlePaint: () => paint.promise,
      isGestureActive: () => false,
      onRelease: released,
      onUnsettled: unsettled,
    });

    controller.begin({ mutate() {} });
    paint.reject(new Error('source recovery failed'));
    await expect(paint.promise).rejects.toThrow('source recovery failed');
    await Promise.resolve();

    expect(released).not.toHaveBeenCalled();
    expect(unsettled).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'source recovery failed' }),
    );
    expect(controller.ownsPreview()).toBe(true);
    expect(controller.blocksStyleSwitch()).toBe(false);
  });

  it('turns a renderer timeout into a retained non-blocking fallback', async () => {
    vi.useFakeTimers();
    const released = vi.fn();
    const unsettled = vi.fn();
    const controller = createGesturePaintSettlementController({
      settlePaint: () => new Promise<void>(() => {}),
      isGestureActive: () => false,
      onRelease: released,
      onUnsettled: unsettled,
      timeoutMs: 20,
    });

    controller.begin({ mutate() {} });
    await vi.advanceTimersByTimeAsync(20);

    expect(released).not.toHaveBeenCalled();
    expect(unsettled).toHaveBeenCalledWith(expect.objectContaining({ name: 'TimeoutError' }));
    expect(controller.ownsPreview()).toBe(true);
    expect(controller.blocksStyleSwitch()).toBe(false);
  });

  it('retains the fallback after a synchronous committed-mutation failure', () => {
    const released = vi.fn();
    const unsettled = vi.fn();
    const controller = createGesturePaintSettlementController({
      settlePaint: () => Promise.resolve(),
      isGestureActive: () => false,
      onRelease: released,
      onUnsettled: unsettled,
    });

    controller.begin({
      mutate() {
        throw new Error('source unavailable');
      },
    });

    expect(released).not.toHaveBeenCalled();
    expect(unsettled).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'source unavailable' }),
    );
    expect(controller.ownsPreview()).toBe(true);
    expect(controller.blocksStyleSwitch()).toBe(false);
  });

  it('blocks style switching only while an exact paint can still settle', async () => {
    const paint = deferred();
    const controller = createGesturePaintSettlementController({
      settlePaint: () => paint.promise,
      isGestureActive: () => true,
      onRelease() {},
    });

    controller.begin({ mutate() {} });
    expect(controller.blocksStyleSwitch()).toBe(true);

    paint.resolve();
    await paint.promise;
    await Promise.resolve();
    expect(controller.blocksStyleSwitch()).toBe(true);

    controller.invalidate();
    expect(controller.blocksStyleSwitch()).toBe(false);
    expect(controller.ownsPreview()).toBe(false);
  });
});
