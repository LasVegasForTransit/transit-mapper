import { describe, expect, it, vi } from 'vitest';
import type { CommittedFeatureProjectionSubmission } from '../../src/map/committed-feature-projection';
import { createCommittedProjectionOwnership } from '../../src/map/committed-feature-projection';

function aSubmission(cancel: () => boolean): CommittedFeatureProjectionSubmission {
  return { generation: 1, settled: Promise.resolve(), cancel };
}

function deferredSubmission(cancel: () => boolean): {
  submission: CommittedFeatureProjectionSubmission;
  resolve: () => void;
  reject: (error: Error) => void;
} {
  let resolve = () => {};
  let reject: (error: Error) => void = () => {};
  const settled = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { submission: { generation: 1, settled, cancel }, resolve, reject };
}

describe('committed projection ownership', () => {
  it('cancels and requeues active work before a newer frame can be scheduled', () => {
    const events: string[] = [];
    const requeue = vi.fn(() => events.push('requeue'));
    const ownership = createCommittedProjectionOwnership({ requeue });
    const submission = aSubmission(() => {
      events.push('cancel');
      return true;
    });
    const request = { sourceIds: ['tm-ways'] as const, transition: null };
    ownership.activate(submission, request);

    expect(ownership.cancelAndRequeue()).toBe(true);
    expect(events).toEqual(['cancel', 'requeue']);
    expect(requeue).toHaveBeenCalledWith(request);
    expect(ownership.cancelAndRequeue()).toBe(false);
  });

  it('does not clear a newer submission when an older barrier settles', () => {
    const ownership = createCommittedProjectionOwnership({ requeue: vi.fn() });
    const first = aSubmission(() => true);
    const second = aSubmission(() => true);
    ownership.activate(first, { sourceIds: [], transition: null });
    ownership.activate(second, { sourceIds: [], transition: null });

    ownership.clear(first);

    expect(ownership.current()).toBe(second);
  });

  it('queues one camera successor without canceling the active guarded scene', async () => {
    const ownership = createCommittedProjectionOwnership({ requeue: vi.fn() });
    const cancel = vi.fn(() => true);
    const active = deferredSubmission(cancel);
    const successor = vi.fn();
    ownership.activate(active.submission, { sourceIds: [], transition: null });

    ownership.afterCurrentSettles(successor);
    expect(cancel).not.toHaveBeenCalled();
    expect(successor).not.toHaveBeenCalled();

    active.resolve();
    await active.submission.settled;
    await Promise.resolve();
    expect(successor).toHaveBeenCalledOnce();
    expect(ownership.current()).toBeNull();
  });

  it('does not let an older camera waiter supersede newer model work', async () => {
    const ownership = createCommittedProjectionOwnership({ requeue: vi.fn() });
    const cameraBase = deferredSubmission(() => true);
    const modelWork = deferredSubmission(() => true);
    const staleSuccessor = vi.fn();
    ownership.activate(cameraBase.submission, { sourceIds: [], transition: null });
    ownership.afterCurrentSettles(staleSuccessor);

    ownership.activate(modelWork.submission, { sourceIds: [], transition: null });
    cameraBase.resolve();
    await cameraBase.submission.settled;
    await Promise.resolve();

    expect(staleSuccessor).not.toHaveBeenCalled();
    expect(ownership.current()).toBe(modelWork.submission);
  });

  it('leaves a queued camera successor for retained-scene recovery after projection failure', async () => {
    const ownership = createCommittedProjectionOwnership({ requeue: vi.fn() });
    const failed = deferredSubmission(() => true);
    const successor = vi.fn();
    ownership.activate(failed.submission, { sourceIds: [], transition: null });
    ownership.afterCurrentSettles(successor);

    failed.reject(new Error('source submission failed'));
    await expect(failed.submission.settled).rejects.toThrow('source submission failed');
    await Promise.resolve();

    expect(successor).not.toHaveBeenCalled();
    expect(ownership.current()).toBeNull();
  });
});
