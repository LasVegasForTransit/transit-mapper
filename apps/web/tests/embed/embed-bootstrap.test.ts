import { describe, expect, it, vi } from 'vitest';
import type { TransitSystem } from '@transitmapper/core/model/system';
import {
  parseEmbedReference,
  startEmbedRuntime,
  type EmbedContent,
  type EmbedMapRuntimeOptions,
} from '../../src/embed/embed-bootstrap';
import type { EmbedStartupMilestones } from '../../src/embed/startup-milestones';

const milestones: EmbedStartupMilestones = {
  bootstrapStarted: () => undefined,
  shellMounted: () => undefined,
  mapStyleReady: () => undefined,
  systemCommitted: () => undefined,
  interactive: () => undefined,
};

describe('the embed bootstrap', () => {
  it.each([
    ['/e/share123', { kind: 'shared-system', id: 'share123' }],
    ['/e/share123/', { kind: 'shared-system', id: 'share123' }],
    ['/embed/view123', { kind: 'published-view', id: 'view123' }],
    ['/embed/view123/', { kind: 'published-view', id: 'view123' }],
  ] as const)('parses %s as one content reference', (pathname, expected) => {
    expect(parseEmbedReference(pathname)).toEqual(expected);
  });

  it('starts content resolution before importing the map runtime', async () => {
    const content = Promise.resolve({
      system: { id: 'system' } as TransitSystem,
      title: 'Downtown buses',
      openPath: '/v/view-1',
      state: {
        schemaVersion: 1,
        camera: { center: [-115.17, 36.14], zoom: 11 },
        representationId: 'infrastructure',
        filters: { modes: ['bus'], 'way-types': ['road'] },
      },
    } satisfies EmbedContent);
    const reference = { kind: 'published-view' as const, id: 'view-1' };
    const loadContent = vi.fn(() => content);
    let startMap: (() => void) | undefined;
    const mapStarted = new Promise<void>((resolvePromise) => {
      startMap = () => resolvePromise();
    });
    let received: EmbedMapRuntimeOptions | undefined;
    const start = (options: EmbedMapRuntimeOptions) => {
      received = options;
      return mapStarted;
    };
    const loadRuntime = vi.fn(() => Promise.resolve({ start }));

    const pending = startEmbedRuntime({
      reference,
      container: {} as HTMLElement,
      signal: new AbortController().signal,
      milestones,
      loadContent,
      loadRuntime,
    });

    expect(loadContent).toHaveBeenCalledWith(reference, expect.any(AbortSignal));
    expect(loadRuntime).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(received?.reference).toEqual(reference);
    expect(received?.content).toBe(content);
    startMap?.();
    await expect(pending).resolves.toBeUndefined();
  });
});
