import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitForExportFrame } from './exportOperation';

class FakeMap {
  private listener: (() => void) | null = null;
  repaints = 0;
  once(_type: 'idle', listener: () => void): void {
    this.listener = listener;
  }
  off(_type: 'idle', listener: () => void): void {
    if (this.listener === listener) this.listener = null;
  }
  triggerRepaint(): void {
    this.repaints++;
  }
  idle(): void {
    this.listener?.();
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe('export frame wait', () => {
  it('resolves only after the map has painted its idle frame', async () => {
    const map = new FakeMap();
    const pending = waitForExportFrame(map);
    expect(map.repaints).toBe(1);

    map.idle();

    await expect(pending).resolves.toBeUndefined();
  });

  it('stops waiting when the dialog closes', async () => {
    const map = new FakeMap();
    const controller = new AbortController();
    const pending = waitForExportFrame(map, { signal: controller.signal });

    controller.abort(new DOMException('Dialog closed', 'AbortError'));

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects a map that never becomes idle', async () => {
    vi.useFakeTimers();
    const pending = waitForExportFrame(new FakeMap(), { timeoutMs: 100 });
    const rejection = expect(pending).rejects.toThrow('timed out');

    await vi.advanceTimersByTimeAsync(100);

    await rejection;
  });
});
