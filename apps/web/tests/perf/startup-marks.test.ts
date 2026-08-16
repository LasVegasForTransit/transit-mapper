import { afterEach, describe, expect, it, vi } from 'vitest';

interface StartupMarksModule {
  FIRST_SESSION_MARK_NAMES: readonly string[];
  BOOTSTRAP_START_MARK: string;
  SHELL_MOUNTED_MARK: string;
  STORAGE_READ_START_MARK: string;
  STORAGE_READ_END_MARK: string;
  DESERIALIZE_START_MARK: string;
  DESERIALIZE_END_MARK: string;
  SYSTEM_COMMITTED_MARK: string;
  MAP_STYLE_READY_MARK: string;
  FIRST_SYSTEM_PAINT_MARK: string;
  INTERACTIVE_MARK: string;
  SERVICE_WORKER_READY_MARK: string;
  markOnce: (name: string) => void;
}

const performanceModules = import.meta.glob('../../src/perf/*.ts', { eager: true });

function startupMarks(): StartupMarksModule {
  const module = performanceModules['../../src/perf/startup-marks.ts'];
  expect(module, 'the shipping startup-marks module exists').toBeDefined();
  return module as StartupMarksModule;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  performance.clearMarks();
});

describe('first-session User Timing marks', () => {
  it('publishes the complete canonical milestone vocabulary', () => {
    const marks = startupMarks();

    expect(marks.FIRST_SESSION_MARK_NAMES).toEqual([
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
      marks.BOOTSTRAP_START_MARK,
      marks.SHELL_MOUNTED_MARK,
      marks.STORAGE_READ_START_MARK,
      marks.STORAGE_READ_END_MARK,
      marks.DESERIALIZE_START_MARK,
      marks.DESERIALIZE_END_MARK,
      marks.SYSTEM_COMMITTED_MARK,
      marks.MAP_STYLE_READY_MARK,
      marks.FIRST_SYSTEM_PAINT_MARK,
      marks.INTERACTIVE_MARK,
      marks.SERVICE_WORKER_READY_MARK,
    ]).toEqual(marks.FIRST_SESSION_MARK_NAMES);
  });

  it('records a milestone at most once', () => {
    const { BOOTSTRAP_START_MARK, markOnce } = startupMarks();
    const mark = vi.spyOn(performance, 'mark');

    markOnce(BOOTSTRAP_START_MARK);
    markOnce(BOOTSTRAP_START_MARK);

    expect(mark).toHaveBeenCalledTimes(1);
    expect(mark).toHaveBeenCalledWith(BOOTSTRAP_START_MARK);
  });

  it('never makes startup fail when User Timing is unavailable or throws', () => {
    const { SHELL_MOUNTED_MARK, STORAGE_READ_START_MARK, markOnce } = startupMarks();
    vi.spyOn(performance, 'mark').mockImplementation(() => {
      throw new Error('User Timing rejected the mark.');
    });

    expect(() => markOnce(SHELL_MOUNTED_MARK)).not.toThrow();

    vi.restoreAllMocks();
    vi.stubGlobal('performance', undefined);
    expect(() => markOnce(STORAGE_READ_START_MARK)).not.toThrow();
  });
});
