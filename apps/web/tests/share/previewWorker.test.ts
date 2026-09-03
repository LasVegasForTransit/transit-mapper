import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
import { aPattern, aRoad, aService, aSystem } from '@transitmapper/core/testing/fixtures';
import type { LngLat, TransitSystem } from '@transitmapper/core/model/system';
import { renderPreviewMarkup } from '../../src/share/previewWorker';
import { installPreviewWorker, type PreviewWorkerScope } from '../../src/share/previewWorkerEntry';
import type {
  PreviewWorkerEvent,
  PreviewWorkerRequest,
} from '../../src/share/previewWorkerProtocol';

class FakePreviewWorker {
  onmessage: ((event: MessageEvent<PreviewWorkerEvent>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  lastRequest: PreviewWorkerRequest | null = null;
  postMessage(message: PreviewWorkerRequest): void {
    this.lastRequest = message;
    queueMicrotask(() => {
      const system = JSON.parse(message.data) as { id: string };
      this.onmessage?.({
        data: { kind: 'done', markup: `<svg data-system="${system.id}" />` },
      } as MessageEvent<PreviewWorkerEvent>);
    });
  }
  terminate(): void {
    this.terminated = true;
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe('share preview Worker', () => {
  it('returns generated markup and releases its Worker', async () => {
    const worker = new FakePreviewWorker();
    const system = createEmptySystem();

    await expect(
      renderPreviewMarkup(JSON.stringify(system), { workerFactory: () => worker }),
    ).resolves.toContain(system.id);
    expect(worker.terminated).toBe(true);
  });

  it('passes the intended display width to the preview Worker', async () => {
    const worker = new FakePreviewWorker();

    await renderPreviewMarkup(JSON.stringify(createEmptySystem()), {
      displayWidth: 280,
      workerFactory: () => worker,
    });

    expect(worker.lastRequest).toMatchObject({ displayWidth: 280 });
  });

  it('terminates immediately when sharing is canceled', async () => {
    const worker = new FakePreviewWorker();
    worker.postMessage = () => {};
    const controller = new AbortController();
    const pending = renderPreviewMarkup(JSON.stringify(createEmptySystem()), {
      signal: controller.signal,
      workerFactory: () => worker,
    });

    controller.abort(new DOMException('Canceled', 'AbortError'));

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker.terminated).toBe(true);
  });

  it('bounds a Worker that never answers', async () => {
    vi.useFakeTimers();
    const worker = new FakePreviewWorker();
    worker.postMessage = () => {};
    const pending = renderPreviewMarkup(JSON.stringify(createEmptySystem()), {
      timeoutMs: 100,
      workerFactory: () => worker,
    });
    const rejection = expect(pending).rejects.toThrow('timed out');

    await vi.advanceTimersByTimeAsync(100);

    await rejection;
    expect(worker.terminated).toBe(true);
  });
});

class FakePreviewWorkerScope implements PreviewWorkerScope {
  onmessage: ((event: MessageEvent<PreviewWorkerRequest>) => void) | null = null;
  readonly events: PreviewWorkerEvent[] = [];

  postMessage(event: PreviewWorkerEvent): void {
    this.events.push(event);
  }

  dispatch(request: PreviewWorkerRequest): void {
    this.onmessage?.({ data: request } as MessageEvent<PreviewWorkerRequest>);
  }
}

/** Distinct route identities, counted by the role each was named with. Every
 *  identity paints once per pass, so raw occurrences over-count the stripes. */
function routeRoleCounts(markup: string): { casings: number; stripes: number } {
  const ids = new Set(
    [...markup.matchAll(/data-render-source="services" data-feature-id="([^"]+)"/g)].map(
      (match) => match[1],
    ),
  );
  return {
    casings: [...ids].filter((id) => id.includes('line-casing')).length,
    stripes: [...ids].filter((id) => id.includes('line-stripe')).length,
  };
}

async function cardFor(system: TransitSystem): Promise<string> {
  const scope = new FakePreviewWorkerScope();
  installPreviewWorker(scope);
  scope.dispatch({ data: JSON.stringify(system) });
  await vi.waitFor(() => expect(scope.events).toHaveLength(1));
  const [event] = scope.events;
  if (event.kind !== 'done') throw new Error(`Preview Worker failed: ${JSON.stringify(event)}`);
  return event.markup;
}

describe('share preview Worker runtime', () => {
  const carrier = aRoad('carrier', [
    [-115.22, 36.14],
    [-115.16, 36.14],
  ] as LngLat[]);

  it('draws one casing and one stripe for a Line two ServicePlans serve', async () => {
    const local = aService('local', [aPattern('local-pattern', [carrier], [carrier.id])]);
    const express = aService('express', [aPattern('express-pattern', [carrier], [carrier.id])]);

    const card = await cardFor(
      aSystem({
        name: 'Shared carrier',
        ways: [carrier],
        services: [local, express],
        lines: [
          {
            id: 'shared-line',
            name: 'Shared',
            color: '#123456',
            serviceIds: [local.id, express.id],
          },
        ],
      }),
    );

    expect(routeRoleCounts(card)).toEqual({ casings: 1, stripes: 1 });
    expect(card).toContain('stroke="#123456"');
  });

  it('draws one stripe per Line when two Lines share a carrier', async () => {
    const first = aService('first', [aPattern('first-pattern', [carrier], [carrier.id])]);
    const second = aService('second', [aPattern('second-pattern', [carrier], [carrier.id])]);

    const card = await cardFor(
      aSystem({
        name: 'Two lines',
        ways: [carrier],
        services: [first, second],
        lines: [
          { id: 'first-line', name: 'First', color: '#123456', serviceIds: [first.id] },
          { id: 'second-line', name: 'Second', color: '#abcdef', serviceIds: [second.id] },
        ],
      }),
    );

    expect(routeRoleCounts(card)).toEqual({ casings: 1, stripes: 2 });
    expect(card).toContain('stroke="#123456"');
    expect(card).toContain('stroke="#abcdef"');
  });
});
