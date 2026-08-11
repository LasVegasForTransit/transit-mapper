import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
import type { ViewOptions } from '../../src/map/layers';
import { svgViewForViewport } from '../../src/share/svg-render-view';
import type { SvgWorkerEvent, SvgWorkerRequest } from '../../src/share/svgWorkerProtocol';
import { renderSvgInWorker, type SvgRenderWorker } from '../../src/share/svgWorker';

class FakeWorker implements SvgRenderWorker {
  onmessage: ((event: MessageEvent<SvgWorkerEvent>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  request: SvgWorkerRequest | null = null;
  terminated = false;

  postMessage(message: SvgWorkerRequest): void {
    this.request = message;
  }

  terminate(): void {
    this.terminated = true;
  }

  succeed(markup: string): void {
    this.onmessage?.({ data: { kind: 'done', markup } } as MessageEvent<SvgWorkerEvent>);
  }
}

const viewport = {
  center: [-115.17, 36.17] as [number, number],
  zoom: 10,
  width: 800,
  height: 500,
};
const view: ViewOptions = {
  viewMode: 'network',
  visibleModes: new Set<string>(),
  visibleWayTypes: new Set<string>(),
};
const request: SvgWorkerRequest = {
  system: createEmptySystem(),
  view: svgViewForViewport(view, viewport),
  viewport,
  options: {
    title: 'Test',
    legend: [],
    width: 800,
    height: 500,
  },
};

afterEach(() => {
  vi.useRealTimers();
});

describe('SVG render Worker', () => {
  it('returns Worker-rendered markup and releases the Worker', async () => {
    const worker = new FakeWorker();
    const result = renderSvgInWorker(request, { workerFactory: () => worker });

    expect(worker.request).toEqual(request);
    worker.succeed('<svg />');

    await expect(result).resolves.toBe('<svg />');
    expect(worker.terminated).toBe(true);
  });

  it('terminates promptly when the export is canceled', async () => {
    const worker = new FakeWorker();
    const controller = new AbortController();
    const result = renderSvgInWorker(request, {
      signal: controller.signal,
      workerFactory: () => worker,
    });

    controller.abort(new DOMException('Dialog closed.', 'AbortError'));

    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker.terminated).toBe(true);
  });

  it('bounds a stalled Worker with a timeout', async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const result = renderSvgInWorker(request, {
      timeoutMs: 25,
      workerFactory: () => worker,
    });
    const rejection = expect(result).rejects.toThrow('SVG export timed out');

    await vi.advanceTimersByTimeAsync(25);

    await rejection;
    expect(worker.terminated).toBe(true);
  });
});
