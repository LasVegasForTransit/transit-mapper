import { describe, expect, it } from 'vitest';
import { aPattern, aRoad, aService, aSystem } from '@transitmapper/core/testing/fixtures';
import type { TransitSystem } from '@transitmapper/core/model/system';
import { renderPresentationForViewport } from '@transitmapper/core/render/render-presentation';
import {
  createFeatureProjectionWorker,
  type FeatureProjectionClientInput,
  type FeatureProjectionWorker,
} from '../src/workers/feature-projection-worker';
import type {
  FeatureProjectionWorkerEvent,
  FeatureProjectionWorkerRequest,
} from '../src/workers/feature-projection-worker-protocol';
import { emptySystemFeatures } from '../src/system-feature-sources';
import { SRC_SERVICES, SRC_WAYS } from '../src/layers/constants';
import type { RenderPreparedSnapshot } from '@transitmapper/core/render/render-preparation';
import type { PatternOverlayFeatures } from '../src/projection/pattern-overlay-projection';

class RecordingFeatureProjectionWorker implements FeatureProjectionWorker {
  onmessage: ((event: MessageEvent<FeatureProjectionWorkerEvent>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly requests: FeatureProjectionWorkerRequest[] = [];
  terminated = false;

  postMessage(request: FeatureProjectionWorkerRequest): void {
    this.requests.push(request);
  }

  terminate(): void {
    this.terminated = true;
  }

  respond(event: FeatureProjectionWorkerEvent): void {
    this.onmessage?.({ data: event } as MessageEvent<FeatureProjectionWorkerEvent>);
  }
}

function requestInput(): FeatureProjectionClientInput {
  return {
    system: aSystem({ id: 'worker-system' }),
    selection: null,
    handleWayIds: [],
    sourceIds: [SRC_WAYS],
    view: {
      viewMode: 'infrastructure' as const,
      visibleModes: new Set<string>(),
      visibleWayTypes: new Set<string>(),
      presentation: renderPresentationForViewport({
        center: [-115.15, 36.15],
        zoom: 14,
        width: 800,
        height: 600,
      }),
    },
  };
}

/** The entry module installs itself on the Worker global rather than
 * exporting a handler, so a test drives it the way workerd does. */
interface FeatureProjectionWorkerScope {
  onmessage: ((event: MessageEvent<FeatureProjectionWorkerRequest>) => void) | null;
  postMessage(event: FeatureProjectionWorkerEvent): void;
}

async function runWorkerEntry(
  request: FeatureProjectionWorkerRequest,
): Promise<FeatureProjectionWorkerEvent> {
  await import('../src/workers/feature-projection-worker-entry');
  const scope = globalThis as unknown as FeatureProjectionWorkerScope;
  return new Promise((resolve) => {
    scope.postMessage = resolve;
    scope.onmessage?.({ data: request } as MessageEvent<FeatureProjectionWorkerRequest>);
  });
}

function aLineSystem(latitude: number): TransitSystem {
  const way = aRoad('corridor', [
    [-115.2, latitude],
    [-115.16, latitude],
  ]);
  const service = aService('corridor-service', [aPattern('corridor-pattern', [way], [way.id])]);
  return aSystem({
    id: 'diagram-system',
    ways: [way],
    services: [service],
    lines: [{ id: 'corridor-line', name: 'Corridor', color: '#123456', serviceIds: [service.id] }],
  });
}

function lineSceneRequest(
  viewMode: 'network' | 'diagram',
  system: TransitSystem,
  diagramSystem?: TransitSystem,
): FeatureProjectionWorkerRequest {
  return {
    kind: 'project',
    requestId: 1,
    input: {
      system,
      diagramSystem,
      selection: null,
      handleWayIds: [],
      sourceIds: [SRC_SERVICES],
      sceneRevision: `line:${viewMode}`,
      view: {
        viewMode,
        visibleModes: new Set(['bus']),
        visibleWayTypes: new Set(['road']),
        presentation: renderPresentationForViewport({
          center: [-115.18, 36.14],
          zoom: 14,
          width: 1_280,
          height: 720,
        }),
      },
    },
  };
}

function stripesFrom(event: FeatureProjectionWorkerEvent) {
  if (event.kind !== 'done') throw new Error(`Projection did not finish: ${event.kind}.`);
  return event.features.services.features.filter(
    (feature) => feature.properties?.routeRole === 'stripe',
  );
}

function stripeLineIds(stripes: readonly { readonly properties: unknown }[]): Set<string> {
  return new Set(
    stripes.map((stripe) => {
      const lineId = (stripe.properties as Record<string, unknown> | null)?.lineId;
      if (typeof lineId !== 'string') throw new Error('A Line stripe carries no lineId.');
      return lineId;
    }),
  );
}

describe('Feature projection worker', () => {
  it('sends a clone-safe projection request and returns its matching result', async () => {
    const worker = new RecordingFeatureProjectionWorker();
    const client = createFeatureProjectionWorker({ workerFactory: () => worker });
    const input = requestInput();

    const projected = client.project(input);

    expect(worker.requests).toHaveLength(1);
    expect(worker.requests[0]).toMatchObject({
      kind: 'project',
      requestId: 1,
      input: {
        system: input.system,
        sourceIds: [SRC_WAYS],
      },
    });
    expect('tierStateResolver' in (worker.requests[0]?.input.view ?? {})).toBe(false);
    const features = emptySystemFeatures();
    worker.respond({ kind: 'done', requestId: 1, features, counts: null });

    await expect(projected).resolves.toEqual({ features, counts: null });
  });

  it('keeps main-thread preparation indexes out of the worker message', async () => {
    const worker = new RecordingFeatureProjectionWorker();
    const client = createFeatureProjectionWorker({ workerFactory: () => worker });
    const preparedSnapshot = {
      servicesByWay: { get: () => [] },
    } as unknown as RenderPreparedSnapshot;

    const projected = client.project({ ...requestInput(), preparedSnapshot });

    expect(worker.requests[0]?.input).not.toHaveProperty('preparedSnapshot');
    client.dispose();
    await expect(projected).rejects.toThrow('Feature projection Worker is disposed.');
  });

  it('rejects an aborted request and ignores its late worker response', async () => {
    const worker = new RecordingFeatureProjectionWorker();
    const client = createFeatureProjectionWorker({ workerFactory: () => worker });
    const abort = new AbortController();
    const pending = client.project(requestInput(), abort.signal);

    abort.abort();
    worker.respond({ kind: 'done', requestId: 1, features: emptySystemFeatures(), counts: null });

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    client.dispose();
    expect(worker.terminated).toBe(true);
  });

  it('replaces a superseded Worker before a fresh projection can publish', async () => {
    const staleWorker = new RecordingFeatureProjectionWorker();
    const currentWorker = new RecordingFeatureProjectionWorker();
    const workers = [staleWorker, currentWorker];
    const client = createFeatureProjectionWorker({
      workerFactory: () => {
        const worker = workers.shift();
        if (!worker) throw new Error('Expected a replacement projection Worker.');
        return worker;
      },
    });
    const abort = new AbortController();
    const stale = client.project(requestInput(), abort.signal);
    const staleAssertion = expect(stale).rejects.toMatchObject({ name: 'AbortError' });

    abort.abort();
    expect(staleWorker.terminated).toBe(true);
    const current = client.project(requestInput());
    staleWorker.respond({
      kind: 'done',
      requestId: 1,
      features: emptySystemFeatures(),
      counts: null,
    });
    currentWorker.respond({
      kind: 'done',
      requestId: 2,
      features: emptySystemFeatures(),
      counts: null,
    });

    await staleAssertion;
    await expect(current).resolves.toEqual({ features: emptySystemFeatures(), counts: null });
  });

  it('projects an explicit Pattern overlay through its own semantic request', async () => {
    const worker = new RecordingFeatureProjectionWorker();
    const client = createFeatureProjectionWorker({ workerFactory: () => worker });
    const input = { ...requestInput(), serviceId: 'service-a', patternId: 'pattern-a' };
    const projected = client.projectPatternOverlay(input);

    expect(worker.requests[0]).toMatchObject({
      kind: 'project-pattern-overlay',
      requestId: 1,
      input: {
        system: input.system,
        serviceId: 'service-a',
        patternId: 'pattern-a',
      },
    });
    expect('tierStateResolver' in (worker.requests[0]?.input.view ?? {})).toBe(false);
    const overlay: PatternOverlayFeatures = {
      path: { type: 'FeatureCollection', features: [] },
      arrows: { type: 'FeatureCollection', features: [] },
      termini: { type: 'FeatureCollection', features: [] },
    };
    worker.respond({ kind: 'pattern-overlay-done', requestId: 1, overlay });

    await expect(projected).resolves.toEqual(overlay);
  });

  // Every other case here settles a fake Worker's message queue and finishes in
  // about a millisecond. This one resolves two real Line scenes through the
  // provider, which takes ~500ms unloaded — close enough to Vitest's 5s default
  // that running the repository suites concurrently pushes it over, so the
  // budget is stated rather than inherited.
  it('gives Diagram the same Line identity as Network on different layout geometry', async () => {
    const system = aLineSystem(36.14);
    const diagramSystem = aLineSystem(36.15);

    const network = stripesFrom(await runWorkerEntry(lineSceneRequest('network', system)));
    const diagram = stripesFrom(
      await runWorkerEntry(lineSceneRequest('diagram', system, diagramSystem)),
    );

    expect(stripeLineIds(network)).toEqual(new Set(['corridor-line']));
    expect(stripeLineIds(diagram)).toEqual(stripeLineIds(network));
    expect(diagram.map((feature) => feature.geometry)).not.toEqual(
      network.map((feature) => feature.geometry),
    );
  }, 30_000);
});
