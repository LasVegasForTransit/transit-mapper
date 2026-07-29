import { describe, expect, it, vi } from 'vitest';
import { attachPaintedFrameCapture, type RenderEventMap } from '../../src/perf/paintedFrameCapture';

class FakeRenderMap implements RenderEventMap {
  listener: (() => void) | null = null;

  on(_event: 'render', listener: () => void): void {
    this.listener = listener;
  }

  off(_event: 'render', listener: () => void): void {
    if (this.listener === listener) this.listener = null;
  }

  render(): void {
    this.listener?.();
  }
}

describe('painted frame capture', () => {
  it('records only consecutive MapLibre renders inside the measured action', () => {
    const map = new FakeRenderMap();
    const now = vi.spyOn(performance, 'now');
    const capture = attachPaintedFrameCapture(map);

    now.mockReturnValueOnce(100).mockReturnValueOnce(116).mockReturnValueOnce(150);
    map.render();
    capture.start();
    map.render();
    map.render();
    map.render();
    const measured = capture.stop();
    map.render();

    expect(measured).toEqual([16, 34]);

    capture.detach();
    expect(map.listener).toBeNull();
  });
});
