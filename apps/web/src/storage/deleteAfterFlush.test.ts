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

    const pending = deleteAfterFlush('system-a', { flush, deleteDocument });
    await Promise.resolve();
    expect(deleteDocument).not.toHaveBeenCalled();

    finishFlush?.();
    await expect(pending).resolves.toBe('saved');
    expect(order).toEqual(['flush', 'delete']);
  });
});
