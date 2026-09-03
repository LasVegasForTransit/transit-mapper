import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
import type { ViewOptions } from '@transitmapper/core/render/buildFeatures';
import { MODE_ORDER, WAY_TYPE_ORDER } from '@transitmapper/core/model/catalog';
import { aPattern, aRoad, aService, aSystem } from '@transitmapper/core/testing/fixtures';
import type { LngLat, TransitSystem } from '@transitmapper/core/model/system';
import { svgViewForViewport } from '../../src/share/svg-render-view';
import type { SvgWorkerEvent, SvgWorkerRequest } from '../../src/share/svgWorkerProtocol';
import { installSvgRenderWorker, type SvgRenderWorkerScope } from '../../src/share/svgWorkerEntry';
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

class FakeSvgWorkerScope implements SvgRenderWorkerScope {
  onmessage: ((event: MessageEvent<SvgWorkerRequest>) => void) | null = null;
  readonly events: SvgWorkerEvent[] = [];

  postMessage(event: SvgWorkerEvent): void {
    this.events.push(event);
  }

  dispatch(request: SvgWorkerRequest): void {
    this.onmessage?.({ data: request } as MessageEvent<SvgWorkerRequest>);
  }
}

const carrier = aRoad('carrier', [
  [-115.22, 36.14],
  [-115.16, 36.14],
] as LngLat[]);

function sharedCarrierSystem(): TransitSystem {
  const local = aService('local', [aPattern('local-pattern', [carrier], [carrier.id])]);
  const express = aService('express', [aPattern('express-pattern', [carrier], [carrier.id])]);
  return aSystem({
    ways: [carrier],
    services: [local, express],
    lines: [
      { id: 'shared-line', name: 'Shared', color: '#123456', serviceIds: [local.id, express.id] },
    ],
  });
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

async function markupFor(viewMode: ViewOptions['viewMode']): Promise<string> {
  const scope = new FakeSvgWorkerScope();
  installSvgRenderWorker(scope);
  const system = sharedCarrierSystem();
  const wholeSystem: ViewOptions = {
    viewMode,
    visibleModes: new Set(MODE_ORDER),
    visibleWayTypes: new Set(WAY_TYPE_ORDER),
  };
  scope.dispatch({
    system,
    view: svgViewForViewport(wholeSystem, viewport),
    viewport,
    options: { title: '', legend: [], width: 800, height: 500, captionedExternally: true },
  });
  await vi.waitFor(() => expect(scope.events).toHaveLength(1));
  const [event] = scope.events;
  if (event.kind !== 'done') throw new Error(`SVG Worker failed: ${JSON.stringify(event)}`);
  return event.markup;
}

describe('SVG render Worker runtime', () => {
  it('draws one casing and one stripe for a Line two ServicePlans serve', async () => {
    const markup = await markupFor('network');

    expect(routeRoleCounts(markup)).toEqual({ casings: 1, stripes: 1 });
    expect(markup).toContain('stroke="#123456"');
  });

  it('leaves Infrastructure on the per-Service document geometry', async () => {
    const markup = await markupFor('infrastructure');

    expect(routeRoleCounts(markup)).toEqual({ casings: 0, stripes: 0 });
  });
});
