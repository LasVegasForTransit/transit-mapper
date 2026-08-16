// @vitest-environment jsdom

import { StrictMode, useEffect } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStartupLifecycle, type StartupLifecycle } from '../../src/perf/startup-lifecycle';
import { STORAGE_READ_START_MARK, markOnce } from '../../src/perf/startup-marks';

const cacheBrowserAdaptiveAssets = vi.hoisted(() =>
  vi.fn(() => Promise.resolve<'complete' | 'deferred'>('complete')),
);

vi.mock('../../src/pwa/adaptive-cache', () => ({ cacheBrowserAdaptiveAssets }));

class FakeServiceWorker extends EventTarget {
  state: ServiceWorkerState = 'installing';

  install(): void {
    this.state = 'installed';
    this.dispatchEvent(new Event('statechange'));
  }
}

class FakeRegistration extends EventTarget {
  active: ServiceWorker | null = null;
  installing: ServiceWorker | null = null;
  waiting: ServiceWorker | null = null;
  readonly update = vi.fn(() => Promise.resolve());
}

class FakeServiceWorkerContainer extends EventTarget {
  controller: ServiceWorker | null = null;
  readonly register = vi.fn(() => Promise.resolve(new FakeRegistration()));
}

interface StartupHostProps {
  documentReady: boolean;
  onResult?: (result: StartupLifecycle) => void;
}

function StartupHost({ documentReady, onResult }: StartupHostProps) {
  const result = useStartupLifecycle(documentReady, () => undefined);
  onResult?.(result);
  return null;
}

function StartupOrderingHost() {
  useEffect(() => markOnce(STORAGE_READ_START_MARK), []);
  useStartupLifecycle(false, () => undefined);
  return null;
}

let container: HTMLDivElement;
let root: Root;
let registration: FakeRegistration;
let serviceWorkers: FakeServiceWorkerContainer;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  registration = new FakeRegistration();
  serviceWorkers = new FakeServiceWorkerContainer();
  serviceWorkers.register.mockResolvedValue(registration);
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: serviceWorkers,
  });
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  act(() => root.unmount());
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  container.remove();
  performance.clearMarks();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('editor startup lifecycle', () => {
  it('marks shell and document commits without registering a public share', async () => {
    vi.stubEnv('PROD', true);
    window.history.replaceState(null, '', '/s/public-share');
    await act(async () => {
      root.render(
        <StrictMode>
          <StartupHost documentReady={false} />
        </StrictMode>,
      );
      await Promise.resolve();
    });
    expect(performance.getEntriesByType('mark').map(({ name }) => name)).toEqual([
      'tm:shell-mounted',
    ]);

    await act(async () => {
      root.render(
        <StrictMode>
          <StartupHost documentReady />
        </StrictMode>,
      );
      await Promise.resolve();
    });
    expect(performance.getEntriesByType('mark').map(({ name }) => name)).toEqual([
      'tm:shell-mounted',
      'tm:system-committed',
    ]);
    expect(serviceWorkers.register).not.toHaveBeenCalled();
  });

  it('marks completion of the editor service-worker install', async () => {
    vi.stubEnv('PROD', true);
    let result: StartupLifecycle | undefined;
    await act(async () => {
      root.render(
        <StrictMode>
          <StartupHost
            documentReady={false}
            onResult={(next) => {
              result = next;
            }}
          />
        </StrictMode>,
      );
      await Promise.resolve();
    });
    const worker = new FakeServiceWorker();
    registration.installing = worker as unknown as ServiceWorker;
    act(() => {
      registration.dispatchEvent(new Event('updatefound'));
      worker.install();
    });

    expect(performance.getEntriesByType('mark').map(({ name }) => name)).toEqual([
      'tm:shell-mounted',
      'tm:service-worker-ready',
    ]);
    expect(result?.offlineReadiness).toBe('essential');
  });

  it('fills the adaptive cache only in an idle returning session', async () => {
    vi.stubEnv('PROD', true);
    let idleCallback: IdleRequestCallback | undefined;
    vi.stubGlobal(
      'requestIdleCallback',
      vi.fn((callback: IdleRequestCallback) => {
        idleCallback = callback;
        return 1;
      }),
    );
    vi.stubGlobal('cancelIdleCallback', vi.fn());
    serviceWorkers.controller = new FakeServiceWorker() as unknown as ServiceWorker;
    registration.active = serviceWorkers.controller;
    let result: StartupLifecycle | undefined;

    await act(async () => {
      root.render(
        <StrictMode>
          <StartupHost
            documentReady={false}
            onResult={(next) => {
              result = next;
            }}
          />
        </StrictMode>,
      );
      await Promise.resolve();
    });

    expect(result?.offlineReadiness).toBe('adaptive-pending');
    expect(cacheBrowserAdaptiveAssets).not.toHaveBeenCalled();
    await act(async () => {
      idleCallback?.({ didTimeout: false, timeRemaining: () => 10 });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(cacheBrowserAdaptiveAssets).toHaveBeenCalledWith(true);
    expect(result?.offlineReadiness).toBe('complete');
  });

  it('marks the committed shell before passive bootstrap storage work', async () => {
    window.history.replaceState(null, '', '/s/public-share');
    await act(async () => {
      root.render(
        <StrictMode>
          <StartupOrderingHost />
        </StrictMode>,
      );
      await Promise.resolve();
    });

    expect(performance.getEntriesByType('mark').map(({ name }) => name)).toEqual([
      'tm:shell-mounted',
      'tm:storage-read-start',
    ]);
  });

  it('does not request a service worker that Vite does not generate in development', async () => {
    vi.stubEnv('PROD', false);
    await act(async () => {
      root.render(
        <StrictMode>
          <StartupHost documentReady={false} />
        </StrictMode>,
      );
      await Promise.resolve();
    });

    expect(serviceWorkers.register).not.toHaveBeenCalled();
  });
});
