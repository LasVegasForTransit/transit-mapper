import { describe, expect, it } from 'vitest';
import {
  runFirstSessionMatrix,
  type FirstSessionSurfaceRunner,
} from '../../scripts/perf/first-session-matrix';
import type { PerfFirstSessionJourney, PerfFirstSessionSample } from '../../src/perf/types';

function sample(journey: PerfFirstSessionJourney): PerfFirstSessionSample {
  const empty = { encodedBytes: 0, decodedBytes: 0, requestCount: 0 };
  return {
    journey,
    surface:
      journey === 'new-user-editor' ? 'editor' : journey === 'public-share' ? 'share' : 'embed',
    cacheState: 'cold',
    milestones: {
      documentResponseEndMs: 0,
      bootstrapStartMs: null,
      shellMountedMs: null,
      storageReadStartMs: null,
      storageReadEndMs: null,
      deserializeStartMs: null,
      deserializeEndMs: null,
      systemCommittedMs: null,
      mapStyleReadyMs: null,
      firstSystemPaintMs: null,
      interactiveMs: null,
      networkIdleMs: null,
      serviceWorkerReadyMs: null,
    },
    network: {
      authority: 'cdp-network-encoded-data-length',
      automaticBoundaryMs: 60_000,
      settled: true,
      unsettledNonMapRequestCount: 0,
      requests: [],
      phases: {},
      total: {
        firstPartyApplication: { ...empty },
        externalMap: { ...empty },
        documentData: { ...empty },
        serviceWorker: { ...empty },
        telemetry: { ...empty },
        other: { ...empty },
        total: { ...empty },
      },
    },
  };
}

describe('the automatic first-session matrix', () => {
  it('captures editor, public share, and cross-site embed in deterministic order', async () => {
    const calls: string[] = [];
    const runner: FirstSessionSurfaceRunner = {
      runNewUserEditor: () => {
        calls.push('editor');
        return Promise.resolve(sample('new-user-editor'));
      },
      runPublicShare: () => {
        calls.push('share');
        return Promise.resolve(sample('public-share'));
      },
      runCrossSiteEmbed: () => {
        calls.push('embed');
        return Promise.resolve(sample('cross-site-embed'));
      },
    };

    const samples = await runFirstSessionMatrix(runner);

    expect(calls).toEqual(['editor', 'share', 'embed']);
    expect(samples.map(({ journey }) => journey)).toEqual([
      'new-user-editor',
      'public-share',
      'cross-site-embed',
    ]);
  });
});
