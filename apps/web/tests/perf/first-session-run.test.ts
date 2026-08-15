import { describe, expect, it } from 'vitest';
import type { PerfNetworkByteReport } from '../../src/perf/network-byte-types';
import {
  captureFirstSession,
  type FirstSessionPageDriver,
  type FirstSessionRecorder,
} from '../../scripts/perf/first-session';

function networkReport(): PerfNetworkByteReport {
  const totals = { encodedBytes: 10, decodedBytes: 20, requestCount: 1 };
  const breakdown = {
    firstPartyApplication: { ...totals },
    externalMap: { encodedBytes: 0, decodedBytes: 0, requestCount: 0 },
    documentData: { encodedBytes: 0, decodedBytes: 0, requestCount: 0 },
    serviceWorker: { encodedBytes: 0, decodedBytes: 0, requestCount: 0 },
    telemetry: { encodedBytes: 0, decodedBytes: 0, requestCount: 0 },
    other: { encodedBytes: 0, decodedBytes: 0, requestCount: 0 },
    total: { ...totals },
  };
  const phase = (atMs: number) => ({ atMs, bytes: breakdown });
  return {
    authority: 'cdp-network-encoded-data-length',
    automaticBoundaryMs: 60_000,
    settled: true,
    unsettledNonMapRequestCount: 0,
    requests: [],
    phases: {
      document: phase(20),
      shell: phase(30),
      documentReady: phase(50),
      firstSystemPaint: phase(90),
      interactionReady: phase(100),
      networkIdle: phase(500),
      serviceWorkerReady: phase(400),
      automaticBoundary: phase(60_000),
    },
    total: breakdown,
  };
}

describe('the automatic first-session capture', () => {
  it('waits through the boundary and all pre-boundary requests before reporting', async () => {
    const calls: string[] = [];
    const resourceTimings = [
      {
        url: 'https://app.test/assets/main.js',
        startTimeMs: 0,
        initiatorType: 'script',
        nextHopProtocol: 'h3',
        renderBlockingStatus: 'blocking' as const,
        transferSize: 100,
        encodedBodySize: 80,
        decodedBodySize: 200,
      },
    ];
    const driver: FirstSessionPageDriver = {
      navigate: () => {
        calls.push('navigate');
        return Promise.resolve();
      },
      waitForInteractive: () => {
        calls.push('interactive');
        return Promise.resolve();
      },
      waitForAutomaticBoundary: () => {
        calls.push('boundary');
        return Promise.resolve();
      },
      readTimeline: (networkIdleMs) => {
        calls.push(`timeline:${networkIdleMs}`);
        return Promise.resolve({
          navigationTimeOriginMs: 1_000_000,
          milestones: {
            documentResponseEndMs: 20,
            bootstrapStartMs: 5,
            shellMountedMs: 30,
            storageReadStartMs: 35,
            storageReadEndMs: 40,
            deserializeStartMs: null,
            deserializeEndMs: null,
            systemCommittedMs: 50,
            mapStyleReadyMs: 80,
            firstSystemPaintMs: 90,
            interactiveMs: 100,
            networkIdleMs,
            serviceWorkerReadyMs: 400,
          },
          bytePhases: {
            document: 20,
            shell: 30,
            documentReady: 50,
            firstSystemPaint: 90,
            interactionReady: 100,
            networkIdle: 500,
            serviceWorkerReady: 400,
            automaticBoundary: 60_000,
          },
        });
      },
      readResourceTimings: () => {
        calls.push('resource-timing');
        return Promise.resolve(resourceTimings);
      },
      readServiceWorkerRegistrationCount: () => {
        calls.push('service-workers');
        return Promise.resolve(1);
      },
    };
    const report = networkReport();
    const recorder: FirstSessionRecorder = {
      waitForContractRequests: (options) => {
        calls.push(`requests:${options.navigationTimeOriginMs}:${options.automaticBoundaryMs}`);
        return Promise.resolve();
      },
      networkIdleAt: (options) => {
        calls.push(`network-idle:${options.notBeforeMs}`);
        return 500;
      },
      createReport: (options) => {
        expect(options.resourceTimings).toBe(resourceTimings);
        calls.push(`report:${options.phases.shell}`);
        return report;
      },
    };

    const sample = await captureFirstSession({
      driver,
      recorder,
      journey: 'new-user-editor',
      surface: 'editor',
      cacheState: 'cold',
    });

    expect(calls).toEqual([
      'navigate',
      'interactive',
      'boundary',
      'timeline:null',
      'requests:1000000:60000',
      'network-idle:100',
      'timeline:500',
      'resource-timing',
      'report:30',
      'service-workers',
    ]);
    expect(sample.journey).toBe('new-user-editor');
    expect(sample.surface).toBe('editor');
    expect(sample.cacheState).toBe('cold');
    expect(sample.milestones.shellMountedMs).toBe(30);
    expect(sample.milestones.serviceWorkerReadyMs).toBe(400);
    expect(sample.network).toBe(report);
  });

  it('rejects an editor worker registration on a public surface', async () => {
    let timelineReads = 0;
    const driver: FirstSessionPageDriver = {
      navigate: () => Promise.resolve(),
      waitForInteractive: () => Promise.resolve(),
      waitForAutomaticBoundary: () => Promise.resolve(),
      readTimeline: () => {
        timelineReads += 1;
        return Promise.resolve({
          navigationTimeOriginMs: 1_000_000,
          milestones: {
            documentResponseEndMs: 20,
            bootstrapStartMs: 5,
            shellMountedMs: 30,
            storageReadStartMs: null,
            storageReadEndMs: null,
            deserializeStartMs: null,
            deserializeEndMs: null,
            systemCommittedMs: 50,
            mapStyleReadyMs: 80,
            firstSystemPaintMs: 100,
            interactiveMs: 110,
            networkIdleMs: null,
            serviceWorkerReadyMs: null,
          },
          bytePhases: {},
        });
      },
      readResourceTimings: () => Promise.resolve([]),
      readServiceWorkerRegistrationCount: () => Promise.resolve(1),
    };
    const recorder: FirstSessionRecorder = {
      waitForContractRequests: () => Promise.resolve(),
      networkIdleAt: () => null,
      createReport: networkReport,
    };

    await expect(
      captureFirstSession({
        driver,
        recorder,
        journey: 'public-share',
        surface: 'share',
        cacheState: 'cold',
      }),
    ).rejects.toThrow('public share registered 1 service worker');
    expect(timelineReads).toBe(2);
  });

  it('rejects a transient service-worker attempt on a public surface', async () => {
    const driver: FirstSessionPageDriver = {
      navigate: () => Promise.resolve(),
      waitForInteractive: () => Promise.resolve(),
      waitForAutomaticBoundary: () => Promise.resolve(),
      readTimeline: (networkIdleMs) =>
        Promise.resolve({
          navigationTimeOriginMs: 1_000_000,
          milestones: {
            documentResponseEndMs: 20,
            bootstrapStartMs: 5,
            shellMountedMs: 30,
            storageReadStartMs: null,
            storageReadEndMs: null,
            deserializeStartMs: null,
            deserializeEndMs: null,
            systemCommittedMs: 50,
            mapStyleReadyMs: 80,
            firstSystemPaintMs: 100,
            interactiveMs: 110,
            networkIdleMs,
            serviceWorkerReadyMs: null,
          },
          bytePhases: {
            document: 20,
            shell: 30,
            documentReady: 50,
            firstSystemPaint: 100,
            interactionReady: 110,
            networkIdle: 200,
            automaticBoundary: 60_000,
          },
        }),
      readResourceTimings: () => Promise.resolve([]),
      readServiceWorkerRegistrationCount: () => Promise.resolve(0),
    };
    const report = networkReport();
    report.requests.push({
      url: 'https://app.test/sw.js',
      category: 'first-party-application',
      target: 'page',
      initiator: 'script',
      contentType: 'text/javascript',
      cacheSource: 'network',
      protocol: 'h2',
      compression: 'br',
      renderBlockingStatus: 'non-blocking',
      attributionSource: 'cdp',
      byteAuthority: 'loading-finished',
      encodedBytes: 10,
      decodedBytes: 20,
      startedAtMs: 30,
      completedAtMs: 40,
    });
    const recorder: FirstSessionRecorder = {
      waitForContractRequests: () => Promise.resolve(),
      networkIdleAt: () => 200,
      createReport: () => report,
    };

    await expect(
      captureFirstSession({
        driver,
        recorder,
        journey: 'public-share',
        surface: 'share',
        cacheState: 'cold',
      }),
    ).rejects.toThrow('public share attempted to register a service worker');
  });

  it('rejects an editor whose service-worker installation never became ready', async () => {
    const driver: FirstSessionPageDriver = {
      navigate: () => Promise.resolve(),
      waitForInteractive: () => Promise.resolve(),
      waitForAutomaticBoundary: () => Promise.resolve(),
      readTimeline: (networkIdleMs) =>
        Promise.resolve({
          navigationTimeOriginMs: 1_000_000,
          milestones: {
            documentResponseEndMs: 20,
            bootstrapStartMs: 5,
            shellMountedMs: 30,
            storageReadStartMs: 35,
            storageReadEndMs: 40,
            deserializeStartMs: null,
            deserializeEndMs: null,
            systemCommittedMs: 50,
            mapStyleReadyMs: 80,
            firstSystemPaintMs: 100,
            interactiveMs: 110,
            networkIdleMs,
            serviceWorkerReadyMs: null,
          },
          bytePhases: {
            document: 20,
            shell: 30,
            documentReady: 50,
            firstSystemPaint: 100,
            interactionReady: 110,
            networkIdle: 200,
            automaticBoundary: 60_000,
          },
        }),
      readResourceTimings: () => Promise.resolve([]),
      readServiceWorkerRegistrationCount: () => Promise.resolve(1),
    };
    const recorder: FirstSessionRecorder = {
      waitForContractRequests: () => Promise.resolve(),
      networkIdleAt: () => 200,
      createReport: networkReport,
    };

    await expect(
      captureFirstSession({
        driver,
        recorder,
        journey: 'new-user-editor',
        surface: 'editor',
        cacheState: 'cold',
      }),
    ).rejects.toThrow('editor service-worker installation did not become ready');
  });
});
