import { afterEach, describe, expect, it, vi } from 'vitest';
import { canvasToPngBlob, type CanvasPngSource } from '../../src/share/previewImage';

class FakeCanvas implements CanvasPngSource {
  callback: ((blob: Blob | null) => void) | null = null;

  toBlob(callback: (blob: Blob | null) => void): void {
    this.callback = callback;
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe('share preview PNG encoding', () => {
  it('returns the PNG blob when the canvas encoder completes', async () => {
    const canvas = new FakeCanvas();
    const blob = new Blob(['png'], { type: 'image/png' });
    const pending = canvasToPngBlob(canvas);

    canvas.callback?.(blob);

    await expect(pending).resolves.toBe(blob);
  });

  it('stops waiting when canvas.toBlob never invokes its callback', async () => {
    vi.useFakeTimers();
    const canvas = new FakeCanvas();
    const pending = canvasToPngBlob(canvas, { timeoutMs: 25 });
    const rejection = expect(pending).rejects.toThrow('Timed out encoding');

    await vi.advanceTimersByTimeAsync(25);

    await rejection;
  });
});
