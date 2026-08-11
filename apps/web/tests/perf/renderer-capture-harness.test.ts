import { describe, expect, it, vi } from 'vitest';
import { attachRendererCaptureHarness } from '../../src/perf/renderer-capture-harness';

describe('renderer capture map harness', () => {
  it('settles the requested camera and removes its global seam on detach', async () => {
    let idle: (() => void) | undefined;
    const jumpTo = vi.fn(() => idle?.());
    const host: Record<string, unknown> = {};
    const detach = attachRendererCaptureHarness(
      {
        once(event, listener) {
          expect(event).toBe('idle');
          idle = listener;
        },
        jumpTo,
      },
      host,
      () => Promise.resolve(),
    );

    const setCamera = host.__rendererCaptureSetCamera as (camera: {
      center: [number, number];
      zoom: number;
    }) => Promise<void>;
    await setCamera({ center: [-115.176, 36.13], zoom: 16.5 });

    expect(jumpTo).toHaveBeenCalledWith({ center: [-115.176, 36.13], zoom: 16.5 });
    detach();
    expect(host.__rendererCaptureSetCamera).toBeUndefined();
  });
});
