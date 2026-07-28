import { describe, expect, it, vi } from 'vitest';
import { deleteAfterFlush } from './deleteAfterFlush';

describe('document deletion', () => {
  it('waits for the current autosave before deleting its durable record', async () => {
    const order: string[] = [];
    let finishFlush: (() => void) | undefined;
    const flush = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishFlush = () => {
            order.push('flush');
            resolve();
          };
        }),
    );
    const deleteDocument = vi.fn(async () => {
      order.push('delete');
      return 'saved' as const;
    });
    const discardDocument = vi.fn(() => {
      order.push('discard');
    });

    const pending = deleteAfterFlush('system-a', {
      flush,
      deleteDocument,
      discardDocument,
    });
    await Promise.resolve();
    expect(deleteDocument).not.toHaveBeenCalled();

    finishFlush?.();
    await expect(pending).resolves.toBe('saved');
    expect(order).toEqual(['flush', 'delete', 'discard']);
  });

  it('retains pending recovery state when deleting the durable record fails', async () => {
    const discardDocument = vi.fn();

    await expect(
      deleteAfterFlush('system-a', {
        flush: vi.fn(),
        deleteDocument: vi.fn(async () => 'unavailable' as const),
        discardDocument,
      }),
    ).resolves.toBe('unavailable');

    expect(discardDocument).not.toHaveBeenCalled();
  });
});
