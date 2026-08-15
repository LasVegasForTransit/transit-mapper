// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LEGACY_497A549_FIRST_SESSION_INIT_SCRIPT,
  installLegacy497a549FirstSessionMarks,
} from '../../scripts/perf/legacy-first-session-marks';

interface LegacyWindow extends Window {
  __TRANSITMAPPER_PERF_RUN__?: boolean;
}

function installPerformanceStub() {
  const marks = new Set<string>();
  vi.stubGlobal('performance', {
    getEntriesByName: (name: string) => (marks.has(name) ? [{ name }] : []),
    mark: (name: string) => marks.add(name),
  });
  return marks;
}

function installAnimationFrameStub(): void {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('the 497a549 first-session mark adapter', () => {
  it('does not capture a transpiler helper when Playwright serializes it', () => {
    expect(LEGACY_497A549_FIRST_SESSION_INIT_SCRIPT).not.toContain('__name');
  });

  it('projects the legacy editor state into observer-only modern milestones', () => {
    vi.useFakeTimers();
    const marks = installPerformanceStub();
    installAnimationFrameStub();

    installLegacy497a549FirstSessionMarks();
    document.body.innerHTML =
      '<div class="app" data-document-status="ready"></div>' +
      '<canvas class="maplibregl-canvas" width="640" height="480"></canvas>';
    vi.advanceTimersByTime(25);

    expect((window as LegacyWindow).__TRANSITMAPPER_PERF_RUN__).toBe(true);
    expect(marks).toEqual(
      new Set([
        'tm:bootstrap-start',
        'tm:shell-mounted',
        'tm:system-committed',
        'tm:first-system-paint',
        'tm:interactive',
      ]),
    );
  });

  it('marks a legacy embed shell and committed map without an editor document', () => {
    vi.useFakeTimers();
    const marks = installPerformanceStub();
    installAnimationFrameStub();

    installLegacy497a549FirstSessionMarks();
    document.body.innerHTML =
      '<div id="map"><canvas class="maplibregl-canvas" width="640" height="480"></canvas></div>' +
      '<p id="embed-status" hidden></p>';
    vi.advanceTimersByTime(25);

    expect(marks).toEqual(
      new Set([
        'tm:bootstrap-start',
        'tm:shell-mounted',
        'tm:system-committed',
        'tm:first-system-paint',
        'tm:interactive',
      ]),
    );
  });
});
