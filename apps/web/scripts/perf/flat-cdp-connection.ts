import { createServer } from 'node:net';
import type {
  FlatCdpConnectionLike,
  FlatCdpMessage,
  FlatCdpMessageListener,
} from './cdp-network-recorder';

type WebSocketEventListener = (event: unknown) => void;

export interface CdpWebSocketLike {
  send(data: string): void;
  close(): void;
  addEventListener(type: string, listener: WebSocketEventListener): void;
  removeEventListener(type: string, listener: WebSocketEventListener): void;
}

interface ProtocolEnvelope {
  id?: unknown;
  method?: unknown;
  params?: unknown;
  sessionId?: unknown;
  result?: unknown;
  error?: unknown;
}

interface PendingCommand {
  method: string;
  resolve(result: Record<string, unknown>): void;
  reject(error: Error): void;
}

function recordValue(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function eventData(event: unknown): string {
  return stringValue(recordValue(event).data);
}

class FlatCdpConnection implements FlatCdpConnectionLike {
  private readonly listeners = new Set<FlatCdpMessageListener>();
  private readonly pending = new Map<number, PendingCommand>();
  private nextId = 1;
  private closed = false;

  private readonly socketMessageListener: WebSocketEventListener = (event) => {
    const raw = eventData(event);
    if (!raw) return;
    let envelope: ProtocolEnvelope;
    try {
      envelope = JSON.parse(raw) as ProtocolEnvelope;
    } catch {
      this.fail(new Error('Chrome sent an invalid CDP message.'));
      return;
    }
    if (typeof envelope.id === 'number') {
      this.handleResponse(envelope.id, envelope);
      return;
    }
    const method = stringValue(envelope.method);
    if (!method) return;
    const message: FlatCdpMessage = {
      method,
      params: recordValue(envelope.params),
    };
    const sessionId = stringValue(envelope.sessionId);
    if (sessionId) message.sessionId = sessionId;
    for (const listener of this.listeners) listener(message);
  };

  private readonly socketCloseListener: WebSocketEventListener = () => {
    this.fail(new Error('The Chrome CDP connection closed.'));
  };

  private readonly socketErrorListener: WebSocketEventListener = () => {
    this.fail(new Error('The Chrome CDP connection failed.'));
  };

  constructor(private readonly socket: CdpWebSocketLike) {
    socket.addEventListener('message', this.socketMessageListener);
    socket.addEventListener('close', this.socketCloseListener);
    socket.addEventListener('error', this.socketErrorListener);
  }

  private handleResponse(id: number, envelope: ProtocolEnvelope): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    const error = recordValue(envelope.error);
    if (Object.keys(error).length > 0) {
      const detail = stringValue(error.message) || 'unknown protocol error';
      pending.reject(new Error(`CDP ${pending.method} failed: ${detail}`));
      return;
    }
    pending.resolve(recordValue(envelope.result));
  }

  private fail(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  send(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ): Promise<Record<string, unknown>> {
    if (this.closed) return Promise.reject(new Error('The Chrome CDP connection is closed.'));
    const id = this.nextId++;
    const response = new Promise<Record<string, unknown>>((resolve, reject) => {
      this.pending.set(id, { method, resolve, reject });
    });
    const envelope: Record<string, unknown> = { id, method, params };
    if (sessionId) envelope.sessionId = sessionId;
    try {
      this.socket.send(JSON.stringify(envelope));
    } catch (error) {
      this.pending.delete(id);
      return Promise.reject(
        error instanceof Error ? error : new Error('Chrome rejected a CDP command.'),
      );
    }
    return response;
  }

  onMessage(listener: FlatCdpMessageListener): void {
    this.listeners.add(listener);
  }

  offMessage(listener: FlatCdpMessageListener): void {
    this.listeners.delete(listener);
  }

  close(): Promise<void> {
    if (!this.closed) {
      this.fail(new Error('The Chrome CDP connection was closed by the recorder.'));
      this.socket.close();
    }
    this.socket.removeEventListener('message', this.socketMessageListener);
    this.socket.removeEventListener('close', this.socketCloseListener);
    this.socket.removeEventListener('error', this.socketErrorListener);
    this.listeners.clear();
    return Promise.resolve();
  }
}

export function createFlatCdpConnectionForSocket(socket: CdpWebSocketLike): FlatCdpConnectionLike {
  return new FlatCdpConnection(socket);
}

export function chromeDebuggingArgument(port: number): string {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('Chrome debugging requires a valid TCP port.');
  }
  return `--remote-debugging-port=${port}`;
}

export async function allocateChromeDebuggingPort(): Promise<number> {
  return new Promise<number>((resolvePromise, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close((error) => {
        if (error) reject(error);
        else if (port === null) reject(new Error('Could not allocate a Chrome debugging port.'));
        else resolvePromise(port);
      });
    });
  });
}

async function waitForOpen(socket: WebSocket): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Chrome CDP WebSocket did not open.')),
      10_000,
    );
    socket.addEventListener(
      'open',
      () => {
        clearTimeout(timeout);
        resolvePromise();
      },
      { once: true },
    );
    socket.addEventListener(
      'error',
      () => {
        clearTimeout(timeout);
        reject(new Error('Chrome CDP WebSocket could not be opened.'));
      },
      { once: true },
    );
  });
}

export async function connectChromeFlatCdp(port: number): Promise<FlatCdpConnectionLike> {
  chromeDebuggingArgument(port);
  const response = await fetch(`http://127.0.0.1:${port}/json/version/`, {
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`Chrome CDP discovery failed with HTTP ${response.status}.`);
  }
  const webSocketUrl = stringValue(recordValue(await response.json()).webSocketDebuggerUrl);
  if (!webSocketUrl.startsWith('ws://') && !webSocketUrl.startsWith('wss://')) {
    throw new Error('Chrome CDP discovery did not return a WebSocket endpoint.');
  }
  const socket = new WebSocket(webSocketUrl);
  await waitForOpen(socket);
  return createFlatCdpConnectionForSocket(socket);
}
