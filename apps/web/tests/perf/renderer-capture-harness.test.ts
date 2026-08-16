import { describe, expect, it, vi } from 'vitest';
import { attachRendererCaptureHarness } from '../../src/perf/renderer-capture-harness';

describe('renderer capture map harness', () => {
  it('settles the requested camera and removes its global seam on detach', async () => {
    const idle: Array<() => void> = [];
    const fireIdle = () => idle.shift()?.();
    const jumpTo = vi.fn(fireIdle);
    const triggerRepaint = vi.fn(fireIdle);
    const host: Record<string, unknown> = {};
    const detach = attachRendererCaptureHarness(
      {
        once(event, listener) {
          expect(event).toBe('idle');
          idle.push(listener);
        },
        jumpTo,
        triggerRepaint,
      },
      host,
      { afterFinalIdle: () => Promise.resolve() },
    );

    const setCamera = host.__rendererCaptureSetCamera as (camera: {
      center: [number, number];
      zoom: number;
    }) => Promise<void>;
    await setCamera({ center: [-115.176, 36.13], zoom: 16.5 });

    expect(jumpTo).toHaveBeenCalledWith({ center: [-115.176, 36.13], zoom: 16.5 });
    expect(triggerRepaint).toHaveBeenCalledOnce();
    detach();
    expect(host.__rendererCaptureSetCamera).toBeUndefined();
  });

  it('waits for the latest renderer generation before the final idle and paint', async () => {
    const idle: Array<() => void> = [];
    let releaseRenderer = () => {};
    const afterRendererSettled = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseRenderer = resolve;
        }),
    );
    const afterFinalIdle = vi.fn(() => Promise.resolve());
    const host: Record<string, unknown> = {};
    const triggerRepaint = vi.fn(() => idle.shift()?.());
    attachRendererCaptureHarness(
      {
        once(_event, listener) {
          idle.push(listener);
        },
        jumpTo: () => idle.shift()?.(),
        triggerRepaint,
      },
      host,
      { afterRendererSettled, afterFinalIdle },
    );
    const setCamera = host.__rendererCaptureSetCamera as (camera: {
      center: [number, number];
      zoom: number;
    }) => Promise<void>;
    const whenSettled = host.__rendererCaptureWhenSettled as () => Promise<void>;

    let resolved = false;
    const settled = setCamera({ center: [-115.176, 36.13], zoom: 12 }).then(() => {
      resolved = true;
    });
    await Promise.resolve();

    expect(afterRendererSettled).toHaveBeenCalledOnce();
    expect(triggerRepaint).not.toHaveBeenCalled();
    expect(resolved).toBe(false);

    releaseRenderer();
    await settled;

    expect(triggerRepaint).toHaveBeenCalledOnce();
    expect(afterFinalIdle).toHaveBeenCalledOnce();
    expect(resolved).toBe(true);

    afterRendererSettled.mockImplementation(() => Promise.resolve());
    await whenSettled();
    expect(triggerRepaint).toHaveBeenCalledTimes(2);
  });

  it('repeats final settlement when source recovery changes during idle', async () => {
    const idle: Array<() => void> = [];
    let settlementVersion = 0;
    const afterRendererSettled = vi.fn(() => Promise.resolve());
    const afterFinalIdle = vi.fn(() => Promise.resolve());
    const host: Record<string, unknown> = {};
    const triggerRepaint = vi.fn(() => {
      if (triggerRepaint.mock.calls.length === 1) settlementVersion += 1;
      idle.shift()?.();
    });
    attachRendererCaptureHarness(
      {
        once(_event, listener) {
          idle.push(listener);
        },
        jumpTo: () => idle.shift()?.(),
        triggerRepaint,
      },
      host,
      {
        afterRendererSettled,
        afterFinalIdle,
        settlementVersion: () => settlementVersion,
      },
    );
    const setCamera = host.__rendererCaptureSetCamera as (camera: {
      center: [number, number];
      zoom: number;
    }) => Promise<void>;

    await setCamera({ center: [-115.176, 36.13], zoom: 12 });

    expect(triggerRepaint).toHaveBeenCalledTimes(2);
    expect(afterRendererSettled).toHaveBeenCalledTimes(4);
    expect(afterFinalIdle).toHaveBeenCalledTimes(2);
  });

  it('removes the settle-only acceptance seam on detach', () => {
    const host: Record<string, unknown> = {};
    const detach = attachRendererCaptureHarness(
      {
        once(_event, listener) {
          listener();
        },
        jumpTo() {},
        triggerRepaint() {},
      },
      host,
      { afterFinalIdle: () => Promise.resolve() },
    );

    expect(host.__rendererCaptureWhenSettled).toBeTypeOf('function');
    detach();
    expect(host.__rendererCaptureWhenSettled).toBeUndefined();
  });
});
