import { describe, expect, it } from 'vitest';
import type {
  PerfByteBreakdown,
  PerfNetworkByteReport,
  PerfNetworkPhaseName,
} from '../../src/perf/network-byte-types';
import {
  captureFirstSession,
  type FirstSessionPageDriver,
  type FirstSessionRecorder,
} from '../../scripts/perf/first-session';

function emptyBreakdown(): PerfByteBreakdown {
  const totals = { encodedBytes: 0, decodedBytes: 0, requestCount: 0 };
  return {
    firstPartyApplication: { ...totals },
    externalMap: { ...totals },
    documentData: { ...totals },
    serviceWorker: { ...totals },
    telemetry: { ...totals },
    other: { ...totals },
    total: { ...totals },
  };
}

const COMMON_PHASES: Partial<Record<PerfNetworkPhaseName, number>> = {
  document: 20,
  shell: 30,
  documentReady: 50,
  firstSystemPaint: 100,
  interactionReady: 110,
  networkIdle: 200,
  automaticBoundary: 60_000,
};

function driverWithout(phase: PerfNetworkPhaseName, editor = false): FirstSessionPageDriver {
  const bytePhases = Object.fromEntries(
    Object.entries({
      ...COMMON_PHASES,
      ...(editor ? { serviceWorkerReady: 400 } : {}),
    }).filter(([name]) => name !== phase),
  ) as Partial<Record<PerfNetworkPhaseName, number>>;
  return {
    navigate: () => Promise.resolve(),
    waitForInteractive: () => Promise.resolve(),
    waitForFirstSystemPaint: () => Promise.resolve(),
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
          serviceWorkerReadyMs: editor ? 400 : null,
        },
        bytePhases,
      }),
    readResourceTimings: () => Promise.resolve([]),
    readServiceWorkerRegistrationCount: () => Promise.resolve(editor ? 1 : 0),
  };
}

function recorder(): FirstSessionRecorder {
  return {
    waitForContractRequests: () => Promise.resolve(),
    networkIdleAt: () => 200,
    createReport: (options): PerfNetworkByteReport => ({
      authority: 'cdp-network-encoded-data-length',
      automaticBoundaryMs: 60_000,
      settled: true,
      unsettledNonMapRequestCount: 0,
      requests: [],
      phases: Object.fromEntries(
        Object.entries(options.phases).map(([name, atMs]) => [
          name,
          { atMs, bytes: emptyBreakdown() },
        ]),
      ),
      total: emptyBreakdown(),
    }),
  };
}

describe('the required first-session phase contract', () => {
  it.each([
    'document',
    'shell',
    'documentReady',
    'firstSystemPaint',
    'interactionReady',
    'networkIdle',
    'automaticBoundary',
  ] as const)('rejects a public surface with no %s phase', async (phase) => {
    await expect(
      captureFirstSession({
        driver: driverWithout(phase),
        recorder: recorder(),
        journey: 'public-share',
        surface: 'share',
        cacheState: 'cold',
      }),
    ).rejects.toThrow(`required ${phase} byte phase`);
  });

  it('rejects an editor with no service-worker-ready byte phase', async () => {
    await expect(
      captureFirstSession({
        driver: driverWithout('serviceWorkerReady', true),
        recorder: recorder(),
        journey: 'new-user-editor',
        surface: 'editor',
        cacheState: 'cold',
      }),
    ).rejects.toThrow('required serviceWorkerReady byte phase');
  });
});
