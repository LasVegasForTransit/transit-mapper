import { describe, expect, it, vi } from 'vitest';
import { scheduleSourceBankSeed } from '../../src/map/source-bank-settlement';
import type { RenderSceneSourceUpdatePlan } from '../../src/map/render-scene-source-updater';

function seedPlan(events: string[]): RenderSceneSourceUpdatePlan {
  return {
    strategy: 'full',
    sourceIds: ['tm-ways--bank-b', 'tm-stations--bank-b'],
    units: ['ways', 'stations'].map((id) => ({
      id,
      sliceExclusive: true,
      run: () => {
        events.push(id);
      },
    })),
    mode: 'seed',
    bank: 'b',
    stage: () => {
      events.push('stage');
      return {
        strategy: 'full',
        sourceUploadCount: 2,
        fullSourceUploadCount: 2,
        patchSourceUploadCount: 0,
        fallbackSourceUploadCount: 0,
        uploadedFeatureCount: 2,
        addedFeatureCount: 0,
        changedFeatureCount: 0,
        removedFeatureCount: 0,
      };
    },
    markSourcesLoaded: () => events.push('loaded'),
    publish: () => events.push('publish'),
    commit: vi.fn(),
    abort: vi.fn(() => events.push('abort')),
    mutationStarted: () => events.length > 0,
  };
}

describe('render source bank background seed', () => {
  it('uploads one hidden source per frame and retains only after readiness', async () => {
    const events: string[] = [];
    const frames: Array<() => void> = [];
    let release = () => {};
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handle = scheduleSourceBankSeed({
      plan: seedPlan(events),
      scheduleFrame: (callback) => frames.push(callback),
      cancelFrame: vi.fn(),
      beforePublish: () => ready,
    });

    frames.shift()?.();
    expect(events).toEqual(['ways']);
    frames.shift()?.();
    expect(events).toEqual(['ways', 'stations']);
    frames.shift()?.();
    expect(events).toEqual(['ways', 'stations', 'stage']);
    release();
    await handle.settled;
    expect(events).toEqual(['ways', 'stations', 'stage', 'loaded', 'publish']);
  });

  it('aborts a partial hidden seed without publishing it', async () => {
    const events: string[] = [];
    const frames: Array<() => void> = [];
    const handle = scheduleSourceBankSeed({
      plan: seedPlan(events),
      scheduleFrame: (callback) => frames.push(callback),
      cancelFrame: vi.fn(),
      beforePublish: vi.fn(),
    });

    frames.shift()?.();
    handle.cancel();
    await handle.settled;
    expect(events).toEqual(['ways', 'abort']);
  });
});
