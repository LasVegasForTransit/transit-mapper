import { describe, expect, it, vi } from 'vitest';
import type { TransitSystem } from '@transitmapper/core/model/system';
import { startEmbedRuntime } from '../../src/embed/embed-bootstrap';
import type { EmbedStartupMilestones } from '../../src/embed/startup-milestones';

const milestones: EmbedStartupMilestones = {
  bootstrapStarted: () => undefined,
  shellMounted: () => undefined,
  mapStyleReady: () => undefined,
  systemCommitted: () => undefined,
  interactive: () => undefined,
};

describe('the embed bootstrap', () => {
  it('starts its document request before importing the map runtime', async () => {
    const system = Promise.resolve({ id: 'system' } as TransitSystem);
    const loadSystem = vi.fn(() => system);
    let startMap: (() => void) | undefined;
    const mapStarted = new Promise<void>((resolvePromise) => {
      startMap = () => resolvePromise();
    });
    const start = vi.fn(() => mapStarted);
    const loadRuntime = vi.fn(() => Promise.resolve({ start }));

    const pending = startEmbedRuntime({
      id: 'share',
      container: {} as HTMLElement,
      signal: new AbortController().signal,
      milestones,
      loadSystem,
      loadRuntime,
    });

    expect(loadSystem).toHaveBeenCalledWith('share', expect.any(AbortSignal));
    expect(loadRuntime).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(start).toHaveBeenCalledOnce();
    startMap?.();
    await expect(pending).resolves.toBeUndefined();
  });
});
