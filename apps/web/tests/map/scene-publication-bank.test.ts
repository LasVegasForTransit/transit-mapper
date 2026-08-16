import { describe, expect, it, vi } from 'vitest';
import {
  renderDomainIdentity,
  renderFeatureId,
  systemFeatureSourceId,
} from '@transitmapper/core/render/render-identity';
import { createCooperativeRenderJobScheduler } from '../../src/map/cooperative-render-job-scheduler';
import type { SceneDraft } from '../../src/map/scene-draft';
import { publishSceneDraft } from '../../src/map/scene-publication';
import { emptySystemFeatures } from '../../src/map/system-feature-sources';

class BankFrameClock {
  private nextHandle = 1;
  readonly frames = new Map<number, () => void>();
  now = () => 0;
  scheduleFrame = (callback: () => void) => {
    const handle = this.nextHandle++;
    this.frames.set(handle, callback);
    return handle;
  };
  cancelFrame = (handle: number) => this.frames.delete(handle);
  flush(): void {
    const entry = this.frames.entries().next();
    if (entry.done) throw new Error('No frame scheduled.');
    const [handle, callback] = entry.value;
    this.frames.delete(handle);
    callback();
  }

  flushUntil(predicate: () => boolean): void {
    for (let index = 0; index < 12 && !predicate(); index += 1) this.flush();
    if (!predicate()) throw new Error('Expected staged publication boundary was not reached.');
  }
}

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve = () => {};
  const promise = new Promise<void>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

const prepared = {} as SceneDraft;
const input = { revision: 'scene', features: emptySystemFeatures(), sourceIds: [] };

describe('banked scene publication', () => {
  it('prewarms a visible offscreen bank before its first source mutation', async () => {
    const clock = new BankFrameClock();
    const scheduler = createCooperativeRenderJobScheduler({
      now: clock.now,
      scheduleFrame: clock.scheduleFrame,
      cancelFrame: clock.cancelFrame,
    });
    const prewarmed = deferred();
    const ready = deferred();
    const flipped = deferred();
    const events: string[] = [];
    let preparationRequested = false;
    const sourceCommit = {
      sourceIds: ['tm-ways--bank-b'],
      preparationUnits: {
        unitAt: () => {
          if (preparationRequested) return undefined;
          preparationRequested = true;
          return { id: 'materialize-hidden-source', run: () => events.push('cpu-materialize') };
        },
      },
      units: [
        {
          id: 'hidden-source',
          sliceExclusive: true as const,
          run: () => events.push('source'),
        },
      ],
      mode: 'hidden' as const,
      bank: 'b' as const,
      stage: vi.fn(() => {
        events.push('stage');
        return { sourceUploadCount: 1 };
      }),
      markSourcesLoaded: vi.fn(() => events.push('loaded')),
      activate: vi.fn(() => events.push('activate-ownership')),
      publish: vi.fn(() => {
        events.push('publish');
        return { sourceUploadCount: 1 };
      }),
      commit: vi.fn(),
      abort: vi.fn(),
      mutationStarted: () => events.includes('source'),
    };
    const handle = publishSceneDraft({
      scheduler,
      controller: {
        draft: () => ({ units: { unitAt: () => undefined }, result: () => prepared }),
        preparePublication: () => sourceCommit,
        publishDraftSynchronously: vi.fn(),
      },
      input,
      beforeSourceMutation: () => {
        events.push('prepare-offscreen');
        return prewarmed.promise;
      },
      onSourceMutationStart: () => {
        events.push('source-start');
      },
      beforePublish: () => {
        events.push('wait-loaded-and-prepaint');
        return ready.promise;
      },
      beforeScenePublish: () => {
        events.push('flip-and-wait-render');
        return flipped.promise;
      },
      onCommitted: () => {
        events.push('post-flip-render');
      },
    });

    clock.flushUntil(() => events.includes('prepare-offscreen'));
    await Promise.resolve();
    expect(events).toEqual(['cpu-materialize', 'prepare-offscreen']);

    prewarmed.resolve();
    await Promise.resolve();
    clock.flushUntil(() => events.includes('wait-loaded-and-prepaint'));
    expect(events).toEqual([
      'cpu-materialize',
      'prepare-offscreen',
      'source-start',
      'source',
      'stage',
      'wait-loaded-and-prepaint',
    ]);

    ready.resolve();
    await Promise.resolve();
    expect(events).toEqual([
      'cpu-materialize',
      'prepare-offscreen',
      'source-start',
      'source',
      'stage',
      'wait-loaded-and-prepaint',
      'loaded',
      'activate-ownership',
      'flip-and-wait-render',
    ]);

    flipped.resolve();
    await expect(handle.settled).resolves.toBeUndefined();
    expect(events).toEqual([
      'cpu-materialize',
      'prepare-offscreen',
      'source-start',
      'source',
      'stage',
      'wait-loaded-and-prepaint',
      'loaded',
      'activate-ownership',
      'flip-and-wait-render',
      'publish',
      'post-flip-render',
    ]);
  });

  it('publishes only after exact hidden sources are ready', async () => {
    const clock = new BankFrameClock();
    const scheduler = createCooperativeRenderJobScheduler({
      now: clock.now,
      scheduleFrame: clock.scheduleFrame,
      cancelFrame: clock.cancelFrame,
    });
    const ready = deferred();
    const events: string[] = [];
    const sourceCommit = {
      sourceIds: ['tm-ways--bank-b'],
      units: [
        {
          id: 'hidden-source',
          sliceExclusive: true as const,
          run: () => events.push('source'),
        },
      ],
      mode: 'hidden' as const,
      bank: 'b' as const,
      stage: vi.fn(() => {
        events.push('stage');
        return { sourceUploadCount: 1 };
      }),
      markSourcesLoaded: vi.fn(() => events.push('loaded')),
      publish: vi.fn(() => {
        events.push('publish');
        return { sourceUploadCount: 1 };
      }),
      commit: vi.fn(),
      abort: vi.fn(() => events.push('abort')),
      mutationStarted: () => events.includes('source'),
    };
    const beforePublish = vi.fn(() => {
      events.push('wait');
      return ready.promise;
    });
    const handle = publishSceneDraft({
      scheduler,
      controller: {
        draft: () => ({ units: { unitAt: () => undefined }, result: () => prepared }),
        preparePublication: () => sourceCommit,
        publishDraftSynchronously: vi.fn(),
      },
      input,
      beforePublish,
      onCommitted: () => {
        events.push('paint');
      },
    });

    clock.flushUntil(() => events.includes('wait'));
    await Promise.resolve();
    expect(events).toEqual(['source', 'stage', 'wait']);
    expect(handle.cancel()).toBe(false);

    ready.resolve();
    await expect(handle.settled).resolves.toBeUndefined();
    expect(events).toEqual(['source', 'stage', 'wait', 'loaded', 'publish', 'paint']);
    expect(sourceCommit.commit).not.toHaveBeenCalled();
  });

  it('aborts hidden CPU publication when source readiness fails', async () => {
    const clock = new BankFrameClock();
    const scheduler = createCooperativeRenderJobScheduler({
      now: clock.now,
      scheduleFrame: clock.scheduleFrame,
      cancelFrame: clock.cancelFrame,
    });
    const failure = new Error('hidden worker failed');
    const sourceCommit = {
      sourceIds: ['tm-ways--bank-b'],
      units: [{ id: 'hidden-source', sliceExclusive: true as const, run() {} }],
      mode: 'hidden' as const,
      bank: 'b' as const,
      stage: vi.fn(() => ({ sourceUploadCount: 1 })),
      markSourcesLoaded: vi.fn(),
      publish: vi.fn(() => ({ sourceUploadCount: 1 })),
      commit: vi.fn(),
      abort: vi.fn(),
      mutationStarted: () => true,
    };
    const handle = publishSceneDraft({
      scheduler,
      controller: {
        draft: () => ({ units: { unitAt: () => undefined }, result: () => prepared }),
        preparePublication: () => sourceCommit,
        publishDraftSynchronously: vi.fn(),
      },
      input,
      beforePublish: () => Promise.reject(failure),
    });

    clock.flushUntil(() => sourceCommit.stage.mock.calls.length > 0);

    await expect(handle.settled).rejects.toBe(failure);
    expect(sourceCommit.abort).toHaveBeenCalledOnce();
    expect(sourceCommit.publish).not.toHaveBeenCalled();
  });

  it('aborts provisional ownership when the activated render is rejected', async () => {
    const clock = new BankFrameClock();
    const scheduler = createCooperativeRenderJobScheduler({
      now: clock.now,
      scheduleFrame: clock.scheduleFrame,
      cancelFrame: clock.cancelFrame,
    });
    const failure = new Error('activated bank did not render');
    let activeRevision = 'one';
    const sourceCommit = {
      sourceIds: ['tm-ways--bank-b'],
      units: [{ id: 'hidden-source', sliceExclusive: true as const, run() {} }],
      mode: 'hidden' as const,
      bank: 'b' as const,
      stage: vi.fn(() => ({ sourceUploadCount: 1 })),
      markSourcesLoaded: vi.fn(),
      activate: vi.fn(() => {
        activeRevision = 'two';
      }),
      publish: vi.fn(() => ({ sourceUploadCount: 1 })),
      commit: vi.fn(),
      abort: vi.fn(() => {
        activeRevision = 'one';
      }),
      mutationStarted: () => true,
    };
    const handle = publishSceneDraft({
      scheduler,
      controller: {
        draft: () => ({ units: { unitAt: () => undefined }, result: () => prepared }),
        preparePublication: () => sourceCommit,
        publishDraftSynchronously: vi.fn(),
      },
      input,
      beforeScenePublish: () => Promise.reject(failure),
    });

    clock.flushUntil(() => sourceCommit.stage.mock.calls.length > 0);
    await expect(handle.settled).rejects.toBe(failure);

    expect(sourceCommit.abort).toHaveBeenCalledOnce();
    expect(sourceCommit.publish).not.toHaveBeenCalled();
    expect(activeRevision).toBe('one');
  });

  it('exposes incoming selected-feature targets before the bank flip render', async () => {
    const clock = new BankFrameClock();
    const scheduler = createCooperativeRenderJobScheduler({
      now: clock.now,
      scheduleFrame: clock.scheduleFrame,
      cancelFrame: clock.cancelFrame,
    });
    const ways = systemFeatureSourceId('tm-ways');
    const incomingFeatureId = renderFeatureId(ways, 'overview', ['selected-way', 'new']);
    const events: string[] = [];
    const sourceCommit = {
      sourceIds: ['tm-ways--bank-b'],
      units: [{ id: 'hidden-source', sliceExclusive: true as const, run() {} }],
      mode: 'hidden' as const,
      bank: 'b' as const,
      stage: vi.fn(() => ({ sourceUploadCount: 1 })),
      markSourcesLoaded: vi.fn(),
      activate: vi.fn(() => events.push('activate-physical-ownership')),
      targetsForDomainIdentity: vi.fn(() => [{ sourceId: ways, featureId: incomingFeatureId }]),
      publish: vi.fn(() => {
        events.push('publish-cpu-scene');
        return { sourceUploadCount: 1 };
      }),
      commit: vi.fn(),
      abort: vi.fn(),
      mutationStarted: () => true,
    };
    const handle = publishSceneDraft({
      scheduler,
      controller: {
        draft: () => ({ units: { unitAt: () => undefined }, result: () => prepared }),
        preparePublication: () => sourceCommit,
        publishDraftSynchronously: vi.fn(),
      },
      input,
      beforeScenePublish: (context) => {
        const targets = context.targetsForDomainIdentity?.(
          renderDomainIdentity('way', 'selected-way'),
        );
        events.push(`feature-state:${targets?.[0]?.featureId ?? 'missing'}`);
        events.push('render-activated-bank');
      },
    });

    clock.flushUntil(() => sourceCommit.stage.mock.calls.length > 0);
    await expect(handle.settled).resolves.toBeUndefined();

    expect(events).toEqual([
      'activate-physical-ownership',
      `feature-state:${incomingFeatureId}`,
      'render-activated-bank',
      'publish-cpu-scene',
    ]);
  });
});
