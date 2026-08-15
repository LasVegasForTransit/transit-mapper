import {
  createNetworkByteLedger,
  type NetworkByteLedger,
  type PerfNetworkByteReport,
} from './network-byte-ledger';
import type {
  CreateNetworkByteReportOptions,
  PerfNetworkIdleOptions,
  PerfNetworkTarget,
  PerfNetworkWindowOptions,
} from '../../src/perf/network-byte-types';

export interface FlatCdpMessage {
  method: string;
  params: Record<string, unknown>;
  sessionId?: string;
}

export type FlatCdpMessageListener = (message: FlatCdpMessage) => void;

/** A browser-endpoint CDP connection that preserves flat session envelopes. */
export interface FlatCdpConnectionLike {
  send(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
  ): Promise<Record<string, unknown>>;
  onMessage(listener: FlatCdpMessageListener): void;
  offMessage(listener: FlatCdpMessageListener): void;
  close(): Promise<void>;
}

interface CreateCdpNetworkRecorderOptions {
  connection: FlatCdpConnectionLike;
  pageTargetId: string;
  applicationOrigin: string;
}

export interface CdpNetworkRecorder {
  start(): Promise<void>;
  flush(): Promise<void>;
  waitForContractRequests(options: WaitForContractRequestsOptions): Promise<void>;
  networkIdleAt(options: PerfNetworkIdleOptions): number | null;
  createReport(options: CreateNetworkByteReportOptions): PerfNetworkByteReport;
  stop(): Promise<void>;
}

interface WaitForContractRequestsOptions extends PerfNetworkWindowOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
}

interface TargetInfo {
  targetId?: unknown;
  type?: unknown;
}

interface AttachedToTarget {
  sessionId?: unknown;
  targetInfo?: TargetInfo;
  waitingForDebugger?: unknown;
}

interface DetachedFromTarget {
  sessionId?: unknown;
}

interface AttachedSession {
  targetId: string;
  target: PerfNetworkTarget | null;
}

const TARGET_FILTER = [
  { type: 'page', exclude: false },
  { type: 'iframe', exclude: false },
  { type: 'worker', exclude: false },
  { type: 'service_worker', exclude: false },
  { exclude: true },
];

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function networkTarget(type: unknown): PerfNetworkTarget | null {
  if (type === 'page') return 'page';
  if (type === 'iframe') return 'iframe';
  if (type === 'worker') return 'dedicated-worker';
  if (type === 'service_worker') return 'service-worker';
  return null;
}

class MultiTargetCdpNetworkRecorder implements CdpNetworkRecorder {
  private readonly ledger: NetworkByteLedger;
  private readonly sessions = new Map<string, AttachedSession>();
  private readonly pending = new Set<Promise<void>>();
  private readonly errors: unknown[] = [];
  private started = false;

  private readonly messageListener: FlatCdpMessageListener = (message) => {
    if (message.method === 'Target.attachedToTarget') {
      this.schedule(this.handleAttached(message.params));
      return;
    }
    if (message.method === 'Target.detachedFromTarget') {
      const detached = message.params as DetachedFromTarget;
      this.sessions.delete(stringValue(detached.sessionId));
      return;
    }
    if (!message.method.startsWith('Network.') || !message.sessionId) return;
    const attached = this.sessions.get(message.sessionId);
    if (attached?.target) {
      this.ledger.record(attached.targetId, message.method, message.params);
    }
  };

  constructor(private readonly options: CreateCdpNetworkRecorderOptions) {
    this.ledger = createNetworkByteLedger({
      applicationOrigin: options.applicationOrigin,
    });
  }

  private schedule(task: Promise<void>): void {
    const tracked = task
      .catch((error: unknown) => {
        this.errors.push(error);
      })
      .finally(() => this.pending.delete(tracked));
    this.pending.add(tracked);
  }

  private async configureSession(sessionId: string, waiting: boolean): Promise<void> {
    const attached = this.sessions.get(sessionId);
    if (!attached) return;
    if (attached.target) {
      this.ledger.registerTarget(attached.targetId, attached.target);
      await this.options.connection.send('Network.enable', {}, sessionId);
    }
    // autoAttachRelated covers the measured page and its immediate children.
    // Recurse from child targets so iframe-created and Worker-created Workers
    // cannot escape the byte ledger.
    if (attached.target && attached.target !== 'page') {
      await this.options.connection.send(
        'Target.setAutoAttach',
        {
          autoAttach: true,
          waitForDebuggerOnStart: true,
          flatten: true,
          filter: TARGET_FILTER,
        },
        sessionId,
      );
    }
    if (waiting) {
      await this.options.connection.send('Runtime.runIfWaitingForDebugger', {}, sessionId);
    }
  }

  private async handleAttached(raw: Record<string, unknown>): Promise<void> {
    const attached = raw as AttachedToTarget;
    const sessionId = stringValue(attached.sessionId);
    const targetId = stringValue(attached.targetInfo?.targetId);
    if (!sessionId || !targetId) return;
    const target = networkTarget(attached.targetInfo?.type);
    // Chrome emits parent-target lifecycle events before a dedicated Worker or
    // OOPIF owns its load. Those events have no loadingFinished counterpart;
    // the attached target owns the actual fetch and must not hold the wire-byte
    // contract open.
    if (target === 'dedicated-worker') this.ledger.excludeTargetBootstrapRequest(targetId);
    if (target === 'iframe') this.ledger.excludeIframeNavigationRequest(targetId);
    this.sessions.set(sessionId, {
      targetId,
      target,
    });
    await this.configureSession(sessionId, attached.waitingForDebugger === true);
  }

  private throwRecordedError(): void {
    const error = this.errors.shift();
    if (!error) return;
    throw error instanceof Error
      ? error
      : new Error('A CDP target could not be configured.', { cause: error });
  }

  private async drainScheduledTasks(): Promise<void> {
    while (this.pending.size > 0) await Promise.all([...this.pending]);
    this.throwRecordedError();
  }

  private async protocolBarrier(): Promise<void> {
    for (;;) {
      await this.drainScheduledTasks();
      const before = [...this.sessions.keys()].sort();
      await Promise.all(
        before.map((sessionId) =>
          this.options.connection.send(
            'Runtime.evaluate',
            { expression: 'void 0', returnByValue: true },
            sessionId,
          ),
        ),
      );
      await this.options.connection.send('Target.getTargetInfo');
      await this.drainScheduledTasks();
      const after = [...this.sessions.keys()].sort();
      if (before.length === after.length && before.every((id, index) => id === after[index])) {
        return;
      }
    }
  }

  async start(): Promise<void> {
    if (this.started) throw new Error('The CDP network recorder has already started.');
    if (!this.options.pageTargetId) {
      throw new Error('Chrome did not expose the measured page target.');
    }
    this.options.connection.onMessage(this.messageListener);
    this.started = true;
    await this.options.connection.send('Target.autoAttachRelated', {
      targetId: this.options.pageTargetId,
      waitForDebuggerOnStart: true,
      filter: TARGET_FILTER,
    });
    await this.flush();
  }

  async flush(): Promise<void> {
    await this.protocolBarrier();
  }

  async waitForContractRequests(options: WaitForContractRequestsOptions): Promise<void> {
    const timeoutMs = options.timeoutMs ?? 30_000;
    const pollIntervalMs = options.pollIntervalMs ?? 50;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      await this.flush();
      if (this.ledger.pendingContractRequestCount(options) === 0) return;
      if (Date.now() >= deadline) {
        const unfinished = this.ledger
          .pendingContractRequestDescriptions(options)
          .slice(0, 8)
          .join(', ');
        const detail = unfinished ? `: ${unfinished}` : '.';
        throw new Error(
          `Automatic first-session requests did not finish within ${timeoutMs} ms${detail}`,
        );
      }
      await new Promise<void>((resolvePromise) => {
        setTimeout(resolvePromise, pollIntervalMs);
      });
    }
  }

  createReport(options: CreateNetworkByteReportOptions): PerfNetworkByteReport {
    if (!this.started) throw new Error('The CDP network recorder has not started.');
    return this.ledger.createReport(options);
  }

  networkIdleAt(options: PerfNetworkIdleOptions): number | null {
    if (!this.started) throw new Error('The CDP network recorder has not started.');
    return this.ledger.networkIdleAt(options);
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    await this.flush();
    this.options.connection.offMessage(this.messageListener);
    await this.options.connection.send('Target.setAutoAttach', {
      autoAttach: false,
      waitForDebuggerOnStart: false,
      flatten: true,
    });
    await this.options.connection.close();
    this.started = false;
  }
}

export function createCdpNetworkRecorder(
  options: CreateCdpNetworkRecorderOptions,
): CdpNetworkRecorder {
  return new MultiTargetCdpNetworkRecorder(options);
}
