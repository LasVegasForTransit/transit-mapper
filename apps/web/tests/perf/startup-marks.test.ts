import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMapStartupMilestones,
  type MapRuntime,
  type ObservableMapStartupMilestones,
} from '@transitmapper/map';
import * as startupMarks from '../../src/perf/startup-marks';

interface StyleLifecycle {
  readonly map: MapRuntime['map'];
  finishLoading(): void;
}

function createStyleLifecycle(initiallyLoaded: boolean): StyleLifecycle {
  let loaded = initiallyLoaded;
  const listeners = new Set<() => void>();
  const map = {
    isStyleLoaded: () => loaded,
    on: (event: string, listener: () => void) => {
      if (event === 'style.load') listeners.add(listener);
      return map;
    },
    off: (event: string, listener: () => void) => {
      if (event === 'style.load') listeners.delete(listener);
      return map;
    },
  } as unknown as MapRuntime['map'];
  return {
    map,
    finishLoading() {
      loaded = true;
      for (const listener of listeners) listener();
    },
  };
}

function createRuntime(
  style: StyleLifecycle,
  milestones: ObservableMapStartupMilestones = createMapStartupMilestones(),
): MapRuntime {
  return {
    host: { map: style.map, reportError: () => {} },
    map: style.map,
    milestones,
    requestTheme: () => Promise.resolve(),
    flushTheme: () => Promise.resolve(),
    refreshPadding: () => {},
    dispose: () => {},
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  performance.clearMarks();
});

describe('first-session User Timing marks', () => {
  it('publishes the complete canonical milestone vocabulary', () => {
    expect(startupMarks.FIRST_SESSION_MARK_NAMES).toEqual([
      'tm:bootstrap-start',
      'tm:shell-mounted',
      'tm:storage-read-start',
      'tm:storage-read-end',
      'tm:deserialize-start',
      'tm:deserialize-end',
      'tm:system-committed',
      'tm:map-style-ready',
      'tm:first-system-paint',
      'tm:interactive',
      'tm:service-worker-ready',
    ]);
    expect([
      startupMarks.BOOTSTRAP_START_MARK,
      startupMarks.SHELL_MOUNTED_MARK,
      startupMarks.STORAGE_READ_START_MARK,
      startupMarks.STORAGE_READ_END_MARK,
      startupMarks.DESERIALIZE_START_MARK,
      startupMarks.DESERIALIZE_END_MARK,
      startupMarks.SYSTEM_COMMITTED_MARK,
      startupMarks.MAP_STYLE_READY_MARK,
      startupMarks.FIRST_SYSTEM_PAINT_MARK,
      startupMarks.INTERACTIVE_MARK,
      startupMarks.SERVICE_WORKER_READY_MARK,
    ]).toEqual(startupMarks.FIRST_SESSION_MARK_NAMES);
  });

  it('records a milestone at most once', () => {
    const mark = vi.spyOn(performance, 'mark');

    startupMarks.markOnce(startupMarks.BOOTSTRAP_START_MARK);
    startupMarks.markOnce(startupMarks.BOOTSTRAP_START_MARK);

    expect(mark).toHaveBeenCalledTimes(1);
    expect(mark).toHaveBeenCalledWith(startupMarks.BOOTSTRAP_START_MARK);
  });

  it('never makes startup fail when User Timing is unavailable or throws', () => {
    vi.spyOn(performance, 'mark').mockImplementation(() => {
      throw new Error('User Timing rejected the mark.');
    });

    expect(() => startupMarks.markOnce(startupMarks.SHELL_MOUNTED_MARK)).not.toThrow();

    vi.restoreAllMocks();
    vi.stubGlobal('performance', undefined);
    expect(() => startupMarks.markOnce(startupMarks.STORAGE_READ_START_MARK)).not.toThrow();
  });

  it('publishes map content and interaction milestones to User Timing', () => {
    const milestones = createMapStartupMilestones();
    const detach = startupMarks.attachMapRuntimeStartupMarks(
      createRuntime(createStyleLifecycle(false), milestones),
    );

    milestones.contentCommitted();
    milestones.interactive();

    expect(performance.getEntriesByName(startupMarks.SYSTEM_COMMITTED_MARK, 'mark')).toHaveLength(
      1,
    );
    expect(performance.getEntriesByName(startupMarks.INTERACTIVE_MARK, 'mark')).toHaveLength(1);
    detach();
  });

  it('publishes map style readiness that predates host attachment', () => {
    const detach = startupMarks.attachMapRuntimeStartupMarks(
      createRuntime(createStyleLifecycle(true)),
    );

    expect(performance.getEntriesByName(startupMarks.MAP_STYLE_READY_MARK, 'mark')).toHaveLength(1);
    detach();
  });

  it('stops observing map startup after its runtime detaches', () => {
    const style = createStyleLifecycle(false);
    const milestones = createMapStartupMilestones();
    const detach = startupMarks.attachMapRuntimeStartupMarks(createRuntime(style, milestones));

    detach();
    style.finishLoading();
    milestones.interactive();

    expect(performance.getEntriesByName(startupMarks.MAP_STYLE_READY_MARK, 'mark')).toHaveLength(0);
    expect(performance.getEntriesByName(startupMarks.INTERACTIVE_MARK, 'mark')).toHaveLength(0);
  });
});
