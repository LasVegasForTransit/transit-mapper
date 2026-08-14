import { describe, expect, it, vi } from 'vitest';
import { createRenderSourceErrorRecoveryCoordinator } from '../../src/map/render-source-error-recovery';
import {
  RecoveryFrameHarness as FrameHarness,
  RECOVERY_HEAL_RESULT as HEAL_RESULT,
  RECOVERY_HIT_SOURCE as HIT_SOURCE,
  RECOVERY_WAYS_SOURCE as WAYS_SOURCE,
  recoveryHarness,
} from '../support/render-source-error-recovery.test';

describe('render source error recovery coordinator', () => {
  it('settles only after a scheduled renderer-source heal completes', async () => {
    const harness = recoveryHarness();
    expect(harness.coordinator.version()).toBe(0);
    harness.coordinator.handleSourceError({ sourceId: WAYS_SOURCE });
    expect(harness.coordinator.version()).toBe(1);
    let settled = false;
    const barrier = harness.coordinator.whenSettled().then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);

    harness.frames.flushNext();
    await barrier;
    expect(settled).toBe(true);
    expect(harness.coordinator.version()).toBe(2);
  });

  it('rejects its settlement barrier when source healing fails', async () => {
    const failure = new Error('heal failed');
    const harness = recoveryHarness({
      controller: {
        invalidateSourceState: vi.fn(),
        healCurrentScene: vi.fn(() => {
          throw failure;
        }),
      },
    });

    harness.coordinator.handleSourceError({ sourceId: WAYS_SOURCE });
    const barrier = harness.coordinator.whenSettled();
    harness.frames.flushNext();

    await expect(barrier).rejects.toBe(failure);
  });

  it.each([WAYS_SOURCE, HIT_SOURCE])(
    'invalidates %s immediately and heals it on the next frame',
    (sourceId) => {
      const harness = recoveryHarness();

      expect(
        harness.coordinator.handleSourceError({
          sourceId,
          error: new Error('worker rejected source update'),
        }),
      ).toBe(true);

      expect(harness.invalidateSourceState).toHaveBeenCalledOnce();
      expect(harness.ensureSources).not.toHaveBeenCalled();
      expect(harness.healCurrentScene).not.toHaveBeenCalled();
      expect(harness.frames.pendingCount()).toBe(1);

      harness.frames.flushNext();

      expect(harness.ensureSources).toHaveBeenCalledOnce();
      expect(harness.healCurrentScene).toHaveBeenCalledOnce();
      expect(harness.onSuccess).toHaveBeenCalledWith(HEAL_RESULT);
      expect(harness.onError).not.toHaveBeenCalled();
    },
  );

  it('heals after a synchronous multi-source mutation throws partway through', () => {
    const harness = recoveryHarness();

    harness.coordinator.requestRecovery();

    expect(harness.invalidateSourceState).toHaveBeenCalledOnce();
    expect(harness.frames.pendingCount()).toBe(1);
    harness.frames.flushNext();
    expect(harness.healCurrentScene).toHaveBeenCalledOnce();
  });

  it('replays one retained source per frame and publishes recovery only at the end', () => {
    const events: string[] = [];
    const plan = {
      strategy: 'full' as const,
      sourceIds: [WAYS_SOURCE, HIT_SOURCE],
      units: [
        {
          id: 'render-source:full:stations',
          sliceExclusive: true as const,
          run: () => events.push('stations'),
        },
        {
          id: 'render-source:full:hit-features',
          sliceExclusive: true as const,
          run: () => events.push('hits'),
        },
      ],
      stage: () => HEAL_RESULT,
      publish: () => {
        events.push('publish');
      },
      commit: () => HEAL_RESULT,
      abort: vi.fn(),
      mutationStarted: () => events.length > 0,
    };
    const frames = new FrameHarness();
    const onSuccess = vi.fn();
    const coordinator = createRenderSourceErrorRecoveryCoordinator({
      rendererSourceIds: [WAYS_SOURCE],
      scheduleFrame: frames.schedule,
      cancelFrame: frames.cancel,
      ensureSources: () => true,
      controller: {
        invalidateSourceState: vi.fn(),
        prepareCurrentSceneHeal: () => plan,
        healCurrentScene: () => {
          throw new Error('staged recovery must not use the synchronous path');
        },
      },
      onSuccess,
      onError: vi.fn(),
    });

    coordinator.requestRecovery();
    frames.flushNext();
    expect(events).toEqual(['stations']);
    expect(onSuccess).not.toHaveBeenCalled();
    frames.flushNext();
    expect(events).toEqual(['stations', 'hits']);
    expect(onSuccess).not.toHaveBeenCalled();
    frames.flushNext();
    expect(events).toEqual(['stations', 'hits', 'publish']);
    expect(onSuccess).toHaveBeenCalledWith(HEAL_RESULT);
  });

  it('keeps a prepared recovery unpublished until its exact sources are ready', async () => {
    const frames = new FrameHarness();
    let release = () => {};
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    const publish = vi.fn();
    const plan = {
      strategy: 'full' as const,
      sourceIds: [`${WAYS_SOURCE}--bank-a`],
      units: [],
      stage: () => HEAL_RESULT,
      publish,
      commit: () => HEAL_RESULT,
      abort: vi.fn(),
      mutationStarted: () => true,
    };
    const coordinator = createRenderSourceErrorRecoveryCoordinator({
      rendererSourceIds: plan.sourceIds,
      scheduleFrame: frames.schedule,
      cancelFrame: frames.cancel,
      ensureSources: () => true,
      controller: {
        invalidateSourceState: vi.fn(),
        prepareCurrentSceneHeal: () => plan,
        healCurrentScene: () => HEAL_RESULT,
      },
      beforePublish: () => ready,
      onSuccess: vi.fn(),
      onError: vi.fn(),
    });

    coordinator.handleSourceError({ sourceId: plan.sourceIds[0] });
    frames.flushNext();
    expect(publish).not.toHaveBeenCalled();

    release();
    await expect(coordinator.whenSettled()).resolves.toBeUndefined();
    expect(publish).toHaveBeenCalledOnce();
  });

  it('aborts provisional recovery ownership when its activated render is rejected', async () => {
    const frames = new FrameHarness();
    const failure = new Error('recovery bank did not render');
    let activeRevision = 'one';
    const publish = vi.fn();
    const abort = vi.fn(() => {
      activeRevision = 'one';
    });
    const plan = {
      strategy: 'full' as const,
      sourceIds: [`${WAYS_SOURCE}--bank-b`],
      units: [],
      stage: () => HEAL_RESULT,
      markSourcesLoaded: vi.fn(),
      activate: vi.fn(() => {
        activeRevision = 'two';
      }),
      publish,
      commit: () => HEAL_RESULT,
      abort,
      mutationStarted: () => true,
    };
    const coordinator = createRenderSourceErrorRecoveryCoordinator({
      rendererSourceIds: plan.sourceIds,
      scheduleFrame: frames.schedule,
      cancelFrame: frames.cancel,
      ensureSources: () => true,
      controller: {
        invalidateSourceState: vi.fn(),
        prepareCurrentSceneHeal: () => plan,
        healCurrentScene: () => HEAL_RESULT,
      },
      beforeScenePublish: () => Promise.reject(failure),
      onSuccess: vi.fn(),
      onError: vi.fn(),
    });

    coordinator.requestRecovery();
    const settled = coordinator.whenSettled();
    frames.flushNext();

    await expect(settled).rejects.toBe(failure);
    expect(plan.activate).toHaveBeenCalledOnce();
    expect(publish).not.toHaveBeenCalled();
    expect(abort).toHaveBeenCalledOnce();
    expect(activeRevision).toBe('one');
  });

  it('keeps recovery pending until the healed sources reach their paint barrier', async () => {
    const frames = new FrameHarness();
    let releasePaint = () => {};
    const painted = new Promise<void>((resolve) => {
      releasePaint = resolve;
    });
    const coordinator = createRenderSourceErrorRecoveryCoordinator({
      rendererSourceIds: [WAYS_SOURCE],
      scheduleFrame: frames.schedule,
      cancelFrame: frames.cancel,
      ensureSources: () => true,
      controller: {
        invalidateSourceState: vi.fn(),
        healCurrentScene: () => HEAL_RESULT,
      },
      onSuccess: () => painted,
      onError: vi.fn(),
    });

    coordinator.requestRecovery();
    const settled = coordinator.whenSettled();
    frames.flushNext();
    let completed = false;
    void settled.then(() => {
      completed = true;
    });
    await Promise.resolve();
    expect(completed).toBe(false);

    releasePaint();
    await expect(settled).resolves.toBeUndefined();
  });

  it('coalesces repeated renderer errors and heals the latest controller scene once', () => {
    let latestRevision = 'revision-1';
    const healedRevisions: string[] = [];
    const healCurrentScene = vi.fn(() => {
      healedRevisions.push(latestRevision);
      return HEAL_RESULT;
    });
    const harness = recoveryHarness({
      controller: {
        invalidateSourceState: vi.fn(),
        healCurrentScene,
      },
    });

    harness.coordinator.handleSourceError({ sourceId: WAYS_SOURCE });
    harness.coordinator.handleSourceError({ sourceId: HIT_SOURCE });
    latestRevision = 'revision-2';
    harness.coordinator.handleSourceError({ sourceId: WAYS_SOURCE });

    expect(harness.frames.schedule).toHaveBeenCalledOnce();
    expect(harness.frames.pendingCount()).toBe(1);
    harness.frames.flushNext();

    expect(healCurrentScene).toHaveBeenCalledOnce();
    expect(healedRevisions).toEqual(['revision-2']);
    expect(harness.onSuccess).toHaveBeenCalledOnce();
  });

  it.each([undefined, 'openfreemap', 'openfreemap-tiles'])(
    'ignores a non-renderer source error from %s',
    (sourceId) => {
      const harness = recoveryHarness();

      expect(harness.coordinator.handleSourceError({ sourceId })).toBe(false);

      expect(harness.invalidateSourceState).not.toHaveBeenCalled();
      expect(harness.frames.schedule).not.toHaveBeenCalled();
      expect(harness.onError).not.toHaveBeenCalled();
    },
  );

  it('retains invalid state when sources are unavailable and retries on a later owned error', () => {
    let sourcesReady = false;
    let invalid = false;
    const invalidateSourceState = vi.fn(() => {
      invalid = true;
    });
    const healCurrentScene = vi.fn(() => {
      invalid = false;
      return HEAL_RESULT;
    });
    const harness = recoveryHarness({
      ensureSources: () => sourcesReady,
      controller: { invalidateSourceState, healCurrentScene },
    });

    harness.coordinator.handleSourceError({ sourceId: WAYS_SOURCE });
    harness.frames.flushNext();

    expect(invalid).toBe(true);
    expect(healCurrentScene).not.toHaveBeenCalled();
    expect(harness.onSuccess).not.toHaveBeenCalled();
    expect(harness.onError).toHaveBeenCalledWith(expect.any(Error));

    sourcesReady = true;
    harness.coordinator.handleSourceError({ sourceId: WAYS_SOURCE });
    harness.frames.flushNext();

    expect(invalid).toBe(false);
    expect(healCurrentScene).toHaveBeenCalledOnce();
    expect(harness.onSuccess).toHaveBeenCalledOnce();
  });

  it.each(['ensure', 'heal'] as const)(
    'retains invalid state when %s throws and permits a later retry',
    (failingStep) => {
      let shouldFail = true;
      let invalid = false;
      const failure = new Error(`${failingStep} failed`);
      const ensureSources = vi.fn(() => {
        if (failingStep === 'ensure' && shouldFail) throw failure;
        return true;
      });
      const controller = {
        invalidateSourceState: vi.fn(() => {
          invalid = true;
        }),
        healCurrentScene: vi.fn(() => {
          if (failingStep === 'heal' && shouldFail) throw failure;
          invalid = false;
          return HEAL_RESULT;
        }),
      };
      const harness = recoveryHarness({ ensureSources, controller });

      harness.coordinator.handleSourceError({ sourceId: WAYS_SOURCE });
      harness.frames.flushNext();

      expect(invalid).toBe(true);
      expect(harness.onSuccess).not.toHaveBeenCalled();
      expect(harness.onError).toHaveBeenCalledWith(failure);

      shouldFail = false;
      harness.coordinator.handleSourceError({ sourceId: WAYS_SOURCE });
      harness.frames.flushNext();

      expect(invalid).toBe(false);
      expect(controller.healCurrentScene).toHaveBeenCalledTimes(failingStep === 'heal' ? 2 : 1);
      expect(harness.onSuccess).toHaveBeenCalledOnce();
    },
  );

  it('cancels pending work and ignores future errors after disposal', () => {
    const harness = recoveryHarness();

    harness.coordinator.handleSourceError({ sourceId: WAYS_SOURCE });
    harness.coordinator.dispose();

    expect(harness.frames.cancel).toHaveBeenCalledOnce();
    expect(harness.frames.pendingCount()).toBe(0);
    expect(harness.coordinator.handleSourceError({ sourceId: WAYS_SOURCE })).toBe(false);
    expect(harness.frames.schedule).toHaveBeenCalledOnce();
    expect(harness.healCurrentScene).not.toHaveBeenCalled();
    expect(harness.onSuccess).not.toHaveBeenCalled();
    expect(harness.onError).not.toHaveBeenCalled();
  });
});
