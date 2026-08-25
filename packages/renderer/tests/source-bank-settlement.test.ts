import { describe, expect, it, vi } from 'vitest';
import {
  waitForSourceBankLoad,
  waitForSourceBankPaint,
  type SourceBankSettlementHost,
} from '../src/source-bank-settlement';

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

  sourceData(sourceId: string): void {
    for (const listener of [...this.sourceListeners]) listener(sourceId);
  }

  markLoaded(sourceId: string): void {
    this.loaded.add(sourceId);
  }

  render(): void {
    for (const listener of [...this.renderListeners]) listener();
  }
}

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve = () => {};
  const promise = new Promise<void>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
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
    // The source waiter requests one ordinary follow-up render; it does not
    // suppress camera or animation repaint scheduling while the bank loads.
    expect(host.repaint).toHaveBeenCalledTimes(3);
    let finished = false;
    void loaded.then(() => {
      finished = true;
    });
    await Promise.resolve();
    expect(finished).toBe(false);

    host.complete('stations--bank-b');
    await expect(loaded).resolves.toBeUndefined();
  });

  it('accepts a source MapLibre already reports loaded after its planned mutation', async () => {
    const host = new SettlementHost();
    host.loaded.add('ways--bank-b');
    const loaded = waitForSourceBankLoad({
      host,
      sourceIds: ['ways--bank-b'],
    });
    await expect(loaded).resolves.toBeUndefined();
  });

  it('waits for the frame that marks a changed source loaded', async () => {
    const host = new SettlementHost();
    const loaded = waitForSourceBankLoad({
      host,
      sourceIds: ['ways--bank-b'],
    });

    // MapLibre can announce new GeoJSON data before the following render has
    // finished rebuilding its source cache. The later render is the first
    // point at which `isSourceLoaded` becomes authoritative.
    host.sourceData('ways--bank-b');
    host.markLoaded('ways--bank-b');
    host.render();

    await expect(loaded).resolves.toBeUndefined();
  });

  it('waits for every intended mutation before accepting offscreen worker acknowledgements', async () => {
    const host = new SettlementHost();
    const mutations = deferred();
    const loaded = waitForSourceBankLoad({
      host,
      sourceIds: ['ways--bank-b', 'services--bank-b'],
      mutationsComplete: mutations.promise,
    });
    let finished = false;
    void loaded.then(() => {
      finished = true;
    });

    // A translated hidden layer can leave `isSourceLoaded` false even though
    // MapLibre's worker accepted the fresh data. That acknowledgement must
    // still wait for the rest of the transaction.
    host.sourceData('ways--bank-b');
    host.sourceData('services--bank-b');
    await Promise.resolve();
    expect(finished).toBe(false);

    mutations.resolve();
    await expect(loaded).resolves.toBeUndefined();
  });

  it('does not mistake a resident source for the mutation that replaces it', async () => {
    const host = new SettlementHost();
    host.loaded.add('ways--bank-b');
    const mutations = deferred();
    const loaded = waitForSourceBankLoad({
      host,
      sourceIds: ['ways--bank-b'],
      mutationsComplete: mutations.promise,
    });
    let finished = false;
    void loaded.then(() => {
      finished = true;
    });

    mutations.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(finished).toBe(false);

    host.sourceData('ways--bank-b');
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

  it('keeps a cold hidden bank eligible to finish beyond the two-second retry window', async () => {
    vi.useFakeTimers();
    try {
      const host = new SettlementHost();
      const loaded = waitForSourceBankLoad({
        host,
        sourceIds: ['stations--bank-b'],
      });
      let outcome: 'pending' | 'loaded' | 'failed' = 'pending';
      void loaded.then(
        () => {
          outcome = 'loaded';
        },
        () => {
          outcome = 'failed';
        },
      );

      await vi.advanceTimersByTimeAsync(2_001);

      expect(outcome).toBe('pending');
    } finally {
      vi.useRealTimers();
    }
  });
});
