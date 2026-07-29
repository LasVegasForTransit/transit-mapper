import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitForQuiet } from '../../src/import/waitForQuiet';

class ChangeSource {
  private readonly listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  change(): void {
    for (const listener of this.listeners) listener();
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe('quiet-window scheduling', () => {
  it('waits for a complete quiet window after the newest change', async () => {
    vi.useFakeTimers();
    const source = new ChangeSource();
    let settled = false;
    const pending = waitForQuiet(source, { quietMs: 250 }).then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(200);
    source.change();
    await vi.advanceTimersByTimeAsync(200);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(50);
    await pending;
    expect(settled).toBe(true);
    expect(source.listenerCount).toBe(0);
  });

  it('stops waiting immediately when the operation is canceled', async () => {
    vi.useFakeTimers();
    const source = new ChangeSource();
    const controller = new AbortController();
    const pending = waitForQuiet(source, { quietMs: 250, signal: controller.signal });

    controller.abort(new DOMException('Canceled', 'AbortError'));

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(source.listenerCount).toBe(0);
  });
});
