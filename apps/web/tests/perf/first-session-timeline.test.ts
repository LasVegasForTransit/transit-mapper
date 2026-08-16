import { describe, expect, it } from 'vitest';
import { createFirstSessionTimeline } from '../../src/perf/first-session-timeline';

describe('the first-session timeline', () => {
  it('maps shipping startup marks onto byte phases without inventing absent milestones', () => {
    const timeline = createFirstSessionTimeline({
      navigationTimeOriginMs: 1_000_000,
      documentResponseEndMs: 25,
      networkIdleMs: 510,
      marks: {
        'tm:bootstrap-start': 5,
        'tm:shell-mounted': 30,
        'tm:storage-read-start': 35,
        'tm:storage-read-end': 45,
        'tm:deserialize-start': 50,
        'tm:deserialize-end': 65,
        'tm:system-committed': 70,
        'tm:map-style-ready': 100,
        'tm:first-system-paint': 120,
        'tm:interactive': 140,
      },
    });

    expect(timeline.navigationTimeOriginMs).toBe(1_000_000);
    expect(timeline.milestones).toEqual({
      documentResponseEndMs: 25,
      bootstrapStartMs: 5,
      shellMountedMs: 30,
      storageReadStartMs: 35,
      storageReadEndMs: 45,
      deserializeStartMs: 50,
      deserializeEndMs: 65,
      systemCommittedMs: 70,
      mapStyleReadyMs: 100,
      firstSystemPaintMs: 120,
      interactiveMs: 140,
      networkIdleMs: 510,
      serviceWorkerReadyMs: null,
    });
    expect(timeline.bytePhases).toEqual({
      document: 25,
      shell: 30,
      documentReady: 70,
      firstSystemPaint: 120,
      interactionReady: 140,
      networkIdle: 510,
      automaticBoundary: 60_000,
    });
  });

  it('includes service-worker readiness when installation completes', () => {
    const timeline = createFirstSessionTimeline({
      navigationTimeOriginMs: 2_000_000,
      documentResponseEndMs: 20,
      networkIdleMs: null,
      marks: {
        'tm:shell-mounted': 30,
        'tm:system-committed': 55,
        'tm:first-system-paint': 90,
        'tm:interactive': 100,
        'tm:service-worker-ready': 750,
      },
    });

    expect(timeline.milestones.serviceWorkerReadyMs).toBe(750);
    expect(timeline.bytePhases.serviceWorkerReady).toBe(750);
    expect(timeline.bytePhases.networkIdle).toBeUndefined();
  });
});
