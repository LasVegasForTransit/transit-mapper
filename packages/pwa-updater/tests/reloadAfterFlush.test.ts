import { describe, expect, it, vi } from 'vitest';
import { reloadAfterFlush } from '../src/reloadAfterFlush';

describe('PWA update reload', () => {
  it('waits for async document durability before activating the update', async () => {
    let finishFlush: (() => void) | undefined;
    const flush = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishFlush = resolve;
        }),
    );
    const update = vi.fn(async () => {});

    const pending = reloadAfterFlush(flush, update);
    await Promise.resolve();
    expect(update).not.toHaveBeenCalled();

    finishFlush?.();
    await pending;

    expect(update).toHaveBeenCalledOnce();
  });
});
