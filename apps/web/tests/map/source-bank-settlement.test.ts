import { describe, expect, it, vi } from 'vitest';
import {
  waitForSourceBankLoad,
  waitForSourceBankPaint,
  type SourceBankSettlementHost,
} from '../../src/map/source-bank-settlement';

class SettlementHost implements SourceBankSettlementHost {
  readonly loaded = new Set<string>();
  readonly repaint = vi.fn();
  private readonly sourceListeners = new Set<(sourceId: string) => void>();
  private readonly renderListeners = new Set<() => void>();

  isSourceLoaded = (sourceId: string) => this.loaded.has(sourceId);
  triggerRepaint = () => {
    this.repaint();
  };
  onSourceData = (listener: (sourceId: string) => void) => {
    this.sourceListeners.add(listener);
    return () => {
      this.sourceListeners.delete(listener);
    };
  };
  onRender = (listener: () => void) => {
    this.renderListeners.add(listener);
    return () => {
      this.renderListeners.delete(listener);
    };
  };

  complete(sourceId: string): void {
    this.loaded.add(sourceId);
    for (const listener of [...this.sourceListeners]) listener(sourceId);
  }

  render(): void {
    for (const listener of [...this.renderListeners]) listener();
  }
}

describe('render source bank settlement', () => {
  it('keeps ordinary camera and animation repaint scheduling live during hidden loads', async () => {
    const host = new SettlementHost();
    const loaded = waitForSourceBankLoad({
      host,
      sourceIds: ['ways--bank-b', 'stations--bank-b'],
    });

    host.triggerRepaint();
    host.complete('ways--bank-b');
    host.triggerRepaint();
    expect(host.repaint).toHaveBeenCalledTimes(2);
    let finished = false;
    void loaded.then(() => {
      finished = true;
    });
    await Promise.resolve();
    expect(finished).toBe(false);

    host.complete('stations--bank-b');
    await expect(loaded).resolves.toBeUndefined();
  });

  it('requires post-mutation source data evidence even when a hidden source was already loaded', async () => {
    const host = new SettlementHost();
    host.loaded.add('ways--bank-b');
    const loaded = waitForSourceBankLoad({
      host,
      sourceIds: ['ways--bank-b'],
    });
    let finished = false;
    void loaded.then(() => {
      finished = true;
    });

    await Promise.resolve();
    expect(finished).toBe(false);

    host.complete('ways--bank-b');
    await expect(loaded).resolves.toBeUndefined();
  });

  it('settles the activated revision on the next render despite unrelated animation', async () => {
    const host = new SettlementHost();
    const painted = waitForSourceBankPaint({ host });
    expect(host.repaint).toHaveBeenCalledOnce();

    host.render();

    await expect(painted).resolves.toBeUndefined();
  });

  it('aborts a hidden load without waiting for a missing source', async () => {
    const host = new SettlementHost();
    const abort = new AbortController();
    const loaded = waitForSourceBankLoad({
      host,
      sourceIds: ['missing'],
      signal: abort.signal,
    });
    abort.abort();

    await expect(loaded).rejects.toThrow('aborted');
  });

  it('names the hidden sources that did not settle', async () => {
    const host = new SettlementHost();
    const loaded = waitForSourceBankLoad({
      host,
      sourceIds: ['ways--bank-b', 'stations--bank-b'],
      timeoutMs: 10,
    });

    host.complete('ways--bank-b');

    await expect(loaded).rejects.toThrow('stations--bank-b');
  });
});
