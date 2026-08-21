import { describe, expect, it, vi } from 'vitest';
import {
  attachMapStyleRecovery,
  createMapStyleFeatureDataRecovery,
  recoverMapStyleState,
  type MapStyleRecoverySteps,
} from '../../src/map/styleRecovery';

type StyleRecoveryEvent = 'style.load' | 'idle';

class FakeStyleRecoveryMap {
  private readonly listeners = new Map<StyleRecoveryEvent, Set<() => void>>();
  private readonly onceListeners = new Map<StyleRecoveryEvent, Set<() => void>>();

  on(event: StyleRecoveryEvent, listener: () => void): this {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  once(event: StyleRecoveryEvent, listener: () => void): this {
    this.on(event, listener);
    const listeners = this.onceListeners.get(event) ?? new Set();
    listeners.add(listener);
    this.onceListeners.set(event, listeners);
    return this;
  }

  off(event: StyleRecoveryEvent, listener: () => void): this {
    this.listeners.get(event)?.delete(listener);
    this.onceListeners.get(event)?.delete(listener);
    return this;
  }

  emit(event: StyleRecoveryEvent): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) {
      if (this.onceListeners.get(event)?.delete(listener))
        this.listeners.get(event)?.delete(listener);
      listener();
    }
  }
}

function recoveryHarness(overlayReady = true, rendererSourcesRetained = true) {
  const calls: string[] = [];
  const step = (name: string) =>
    vi.fn(() => {
      calls.push(name);
    });
  const steps: MapStyleRecoverySteps = {
    registerIcons: step('icons'),
    hasRetainedRendererSources: vi.fn(() => rendererSourcesRetained),
    ensureOverlay: vi.fn(() => {
      calls.push('overlay');
      return overlayReady;
    }),
    restoreFeatureData: step('feature data'),
    restoreEditorFeatureState: step('editor feature state'),
    restoreGesturePreview: step('gesture preview'),
    restoreLandmarkVisibility: step('landmarks'),
    restoreDiagramVisibility: step('diagram visibility'),
    restoreSimulation: step('simulation'),
    repaint: step('repaint'),
  };
  return { calls, steps };
}

describe('map style recovery', () => {
  it('retries a rejected style replacement when MapLibre becomes idle', () => {
    const map = new FakeStyleRecoveryMap();
    const recover = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    const detach = attachMapStyleRecovery(map, () => true, recover);

    map.emit('style.load');
    expect(recover).toHaveBeenCalledOnce();

    map.emit('idle');
    expect(recover).toHaveBeenCalledTimes(2);

    detach();
  });

  it('removes a pending idle retry during cleanup', () => {
    const map = new FakeStyleRecoveryMap();
    const recover = vi.fn(() => false);
    const detach = attachMapStyleRecovery(map, () => true, recover);

    map.emit('style.load');
    detach();
    map.emit('idle');

    expect(recover).toHaveBeenCalledOnce();
  });

  it('restores app state without rebuilding retained renderer feature data', () => {
    const { calls, steps } = recoveryHarness();

    expect(recoverMapStyleState(steps)).toBe(true);
    expect(steps.restoreFeatureData).not.toHaveBeenCalled();
    expect(calls).toEqual([
      'icons',
      'overlay',
      'editor feature state',
      'gesture preview',
      'landmarks',
      'diagram visibility',
      'simulation',
      'repaint',
    ]);
  });

  it('restores feature data when any renderer source was not retained', () => {
    const { calls, steps } = recoveryHarness(true, false);

    expect(recoverMapStyleState(steps)).toBe(true);
    expect(steps.restoreFeatureData).toHaveBeenCalledOnce();
    expect(calls).toEqual([
      'icons',
      'overlay',
      'feature data',
      'editor feature state',
      'gesture preview',
      'landmarks',
      'diagram visibility',
      'simulation',
      'repaint',
    ]);
  });

  it('waits for a usable style before restoring dependent state', () => {
    const { calls, steps } = recoveryHarness(false, false);

    expect(recoverMapStyleState(steps)).toBe(false);
    expect(steps.restoreFeatureData).not.toHaveBeenCalled();
    expect(calls).toEqual(['icons', 'overlay']);
  });
});

describe('map style feature-data recovery', () => {
  const upload = { sourceUploadCount: 3 };

  function featureDataHarness(
    retainedScene = true,
    replayFailure?: Error,
    canScheduleFullProjection = true,
  ) {
    let pending = false;
    const setPending = vi.fn((value: boolean) => {
      pending = value;
    });
    const invalidateSourceState = vi.fn();
    const healCurrentScene = vi.fn(() => {
      if (replayFailure) throw replayFailure;
      return upload;
    });
    const recordFullUpload = vi.fn();
    const replayEditorState = vi.fn();
    const scheduleFullProjection = vi.fn();
    const requestSourceRecovery = vi.fn();
    const recovery = createMapStyleFeatureDataRecovery({
      hasRetainedScene: () => retainedScene,
      canScheduleFullProjection: () => canScheduleFullProjection,
      setPending,
      invalidateSourceState,
      healCurrentScene,
      recordFullUpload,
      replayEditorState,
      scheduleFullProjection,
      requestSourceRecovery,
    });
    return {
      recovery,
      pending: () => pending,
      setPending,
      invalidateSourceState,
      healCurrentScene,
      recordFullUpload,
      replayEditorState,
      scheduleFullProjection,
      requestSourceRecovery,
    };
  }

  it('replays a retained complete scene without scheduling projection', () => {
    const harness = featureDataHarness();

    expect(harness.recovery.restore()).toBe('retained-scene-healed');

    expect(harness.invalidateSourceState).toHaveBeenCalledOnce();
    expect(harness.healCurrentScene).toHaveBeenCalledOnce();
    expect(harness.recordFullUpload).toHaveBeenCalledWith(upload);
    expect(harness.replayEditorState).toHaveBeenCalledOnce();
    expect(harness.scheduleFullProjection).not.toHaveBeenCalled();
    expect(harness.requestSourceRecovery).not.toHaveBeenCalled();
    expect(harness.pending()).toBe(false);
  });

  it('uses the staged retained-scene recovery path when one is available', () => {
    const harness = featureDataHarness();
    const scheduleRetainedSceneHeal = vi.fn();
    const recovery = createMapStyleFeatureDataRecovery({
      hasRetainedScene: () => true,
      canScheduleFullProjection: () => true,
      setPending: harness.setPending,
      invalidateSourceState: harness.invalidateSourceState,
      healCurrentScene: harness.healCurrentScene,
      scheduleRetainedSceneHeal,
      recordFullUpload: harness.recordFullUpload,
      replayEditorState: harness.replayEditorState,
      scheduleFullProjection: harness.scheduleFullProjection,
      requestSourceRecovery: harness.requestSourceRecovery,
    });

    expect(recovery.restore()).toBe('retained-scene-heal-scheduled');
    expect(scheduleRetainedSceneHeal).toHaveBeenCalledOnce();
    expect(harness.invalidateSourceState).not.toHaveBeenCalled();
    expect(harness.healCurrentScene).not.toHaveBeenCalled();
    expect(harness.pending()).toBe(true);

    recovery.sourceRecoverySucceeded(upload);
    expect(harness.pending()).toBe(false);
  });

  it('schedules projection only before the first retained scene exists', () => {
    const harness = featureDataHarness(false);

    expect(harness.recovery.restore()).toBe('full-projection-scheduled');

    expect(harness.scheduleFullProjection).toHaveBeenCalledOnce();
    expect(harness.invalidateSourceState).not.toHaveBeenCalled();
    expect(harness.healCurrentScene).not.toHaveBeenCalled();
    expect(harness.pending()).toBe(true);
  });

  it('defers fallback projection while the durable document is still loading', () => {
    const harness = featureDataHarness(false, undefined, false);

    expect(harness.recovery.restore()).toBe('full-projection-deferred');

    expect(harness.scheduleFullProjection).not.toHaveBeenCalled();
    expect(harness.pending()).toBe(true);
  });

  it('keeps style healing pending and requests source recovery after replay fails', () => {
    const failure = new Error('setData failed');
    const harness = featureDataHarness(true, failure);

    expect(harness.recovery.restore()).toBe('source-recovery-requested');

    expect(harness.requestSourceRecovery).toHaveBeenCalledOnce();
    expect(harness.recordFullUpload).not.toHaveBeenCalled();
    expect(harness.replayEditorState).not.toHaveBeenCalled();
    expect(harness.pending()).toBe(true);

    harness.recovery.sourceRecoverySucceeded(upload);
    expect(harness.recordFullUpload).toHaveBeenCalledWith(upload);
    expect(harness.replayEditorState).toHaveBeenCalledOnce();
    expect(harness.pending()).toBe(false);
  });
});
