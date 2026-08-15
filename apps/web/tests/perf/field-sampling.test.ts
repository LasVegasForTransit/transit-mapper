import type {
  PerformanceSample,
  PerformanceSurface,
} from '@transitmapper/core/performance/contract';
import { describe, expect, it, vi } from 'vitest';
import { createFieldSamplingController } from '../../src/perf/field-sample-client';
import { createFieldSamplingBootstrap } from '../../src/perf/field-sampling';

class LifecycleTarget extends EventTarget {
  visibilityState: DocumentVisibilityState = 'visible';
}

function sample(surface: PerformanceSurface): PerformanceSample {
  return {
    schemaVersion: 1,
    buildId: 'v1.0.0+0123456',
    surface,
    phases: {
      documentResponseEndMs: null,
      shellMountedMs: null,
      bootstrapCompleteMs: null,
      storageCompleteMs: null,
      deserializeCompleteMs: null,
      systemCommittedMs: null,
      firstSystemPaintMs: null,
      interactiveMs: null,
      networkIdleMs: null,
      serviceWorkerReadyMs: null,
    },
    vitals: { lcpMs: null, cls: null, inpMs: null },
    bytes: {
      firstPartyAppBytes: 0,
      externalMapBytes: 0,
      documentDataBytes: 0,
      serviceWorkerBytes: null,
      telemetryBytes: null,
      totalBytes: 0,
    },
    cacheState: 'unknown',
    serviceWorkerState: 'unsupported',
    deviceTier: 'unknown',
    networkTier: 'unknown',
    capabilityBits: 0,
  };
}

describe('field sample lifecycle', () => {
  it.each([
    ['Global Privacy Control', { globalPrivacyControl: true }],
    ['navigator Do Not Track', { navigatorDoNotTrack: '1' }],
    ['window Do Not Track', { windowDoNotTrack: '1' }],
  ])('checks %s before build, sampling, or observers', (_label, signals) => {
    const privacySignals = signals as Partial<{
      globalPrivacyControl: boolean;
      navigatorDoNotTrack: string;
      windowDoNotTrack: string;
    }>;
    const calls: string[] = [];
    const controller = createFieldSamplingController({
      privacySignal: () => {
        calls.push('privacy');
        return (
          privacySignals.globalPrivacyControl === true ||
          privacySignals.navigatorDoNotTrack === '1' ||
          privacySignals.windowDoNotTrack === '1'
        );
      },
      eligibleBuild: () => {
        calls.push('build');
        return true;
      },
      sampled: () => {
        calls.push('sample');
        return true;
      },
      installObservers: () => {
        calls.push('observers');
        return { snapshot: () => sample('editor'), disconnect: () => undefined };
      },
      lifecycle: new LifecycleTarget(),
      send: () => calls.push('send'),
    });

    controller.start('editor');

    expect(calls).toEqual(['privacy']);
  });

  it('does not install observers for local, untagged, disabled, or unsampled builds', () => {
    const installObservers = vi.fn(() => ({
      snapshot: () => sample('editor'),
      disconnect: () => undefined,
    }));
    const controller = createFieldSamplingController({
      privacySignal: () => false,
      eligibleBuild: () => false,
      sampled: () => true,
      installObservers,
      lifecycle: new LifecycleTarget(),
      send: () => undefined,
    });

    controller.start('editor');

    expect(installObservers).not.toHaveBeenCalled();
  });

  it('sends once on the first hidden or pagehide boundary', () => {
    const lifecycle = new LifecycleTarget();
    const disconnect = vi.fn();
    const send = vi.fn();
    const controller = createFieldSamplingController({
      privacySignal: () => false,
      eligibleBuild: () => true,
      sampled: () => true,
      installObservers: (surface) => ({ snapshot: () => sample(surface), disconnect }),
      lifecycle,
      send,
    });

    controller.start('share');
    lifecycle.dispatchEvent(new Event('visibilitychange'));
    expect(send).not.toHaveBeenCalled();

    lifecycle.visibilityState = 'hidden';
    lifecycle.dispatchEvent(new Event('visibilitychange'));
    lifecycle.dispatchEvent(new Event('pagehide'));
    controller.start('editor');

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(sample('share'));
  });

  it('snapshots queued performance entries before disconnecting observers', () => {
    const lifecycle = new LifecycleTarget();
    const calls: string[] = [];
    const controller = createFieldSamplingController({
      privacySignal: () => false,
      eligibleBuild: () => true,
      sampled: () => true,
      installObservers: () => ({
        snapshot: () => {
          calls.push('snapshot');
          return sample('editor');
        },
        disconnect: () => calls.push('disconnect'),
      }),
      lifecycle,
      send: () => calls.push('send'),
    });

    controller.start('editor');
    lifecycle.dispatchEvent(new Event('pagehide'));

    expect(calls).toEqual(['snapshot', 'disconnect', 'send']);
  });

  it('sends immediately if the selected client finishes loading after the page became hidden', () => {
    const lifecycle = new LifecycleTarget();
    lifecycle.visibilityState = 'hidden';
    const send = vi.fn();
    const controller = createFieldSamplingController({
      privacySignal: () => false,
      eligibleBuild: () => true,
      sampled: () => true,
      installObservers: (surface) => ({
        snapshot: () => sample(surface),
        disconnect: () => undefined,
      }),
      lifecycle,
      send,
    });

    controller.start('editor');

    expect(send).toHaveBeenCalledOnce();
  });

  it('does not send if a privacy signal appears before the lifecycle boundary', () => {
    const lifecycle = new LifecycleTarget();
    let privacy = false;
    const send = vi.fn();
    const controller = createFieldSamplingController({
      privacySignal: () => privacy,
      eligibleBuild: () => true,
      sampled: () => true,
      installObservers: (surface) => ({
        snapshot: () => sample(surface),
        disconnect: () => undefined,
      }),
      lifecycle,
      send,
    });

    controller.start('embed');
    privacy = true;
    lifecycle.dispatchEvent(new Event('pagehide'));

    expect(send).not.toHaveBeenCalled();
  });

  it('keeps observation failures silent at the lifecycle boundary', () => {
    const lifecycle = new LifecycleTarget();
    const controller = createFieldSamplingController({
      privacySignal: () => false,
      eligibleBuild: () => true,
      sampled: () => true,
      installObservers: () => ({
        snapshot: () => {
          throw new DOMException('restricted');
        },
        disconnect: () => undefined,
      }),
      lifecycle,
      send: () => undefined,
    });

    controller.start('editor');

    expect(() => lifecycle.dispatchEvent(new Event('pagehide'))).not.toThrow();
  });
});

describe('field sample bootstrap', () => {
  it('loads the observer client only after privacy, release, origin, and sampling gates pass', async () => {
    const calls: string[] = [];
    const bootstrap = createFieldSamplingBootstrap({
      privacySignal: () => {
        calls.push('privacy');
        return false;
      },
      eligibleBuild: () => {
        calls.push('build');
        return true;
      },
      sampled: () => {
        calls.push('sample');
        return true;
      },
      loadClient: (surface) => {
        calls.push(`client:${surface}`);
        return Promise.resolve();
      },
    });

    bootstrap.start('embed');
    await vi.waitFor(() => expect(calls).toEqual(['privacy', 'build', 'sample', 'client:embed']));
  });

  it.each([
    ['privacy', true, true, true],
    ['build', false, false, true],
    ['sampling', false, true, false],
  ])(
    'does not fetch the observer client when the %s gate denies',
    async (_name, privacy, build, sampled) => {
      const loadClient = vi.fn<() => Promise<void>>(() => Promise.resolve());
      const bootstrap = createFieldSamplingBootstrap({
        privacySignal: () => privacy,
        eligibleBuild: () => build,
        sampled: () => sampled,
        loadClient,
      });

      bootstrap.start('editor');
      await Promise.resolve();

      expect(loadClient).not.toHaveBeenCalled();
    },
  );

  it('does not let a restricted random source interrupt app startup', () => {
    const loadClient = vi.fn<() => Promise<void>>(() => Promise.resolve());
    const bootstrap = createFieldSamplingBootstrap({
      privacySignal: () => false,
      eligibleBuild: () => true,
      sampled: () => {
        throw new DOMException('restricted');
      },
      loadClient,
    });

    expect(() => bootstrap.start('editor')).not.toThrow();
    expect(loadClient).not.toHaveBeenCalled();
  });
});
