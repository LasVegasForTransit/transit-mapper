import {
  AUTOMATIC_FIRST_SESSION_BOUNDARY_MS,
  type PerfFirstSessionTimeline,
} from '../../src/perf/first-session-timeline';
import type {
  CreateNetworkByteReportOptions,
  PerfNetworkIdleOptions,
  PerfNetworkByteReport,
  PerfNetworkPhaseName,
  PerfNetworkWindowOptions,
  PerfResourceTimingAttribution,
} from '../../src/perf/network-byte-types';
import type {
  PerfCacheState,
  PerfFirstSessionJourney,
  PerfFirstSessionSample,
  PerfSurface,
} from '../../src/perf/types';

export interface FirstSessionPageDriver {
  navigate(): Promise<void>;
  waitForInteractive(): Promise<void>;
  waitForAutomaticBoundary(): Promise<void>;
  readTimeline(networkIdleMs: number | null): Promise<PerfFirstSessionTimeline>;
  readResourceTimings(): Promise<readonly PerfResourceTimingAttribution[]>;
  readServiceWorkerRegistrationCount(): Promise<number>;
}

export interface FirstSessionRecorder {
  waitForContractRequests(options: PerfNetworkWindowOptions): Promise<void>;
  networkIdleAt(options: PerfNetworkIdleOptions): number | null;
  createReport(options: CreateNetworkByteReportOptions): PerfNetworkByteReport;
}

export type FirstSessionServiceWorkerPolicy = 'current' | 'legacy-497a549';

interface CaptureFirstSessionOptions {
  driver: FirstSessionPageDriver;
  recorder: FirstSessionRecorder;
  journey: PerfFirstSessionJourney;
  surface: PerfSurface;
  cacheState: PerfCacheState;
  serviceWorkerPolicy?: FirstSessionServiceWorkerPolicy;
}

const REQUIRED_FIRST_SESSION_PHASES = [
  'document',
  'shell',
  'documentReady',
  'firstSystemPaint',
  'interactionReady',
  'networkIdle',
  'automaticBoundary',
] as const;

function assertRequiredBytePhases(surface: PerfSurface, report: PerfNetworkByteReport): void {
  const requiredPhases: readonly PerfNetworkPhaseName[] =
    surface === 'editor'
      ? [...REQUIRED_FIRST_SESSION_PHASES, 'serviceWorkerReady']
      : REQUIRED_FIRST_SESSION_PHASES;
  for (const phase of requiredPhases) {
    if (report.phases[phase] === undefined) {
      throw new Error(`The ${surface} report has no required ${phase} byte phase.`);
    }
  }
}

function isServiceWorkerEvidence(report: PerfNetworkByteReport): boolean {
  return report.requests.some((request) => {
    if (request.target === 'service-worker') return true;
    try {
      return new URL(request.url).pathname === '/sw.js';
    } catch {
      return false;
    }
  });
}

interface ServiceWorkerPolicyOptions {
  surface: PerfSurface;
  count: number;
  timeline: PerfFirstSessionTimeline;
  report: PerfNetworkByteReport;
  policy: FirstSessionServiceWorkerPolicy;
}

function assertServiceWorkerPolicy(options: ServiceWorkerPolicyOptions): void {
  const { surface, count, timeline, report, policy } = options;
  if (surface === 'editor' && count === 0) {
    throw new Error('The new-user editor did not register its service worker.');
  }
  if (surface === 'editor' && timeline.milestones.serviceWorkerReadyMs === null) {
    throw new Error('The editor service-worker installation did not become ready.');
  }
  if (policy === 'legacy-497a549') return;
  if (surface !== 'editor' && count > 0) {
    const label = surface === 'share' ? 'public share' : 'cross-site embed';
    throw new Error(`The ${label} registered ${count} service worker${count === 1 ? '' : 's'}.`);
  }
  if (surface !== 'editor' && isServiceWorkerEvidence(report)) {
    const label = surface === 'share' ? 'public share' : 'cross-site embed';
    throw new Error(`The ${label} attempted to register a service worker.`);
  }
}

export async function captureFirstSession(
  options: CaptureFirstSessionOptions,
): Promise<PerfFirstSessionSample> {
  await options.driver.navigate();
  await options.driver.waitForInteractive();
  await options.driver.waitForAutomaticBoundary();
  const initialTimeline = await options.driver.readTimeline(null);
  const window = {
    navigationTimeOriginMs: initialTimeline.navigationTimeOriginMs,
    automaticBoundaryMs: AUTOMATIC_FIRST_SESSION_BOUNDARY_MS,
  };
  await options.recorder.waitForContractRequests(window);
  const networkIdleMs = options.recorder.networkIdleAt({
    ...window,
    notBeforeMs:
      initialTimeline.milestones.interactiveMs ?? initialTimeline.milestones.documentResponseEndMs,
  });
  const timeline = await options.driver.readTimeline(networkIdleMs);
  const resourceTimings = await options.driver.readResourceTimings();
  const network = options.recorder.createReport({
    ...window,
    phases: timeline.bytePhases,
    resourceTimings,
  });
  assertRequiredBytePhases(options.surface, network);
  assertServiceWorkerPolicy({
    surface: options.surface,
    count: await options.driver.readServiceWorkerRegistrationCount(),
    timeline,
    report: network,
    policy: options.serviceWorkerPolicy ?? 'current',
  });
  return {
    journey: options.journey,
    surface: options.surface,
    cacheState: options.cacheState,
    milestones: timeline.milestones,
    network,
  };
}
