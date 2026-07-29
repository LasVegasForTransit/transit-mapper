import { describe, expect, it } from 'vitest';
import { createCancelableFlight, joinCancelableFlight } from '../../src/network/cancelableFlight';

describe('cancelable single-flight subscribers', () => {
  it('lets one joined caller cancel without canceling another caller', async () => {
    let resolveRun: ((value: string) => void) | undefined;
    const flight = createCancelableFlight(
      () =>
        new Promise<string>((resolve) => {
          resolveRun = resolve;
        }),
    );
    const firstController = new AbortController();
    const secondController = new AbortController();
    const first = joinCancelableFlight(flight, firstController.signal);
    const second = joinCancelableFlight(flight, secondController.signal);

    firstController.abort(new DOMException('First dialog closed', 'AbortError'));
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    expect(flight.controller.signal.aborted).toBe(false);

    resolveRun?.('shared URL');
    await expect(second).resolves.toBe('shared URL');
  });

  it('aborts underlying work after its final caller leaves', async () => {
    const flight = createCancelableFlight(
      (signal) =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
    );
    const controller = new AbortController();
    const pending = joinCancelableFlight(flight, controller.signal);

    controller.abort(new DOMException('Only dialog closed', 'AbortError'));

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(flight.controller.signal.aborted).toBe(true);
  });
});
