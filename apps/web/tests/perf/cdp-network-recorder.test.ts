import { describe, expect, it } from 'vitest';
import {
  createCdpNetworkRecorder,
  type FlatCdpConnectionLike,
  type FlatCdpMessage,
  type FlatCdpMessageListener,
} from '../../scripts/perf/cdp-network-recorder';

interface SentCommand {
  method: string;
  params?: Record<string, unknown>;
  sessionId?: string;
}

class FakeFlatCdpConnection implements FlatCdpConnectionLike {
  readonly commands: SentCommand[] = [];
  failNextMethod: string | null = null;
  beforeResolve: ((command: SentCommand) => void) | null = null;
  closed = false;
  private readonly listeners = new Set<FlatCdpMessageListener>();

  send(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
  ): Promise<Record<string, unknown>> {
    const command = { method, params, sessionId };
    this.commands.push(command);
    if (this.failNextMethod === method) {
      this.failNextMethod = null;
      return Promise.reject(new Error(`${method} rejected`));
    }
    if (method === 'Target.autoAttachRelated') {
      this.emitMessage('Target.attachedToTarget', {
        sessionId: 'page-session',
        targetInfo: { targetId: params?.targetId, type: 'page' },
        waitingForDebugger: true,
      });
    }
    this.beforeResolve?.(command);
    return Promise.resolve({});
  }

  emitMessage(method: string, params: Record<string, unknown>, sessionId?: string): void {
    const message: FlatCdpMessage = { method, params, sessionId };
    for (const listener of this.listeners) listener(message);
  }

  onMessage(listener: FlatCdpMessageListener): void {
    this.listeners.add(listener);
  }

  offMessage(listener: FlatCdpMessageListener): void {
    this.listeners.delete(listener);
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}

function requestParams(url: string, requestId: string): Record<string, unknown> {
  return {
    requestId,
    timestamp: 10,
    wallTime: 1_000,
    type: 'Script',
    request: { url },
    initiator: { type: 'script' },
    hasUserGesture: false,
  };
}

interface FinishedRequestOptions {
  sessionId: string;
  url: string;
  requestId: string;
  encodedBytes?: number;
}

function finishRequest(connection: FakeFlatCdpConnection, options: FinishedRequestOptions): void {
  const encodedBytes = options.encodedBytes ?? 25;
  connection.emitMessage(
    'Network.requestWillBeSent',
    requestParams(options.url, options.requestId),
    options.sessionId,
  );
  connection.emitMessage(
    'Network.responseReceived',
    {
      requestId: options.requestId,
      timestamp: 10.01,
      type: 'Script',
      response: {
        url: options.url,
        mimeType: 'text/javascript',
        protocol: 'h2',
        headers: {},
      },
    },
    options.sessionId,
  );
  connection.emitMessage(
    'Network.loadingFinished',
    { requestId: options.requestId, timestamp: 10.02, encodedDataLength: encodedBytes },
    options.sessionId,
  );
}

function createRecorder(connection: FakeFlatCdpConnection) {
  return createCdpNetworkRecorder({
    connection,
    pageTargetId: 'page-target',
    applicationOrigin: 'https://app.test',
  });
}

function methodsForSession(connection: FakeFlatCdpConnection, sessionId: string): string[] {
  return connection.commands
    .filter((command) => command.sessionId === sessionId)
    .map((command) => command.method);
}

describe('the multi-target CDP network recorder', () => {
  it('configures auto-attached targets through flat CDP session envelopes', async () => {
    const connection = new FakeFlatCdpConnection();
    const recorder = createRecorder(connection);

    await recorder.start();

    expect(methodsForSession(connection, 'page-session')).toContain('Network.enable');
    expect(
      connection.commands.some((command) => command.method === 'Target.sendMessageToTarget'),
    ).toBe(false);
    await recorder.stop();
    expect(connection.commands.at(-1)).toEqual({
      method: 'Target.setAutoAttach',
      params: {
        autoAttach: false,
        waitForDebuggerOnStart: false,
        flatten: true,
      },
      sessionId: undefined,
    });
    expect(connection.closed).toBe(true);
  });

  it('captures the page, iframe, dedicated Worker, and service Worker targets', async () => {
    const connection = new FakeFlatCdpConnection();
    const recorder = createRecorder(connection);
    await recorder.start();

    const directTargets = [
      ['iframe-session', 'iframe-target', 'iframe'],
      ['worker-session', 'worker-target', 'worker'],
      ['sw-session', 'sw-target', 'service_worker'],
    ] as const;
    for (const [sessionId, targetId, type] of directTargets) {
      connection.emitMessage('Target.attachedToTarget', {
        sessionId,
        targetInfo: { targetId, type },
        waitingForDebugger: true,
      });
    }
    await recorder.flush();

    finishRequest(connection, {
      sessionId: 'page-session',
      url: 'https://app.test/index.html',
      requestId: 'page',
    });
    finishRequest(connection, {
      sessionId: 'iframe-session',
      url: 'https://app.test/embed.js',
      requestId: 'iframe',
    });
    finishRequest(connection, {
      sessionId: 'worker-session',
      url: 'https://app.test/worker.js',
      requestId: 'worker',
    });
    finishRequest(connection, {
      sessionId: 'sw-session',
      url: 'https://app.test/lazy.js',
      requestId: 'sw',
    });

    const report = recorder.createReport({
      navigationTimeOriginMs: 1_000_000,
      automaticBoundaryMs: 60_000,
      phases: {},
    });
    expect(report.requests.map((request) => request.target)).toEqual([
      'page',
      'iframe',
      'dedicated-worker',
      'service-worker',
    ]);
    expect(report.total.total.encodedBytes).toBe(100);
    await recorder.stop();
  });

  it('recursively captures a Worker created inside an iframe', async () => {
    const connection = new FakeFlatCdpConnection();
    const recorder = createRecorder(connection);
    await recorder.start();
    connection.emitMessage('Target.attachedToTarget', {
      sessionId: 'iframe-session',
      targetInfo: { targetId: 'iframe-target', type: 'iframe' },
      waitingForDebugger: true,
    });
    await recorder.flush();

    connection.emitMessage(
      'Target.attachedToTarget',
      {
        sessionId: 'child-session',
        targetInfo: { targetId: 'child-worker', type: 'worker' },
        waitingForDebugger: true,
      },
      'iframe-session',
    );
    await recorder.flush();
    finishRequest(connection, {
      sessionId: 'child-session',
      url: 'https://app.test/nested-worker.js',
      requestId: 'nested',
      encodedBytes: 33,
    });

    expect(
      recorder.createReport({
        navigationTimeOriginMs: 1_000_000,
        automaticBoundaryMs: 60_000,
        phases: {},
      }).requests,
    ).toEqual([
      expect.objectContaining({
        url: 'https://app.test/nested-worker.js',
        target: 'dedicated-worker',
        encodedBytes: 33,
      }),
    ]);
    expect(methodsForSession(connection, 'iframe-session')).toContain('Target.setAutoAttach');
    expect(
      connection.commands.find(
        (command) =>
          command.sessionId === 'iframe-session' && command.method === 'Target.setAutoAttach',
      )?.params?.flatten,
    ).toBe(true);
    await recorder.stop();
  });

  it('excludes a parent target lifecycle event when that request becomes a Worker target', async () => {
    const connection = new FakeFlatCdpConnection();
    const recorder = createRecorder(connection);
    await recorder.start();
    finishRequest(connection, {
      sessionId: 'page-session',
      url: 'https://app.test/index.html',
      requestId: 'document',
    });
    connection.emitMessage(
      'Network.requestWillBeSent',
      requestParams('https://app.test/assets/storage-worker.js', 'worker-target'),
      'page-session',
    );
    connection.emitMessage('Target.attachedToTarget', {
      sessionId: 'worker-session',
      targetInfo: { targetId: 'worker-target', type: 'worker' },
      waitingForDebugger: true,
    });
    await recorder.flush();

    expect(
      recorder.createReport({
        navigationTimeOriginMs: 1_000_000,
        automaticBoundaryMs: 60_000,
        phases: {},
      }).requests,
    ).toEqual([
      expect.objectContaining({
        url: 'https://app.test/index.html',
        encodedBytes: 25,
      }),
    ]);
    await recorder.stop();
  });

  it('uses a protocol barrier before deciding no contract request is pending', async () => {
    const connection = new FakeFlatCdpConnection();
    const recorder = createRecorder(connection);
    await recorder.start();
    let injected = false;
    connection.beforeResolve = (command) => {
      if (injected || command.method !== 'Runtime.evaluate') return;
      injected = true;
      connection.emitMessage(
        'Network.requestWillBeSent',
        requestParams('https://app.test/pending.js', 'pending'),
        'page-session',
      );
      setTimeout(() => {
        connection.emitMessage(
          'Network.loadingFinished',
          { requestId: 'pending', timestamp: 10.05, encodedDataLength: 20 },
          'page-session',
        );
      }, 0);
    };

    await recorder.waitForContractRequests({
      navigationTimeOriginMs: 1_000_000,
      automaticBoundaryMs: 60_000,
      timeoutMs: 1_000,
      pollIntervalMs: 1,
    });
    expect(
      recorder.createReport({
        navigationTimeOriginMs: 1_000_000,
        automaticBoundaryMs: 60_000,
        phases: {},
      }).total.total.encodedBytes,
    ).toBe(20);
    await recorder.stop();
  });

  it('names unfinished automatic requests when the contract wait times out', async () => {
    const connection = new FakeFlatCdpConnection();
    const recorder = createRecorder(connection);
    await recorder.start();
    connection.emitMessage(
      'Network.requestWillBeSent',
      requestParams('https://app.test/assets/never-finishes.js', 'unfinished'),
      'page-session',
    );

    await expect(
      recorder.waitForContractRequests({
        navigationTimeOriginMs: 1_000_000,
        automaticBoundaryMs: 60_000,
        timeoutMs: 0,
      }),
    ).rejects.toThrow('https://app.test/assets/never-finishes.js');
    await recorder.stop();
  });

  it('fails closed when Network.enable is rejected inside an attached target', async () => {
    const connection = new FakeFlatCdpConnection();
    const recorder = createRecorder(connection);
    await recorder.start();
    connection.failNextMethod = 'Network.enable';
    connection.emitMessage('Target.attachedToTarget', {
      sessionId: 'iframe-session',
      targetInfo: { targetId: 'iframe-target', type: 'iframe' },
      waitingForDebugger: true,
    });

    await expect(recorder.flush()).rejects.toThrow('Network.enable rejected');
  });
});
