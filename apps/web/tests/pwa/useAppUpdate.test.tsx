// @vitest-environment jsdom

import { StrictMode, type ReactNode } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useAppUpdate,
  type AppUpdate,
  type AppUpdateOptions,
} from '@transitmapper/pwa-updater/useAppUpdate';

class FakeServiceWorker extends EventTarget {
  state: ServiceWorkerState = 'installing';
  readonly postMessage = vi.fn();

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
  readonly register =
    vi.fn<
      (scriptUrl: string | URL, options?: RegistrationOptions) => Promise<ServiceWorkerRegistration>
    >();
}

interface HookHostProps {
  flush: () => void | Promise<void>;
  onResult: (result: AppUpdate) => void;
  options?: AppUpdateOptions;
}

function HookHost({ flush, onResult, options }: HookHostProps) {
  onResult(useAppUpdate(flush, options));
  return null;
}

interface StrictHookProps extends HookHostProps {
  children?: ReactNode;
}

function StrictHook({ children, ...props }: StrictHookProps) {
  return (
    <StrictMode>
      <HookHost {...props} />
      {children}
    </StrictMode>
  );
}

interface RenderProbeProps {
  record: () => void;
}

function RenderProbe({ record }: RenderProbeProps) {
  record();
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
  serviceWorkers.register.mockResolvedValue(registration as unknown as ServiceWorkerRegistration);
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
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('editor service-worker update lifecycle', () => {
  it('registers natively once after a Strict Mode commit', async () => {
    const renderPhaseCallCounts: number[] = [];
    await act(async () => {
      root.render(
        <StrictHook flush={() => undefined} onResult={() => undefined}>
          <RenderProbe
            record={() => renderPhaseCallCounts.push(serviceWorkers.register.mock.calls.length)}
          />
        </StrictHook>,
      );
      await Promise.resolve();
    });

    expect(renderPhaseCallCounts).toEqual([0, 0]);
    expect(serviceWorkers.register).toHaveBeenCalledOnce();
    expect(serviceWorkers.register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
  });

  it('uses the latest callback when the first offline install completes', async () => {
    const first = vi.fn();
    const latest = vi.fn();
    const serviceWorkerReady = vi.fn();

    await act(async () => {
      root.render(
        <StrictHook
          flush={() => undefined}
          onResult={() => undefined}
          options={{ onOfflineReady: first }}
        />,
      );
      await Promise.resolve();
    });
    await act(async () => {
      root.render(
        <StrictHook
          flush={() => undefined}
          onResult={() => undefined}
          options={{ onOfflineReady: latest, onServiceWorkerReady: serviceWorkerReady }}
        />,
      );
      await Promise.resolve();
    });

    const worker = new FakeServiceWorker();
    registration.installing = worker as unknown as ServiceWorker;
    act(() => {
      registration.dispatchEvent(new Event('updatefound'));
      worker.install();
    });

    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledOnce();
    expect(serviceWorkerReady).toHaveBeenCalledOnce();
    expect(serviceWorkers.register).toHaveBeenCalledOnce();
  });

  it('reports an existing active worker as ready without repeating the install notice', async () => {
    const onOfflineReady = vi.fn();
    const onServiceWorkerReady = vi.fn();
    registration.active = new FakeServiceWorker() as unknown as ServiceWorker;

    await act(async () => {
      root.render(
        <StrictHook
          flush={() => undefined}
          onResult={() => undefined}
          options={{ onOfflineReady, onServiceWorkerReady }}
        />,
      );
      await Promise.resolve();
    });

    expect(onServiceWorkerReady).toHaveBeenCalledOnce();
    expect(onOfflineReady).not.toHaveBeenCalled();
  });

  it('does not register a public surface', async () => {
    await act(async () => {
      root.render(
        <StrictHook
          flush={() => undefined}
          onResult={() => undefined}
          options={{ enabled: false }}
        />,
      );
      await Promise.resolve();
    });

    expect(serviceWorkers.register).not.toHaveBeenCalled();
  });

  it('flushes with the latest callback before activating a waiting worker', async () => {
    const first = vi.fn(() => Promise.resolve());
    const latest = vi.fn(() => Promise.resolve());
    const waiting = new FakeServiceWorker();
    waiting.state = 'installed';
    registration.waiting = waiting as unknown as ServiceWorker;
    let result: AppUpdate | undefined;
    const onResult = (next: AppUpdate) => {
      result = next;
    };

    await act(async () => {
      root.render(<StrictHook flush={first} onResult={onResult} />);
      await Promise.resolve();
    });
    await act(async () => {
      root.render(<StrictHook flush={latest} onResult={onResult} />);
      await Promise.resolve();
    });
    await act(async () => result?.reload());

    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledOnce();
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(result?.needRefresh).toBe(true);
  });

  it('recognizes an installed update as needing a refresh', async () => {
    let result: AppUpdate | undefined;
    serviceWorkers.controller = new FakeServiceWorker() as unknown as ServiceWorker;
    registration.active = serviceWorkers.controller;

    await act(async () => {
      root.render(
        <StrictHook
          flush={() => undefined}
          onResult={(next) => {
            result = next;
          }}
        />,
      );
      await Promise.resolve();
    });
    const worker = new FakeServiceWorker();
    registration.installing = worker as unknown as ServiceWorker;
    act(() => {
      registration.dispatchEvent(new Event('updatefound'));
      worker.install();
    });

    expect(result?.needRefresh).toBe(true);
  });

  it('classifies a later install as an update even while the tab remains uncontrolled', async () => {
    let result: AppUpdate | undefined;
    const offlineReady = vi.fn();
    await act(async () => {
      root.render(
        <StrictHook
          flush={() => undefined}
          onResult={(next) => {
            result = next;
          }}
          options={{ onOfflineReady: offlineReady }}
        />,
      );
      await Promise.resolve();
    });

    const initialWorker = new FakeServiceWorker();
    registration.installing = initialWorker as unknown as ServiceWorker;
    act(() => {
      registration.dispatchEvent(new Event('updatefound'));
      initialWorker.install();
    });
    registration.active = initialWorker as unknown as ServiceWorker;
    registration.installing = null;

    const updateWorker = new FakeServiceWorker();
    registration.installing = updateWorker as unknown as ServiceWorker;
    act(() => {
      registration.dispatchEvent(new Event('updatefound'));
      updateWorker.install();
    });

    expect(serviceWorkers.controller).toBeNull();
    expect(offlineReady).toHaveBeenCalledOnce();
    expect(result?.needRefresh).toBe(true);
  });

  it('flushes and reloads when another tab activates the waiting update', async () => {
    let finishFlush: (() => void) | undefined;
    const flush = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishFlush = resolve;
        }),
    );
    const waiting = new FakeServiceWorker();
    waiting.state = 'installed';
    registration.active = new FakeServiceWorker() as unknown as ServiceWorker;
    registration.waiting = waiting as unknown as ServiceWorker;

    await act(async () => {
      root.render(<StrictHook flush={flush} onResult={() => undefined} />);
      await Promise.resolve();
    });
    registration.waiting = null;
    act(() => {
      serviceWorkers.dispatchEvent(new Event('controllerchange'));
    });
    await Promise.resolve();

    expect(flush).toHaveBeenCalledOnce();
    expect(finishFlush).toBeTypeOf('function');
  });

  it('stops update polling when registration is disabled', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });

    await act(async () => {
      root.render(<StrictHook flush={() => undefined} onResult={() => undefined} />);
      await Promise.resolve();
    });
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(registration.update).toHaveBeenCalledOnce();

    await act(async () => {
      root.render(
        <StrictHook
          flush={() => undefined}
          onResult={() => undefined}
          options={{ enabled: false }}
        />,
      );
      await Promise.resolve();
    });
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

    expect(registration.update).toHaveBeenCalledOnce();
  });

  it('runs a deferred update check when a hidden tab becomes visible', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => {
      root.render(<StrictHook flush={() => undefined} onResult={() => undefined} />);
      await Promise.resolve();
    });

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(registration.update).not.toHaveBeenCalled();

    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    expect(registration.update).toHaveBeenCalledOnce();
  });

  it('handles a rejected background update check', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const error = new Error('Update check rejected.');
    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    registration.update.mockRejectedValue(error);
    await act(async () => {
      root.render(<StrictHook flush={() => undefined} onResult={() => undefined} />);
      await Promise.resolve();
    });

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

    expect(report).toHaveBeenCalledWith('[transitmapper] service worker update failed', error);
  });

  it('registers when a previously disabled startup surface becomes enabled', async () => {
    await act(async () => {
      root.render(
        <StrictHook
          flush={() => undefined}
          onResult={() => undefined}
          options={{ enabled: false }}
        />,
      );
      await Promise.resolve();
    });
    await act(async () => {
      root.render(<StrictHook flush={() => undefined} onResult={() => undefined} />);
      await Promise.resolve();
    });

    expect(serviceWorkers.register).toHaveBeenCalledOnce();
  });

  it('keeps rendering when service workers are unavailable', async () => {
    Reflect.deleteProperty(navigator, 'serviceWorker');

    await act(async () => {
      root.render(<StrictHook flush={() => undefined} onResult={() => undefined} />);
      await Promise.resolve();
    });

    expect(serviceWorkers.register).not.toHaveBeenCalled();
  });

  it('reports native registration failures without failing the app', async () => {
    const error = new Error('Registration rejected.');
    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    serviceWorkers.register.mockRejectedValue(error);

    await act(async () => {
      root.render(<StrictHook flush={() => undefined} onResult={() => undefined} />);
      await Promise.resolve();
    });

    expect(report).toHaveBeenCalledWith(
      '[transitmapper] service worker registration failed',
      error,
    );
  });
});
