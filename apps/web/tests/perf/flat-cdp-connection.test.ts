import { describe, expect, it } from 'vitest';
import {
  chromeDebuggingArgument,
  createFlatCdpConnectionForSocket,
  type CdpWebSocketLike,
} from '../../scripts/perf/flat-cdp-connection';

class FakeWebSocket implements CdpWebSocketLike {
  readonly sent: string[] = [];
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>();

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.emit('close', {});
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  emitMessage(message: Record<string, unknown>): void {
    this.emit('message', { data: JSON.stringify(message) });
  }

  private emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

describe('the flat browser CDP connection', () => {
  it('routes commands and responses through the top-level session id', async () => {
    const socket = new FakeWebSocket();
    const connection = createFlatCdpConnectionForSocket(socket);

    const response = connection.send('Network.enable', {}, 'worker-session');
    const sent = JSON.parse(socket.sent[0] ?? '') as Record<string, unknown>;
    expect(sent).toEqual({
      id: 1,
      method: 'Network.enable',
      params: {},
      sessionId: 'worker-session',
    });
    socket.emitMessage({ id: 1, sessionId: 'worker-session', result: { enabled: true } });

    await expect(response).resolves.toEqual({ enabled: true });
  });

  it('preserves the session id on child-target events', () => {
    const socket = new FakeWebSocket();
    const connection = createFlatCdpConnectionForSocket(socket);
    const received: unknown[] = [];
    connection.onMessage((message) => received.push(message));

    socket.emitMessage({
      sessionId: 'iframe-session',
      method: 'Network.loadingFinished',
      params: { requestId: 'request-1', encodedDataLength: 42 },
    });

    expect(received).toEqual([
      {
        sessionId: 'iframe-session',
        method: 'Network.loadingFinished',
        params: { requestId: 'request-1', encodedDataLength: 42 },
      },
    ]);
  });

  it('rejects the matching command when Chrome returns a protocol error', async () => {
    const socket = new FakeWebSocket();
    const connection = createFlatCdpConnectionForSocket(socket);
    const response = connection.send('Network.enable', {}, 'worker-session');
    socket.emitMessage({ id: 1, error: { message: 'Network.enable rejected' } });

    await expect(response).rejects.toThrow('Network.enable rejected');
  });

  it('uses an explicit loopback debugging port for the raw byte authority', () => {
    expect(chromeDebuggingArgument(42_391)).toBe('--remote-debugging-port=42391');
    expect(() => chromeDebuggingArgument(0)).toThrow('valid TCP port');
  });
});
