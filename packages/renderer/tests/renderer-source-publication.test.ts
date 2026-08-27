import { describe, expect, it, vi } from 'vitest';
import { RendererSourcePublication } from '../src/sources/renderer-source-publication';
import type { ScenePublicationContext } from '../src/scene-publication';
import type { SourceBankSettlementHost } from '../src/sources/source-bank-settlement';
import type { SourceBankLayerController } from '../src/sources/source-bank-layers';

class PublicationHost implements SourceBankSettlementHost {
  private readonly sourceListeners = new Set<(sourceId: string) => void>();
  private readonly renderListeners = new Set<() => void>();

  isSourceLoaded = (): boolean => false;
  triggerRepaint = vi.fn();

  onSourceData = (listener: (sourceId: string) => void) => {
    this.sourceListeners.add(listener);
    return () => this.sourceListeners.delete(listener);
  };

  onRender = (listener: () => void) => {
    this.renderListeners.add(listener);
    return () => this.renderListeners.delete(listener);
  };

  sourceData(sourceId: string): void {
    for (const listener of this.sourceListeners) listener(sourceId);
  }

  render(): void {
    for (const listener of this.renderListeners) listener();
  }
}

const context: ScenePublicationContext = {
  sourceIds: ['tm-ways--bank-b', 'tm-stations--bank-b'],
  clearedSourceIds: ['tm-ways--bank-b'],
  mode: 'hidden',
  bank: 'b',
};

describe('renderer source publication', () => {
  it('starts the first source bank without waiting for a frame from an empty map', async () => {
    const host = new PublicationHost();
    const prepare = vi.fn();
    const layers = {
      prepare,
      activate: vi.fn(),
      finishActivation: vi.fn(),
      finishStaging: vi.fn(),
      restore: vi.fn(),
    } as unknown as SourceBankLayerController;
    const publication = new RendererSourcePublication({
      host,
      layers,
      banks: { activeBank: () => null } as never,
      recovery: {
        requestRecovery: vi.fn(),
        handleSourceError: vi.fn(),
        whenSettled: () => Promise.resolve(),
      } as never,
    });
    const prewarm = publication.hooks({}).beforeSourceMutation?.(context);
    let settled = false;
    void prewarm?.then(() => {
      settled = true;
    });

    await Promise.resolve();

    expect(prepare).toHaveBeenCalledWith('b', new Set(['tm-ways']));
    expect(settled).toBe(true);
  });

  it('waits only for incoming sources that can produce visible geometry', async () => {
    const host = new PublicationHost();
    const prepare = vi.fn();
    const layers = {
      prepare,
      activate: vi.fn(),
      finishActivation: vi.fn(),
      finishStaging: vi.fn(),
      restore: vi.fn(),
    } as unknown as SourceBankLayerController;
    const publication = new RendererSourcePublication({
      host,
      layers,
      banks: { activeBank: () => 'a' } as never,
      recovery: {
        requestRecovery: vi.fn(),
        handleSourceError: vi.fn(),
        whenSettled: () => Promise.resolve(),
      } as never,
    });
    const hooks = publication.hooks({});

    const prewarm = hooks.beforeSourceMutation?.(context);
    host.render();
    await prewarm;

    hooks.onSourceMutationStart?.(context.sourceIds, context);
    // MapLibre does not produce a content event for the empty ways source.
    host.sourceData('tm-stations--bank-b');
    const ready = hooks.beforePublish?.(context);
    for (let frame = 0; frame < 3; frame += 1) {
      await Promise.resolve();
      host.render();
    }
    await ready;

    expect(prepare).toHaveBeenCalledWith('b', new Set(['tm-ways']));
  });

  it('waits for an empty hit source before changing hit-query ownership', async () => {
    const host = new PublicationHost();
    const layers = {
      prepare: vi.fn(),
      activate: vi.fn(),
      finishActivation: vi.fn(),
      finishStaging: vi.fn(),
      restore: vi.fn(),
    } as unknown as SourceBankLayerController;
    const publication = new RendererSourcePublication({
      host,
      layers,
      banks: { activeBank: () => 'a' } as never,
      recovery: {
        requestRecovery: vi.fn(),
        handleSourceError: vi.fn(),
        whenSettled: () => Promise.resolve(),
      } as never,
    });
    const hooks = publication.hooks({});
    const hitContext: ScenePublicationContext = {
      sourceIds: ['tm-ways--bank-b', 'tm-hit-features--bank-b', 'tm-stations--bank-b'],
      clearedSourceIds: ['tm-ways--bank-b', 'tm-hit-features--bank-b'],
      mode: 'hidden',
      bank: 'b',
    };

    const prewarm = hooks.beforeSourceMutation?.(hitContext);
    host.render();
    await prewarm;
    hooks.onSourceMutationStart?.(hitContext.sourceIds, hitContext);
    host.sourceData('tm-stations--bank-b');
    const ready = hooks.beforePublish?.(hitContext);
    let settled = false;
    void ready?.then(() => {
      settled = true;
    });
    for (let frame = 0; frame < 3; frame += 1) {
      await Promise.resolve();
      host.render();
    }
    expect(settled).toBe(false);

    host.sourceData('tm-hit-features--bank-b');
    for (let frame = 0; frame < 3; frame += 1) {
      await Promise.resolve();
      host.render();
    }
    await ready;
  });
});
