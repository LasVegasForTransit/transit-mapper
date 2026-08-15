import type { PerformanceSurface } from '@transitmapper/core/performance/contract';
import { currentBuildInfo, type BuildInfo } from '../build-info';
import { buildSampleDecision, type SampleDecisionMemory } from './field-sampling-policy';

interface FieldSamplingBootstrapOptions {
  privacySignal(): boolean;
  eligibleBuild(): boolean;
  sampled(): boolean;
  loadClient(surface: PerformanceSurface): Promise<void>;
}

export function createFieldSamplingBootstrap(options: FieldSamplingBootstrapOptions): {
  start(surface: PerformanceSurface): void;
} {
  let started = false;
  return {
    start(surface) {
      if (started) return;
      started = true;
      try {
        if (options.privacySignal() || !options.eligibleBuild() || !options.sampled()) return;
        void options.loadClient(surface).catch(() => undefined);
      } catch {
        // Optional evidence must never become an application startup failure.
      }
    },
  };
}

type PrivacyNavigator = Navigator & { globalPrivacyControl?: boolean };
type PrivacyWindow = Window & { doNotTrack?: string | null };

function privacySignalPresent(): boolean {
  const browserNavigator = navigator as PrivacyNavigator;
  const browserWindow = window as PrivacyWindow;
  return (
    browserNavigator.globalPrivacyControl === true ||
    browserNavigator.doNotTrack === '1' ||
    browserWindow.doNotTrack === '1'
  );
}

interface EligibleBuild {
  buildId: string;
  siteOrigin: string;
  sampling: BuildInfo['performanceSampling'];
}

function eligibleBuild(): EligibleBuild | null {
  const info = currentBuildInfo();
  const siteUrl: unknown = import.meta.env.VITE_SITE_URL;
  if (
    !import.meta.env.PROD ||
    !info.performanceSampling.enabled ||
    !info.releaseTag ||
    !info.commitSha ||
    typeof siteUrl !== 'string'
  ) {
    return null;
  }
  try {
    const siteOrigin = new URL(siteUrl).origin;
    if (window.location.origin !== siteOrigin) return null;
    return {
      buildId: `${info.releaseTag}+${info.commitSha.slice(0, 12)}`,
      siteOrigin,
      sampling: info.performanceSampling,
    };
  } catch {
    return null;
  }
}

const sampleMemory: SampleDecisionMemory = new Map();
let candidate: EligibleBuild | null = null;
const bootstrap = createFieldSamplingBootstrap({
  privacySignal: privacySignalPresent,
  eligibleBuild: () => {
    candidate = eligibleBuild();
    return candidate !== null;
  },
  sampled: () => {
    if (!candidate) return false;
    let storage: Storage | null = null;
    try {
      storage = window.sessionStorage;
    } catch {
      // The policy owns a module-memory fallback for blocked storage.
    }
    return buildSampleDecision({
      buildId: candidate.buildId,
      ...candidate.sampling,
      now: Date.now(),
      crypto: window.crypto,
      storage,
      memory: sampleMemory,
    });
  },
  loadClient: async (surface) => {
    if (!candidate) return;
    const selected = candidate;
    const { startFieldSampleClient } = await import('./field-sample-client');
    startFieldSampleClient(surface, selected.buildId, selected.siteOrigin);
  },
});

export function startFieldSampling(surface: PerformanceSurface): void {
  bootstrap.start(surface);
}
