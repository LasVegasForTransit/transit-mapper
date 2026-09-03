import { describe, expect, it } from 'vitest';
import { aPattern, aRoad, aService, aSystem } from '@transitmapper/core/testing/fixtures';
import type { TransitSystem } from '@transitmapper/core/model/system';
import { renderPresentationForViewport } from '@transitmapper/core/render/render-presentation';
import {
  createFeatureProjectionWorker,
  type FeatureProjectionClientInput,
  type FeatureProjectionResult,
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
      system: { kind: 'sent', system },
      diagramSystem: diagramSystem ? { kind: 'sent', system: diagramSystem } : null,
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

/**
 * The production client talking to the production entry.
 *
 * Retention is a claim two halves make about one worker realm, so neither
 * half is faked here: the client decides what to put on the wire, and the
 * entry answers out of what earlier messages left it holding.
 */
class EntryBackedProjectionWorker implements FeatureProjectionWorker {
  onmessage: ((event: MessageEvent<FeatureProjectionWorkerEvent>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly requests: FeatureProjectionWorkerRequest[] = [];
  terminated = false;

  postMessage(request: FeatureProjectionWorkerRequest): void {
    this.requests.push(request);
    void runWorkerEntry(request).then((event) => {
      // A terminated realm answers nobody. Its callers were already rejected
      // when the client replaced it.
      if (!this.terminated) {
        this.onmessage?.({ data: event } as MessageEvent<FeatureProjectionWorkerEvent>);
      }
    });
  }

  terminate(): void {
    this.terminated = true;
  }

  /** A realm that raised. The client replaces one of these, because nothing
   * says how far its retained state got. */
  fail(message: string): void {
    this.onerror?.({ message } as ErrorEvent);
  }
}

/** Requests that carried work. `cancel` names a requestId and nothing else,
 * so it has no `input` to read. */
function workRequests(worker: { readonly requests: readonly FeatureProjectionWorkerRequest[] }) {
  return worker.requests.filter(
    (request): request is Extract<FeatureProjectionWorkerRequest, { input: unknown }> =>
      request.kind !== 'cancel',
  );
}

/** Each request as the wire saw it: the document it carried, or the word for
 * the one it left to the worker. */
function carriedSystems(worker: EntryBackedProjectionWorker): (TransitSystem | 'retained')[] {
  return workRequests(worker).map((request) =>
    'system' in request.input && request.input.system.kind === 'sent'
      ? request.input.system.system
      : 'retained',
  );
}

function aWaySystem(latitude: number): TransitSystem {
  return aSystem({
    id: 'retained-system',
    ways: [
      aRoad('corridor', [
        [-115.2, latitude],
        [-115.16, latitude],
      ]),
    ],
  });
}

function wayProjectionInput(system: TransitSystem): FeatureProjectionClientInput {
  return {
    system,
    selection: null,
    handleWayIds: [],
    sourceIds: [SRC_WAYS],
    view: {
      viewMode: 'infrastructure' as const,
      visibleModes: new Set(['bus']),
      visibleWayTypes: new Set(['road']),
      presentation: renderPresentationForViewport({
        center: [-115.18, 36.14],
        zoom: 14,
        width: 1_280,
        height: 720,
      }),
    },
  };
}

type NestedCoordinates = number[] | NestedCoordinates[];

function positions(coordinates: NestedCoordinates): number[][] {
  return typeof coordinates[0] === 'number'
    ? [coordinates as number[]]
    : (coordinates as NestedCoordinates[]).flatMap(positions);
}

/** Which latitude the projected street sits on. A way is projected as a
 * corridor polygon a few metres wide, so three decimals collapses both of its
 * edges back onto the centre line the fixture drew. */
function projectedLatitudes(result: FeatureProjectionResult): number[] {
  return [
    ...new Set(
      result.features.ways.features
        .flatMap((feature) =>
          'coordinates' in feature.geometry
            ? positions(feature.geometry.coordinates as NestedCoordinates)
            : [],
        )
        .map(([, latitude]) => Number(latitude.toFixed(3))),
    ),
  ].sort();
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
        system: { kind: 'sent', system: input.system },
        diagramSystem: null,
        sourceIds: [SRC_WAYS],
      },
    });
    expect('tierStateResolver' in (workRequests(worker)[0]?.input.view ?? {})).toBe(false);
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

    expect(workRequests(worker)[0]?.input).not.toHaveProperty('preparedSnapshot');
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

  // Supersession used to terminate the Worker, which reclaimed its CPU and
  // threw away everything it had retained. Request ids are what keep a stale
  // reply from publishing, so cancelling costs the projection and nothing else.
  it('keeps the Worker when a projection is superseded, and never publishes the stale one', async () => {
    const worker = new RecordingFeatureProjectionWorker();
    const client = createFeatureProjectionWorker({
      workerFactory: () => {
        if (worker.terminated)
          throw new Error('A superseded projection must not replace the Worker.');
        return worker;
      },
    });
    const abort = new AbortController();
    const stale = client.project(requestInput(), abort.signal);
    const staleAssertion = expect(stale).rejects.toMatchObject({ name: 'AbortError' });

    abort.abort();
    expect(worker.terminated).toBe(false);
    expect(worker.requests.at(-1)).toEqual({ kind: 'cancel', requestId: 1 });

    const current = client.project(requestInput());
    // The superseded projection finishing anyway must publish nothing.
    worker.respond({ kind: 'done', requestId: 1, features: emptySystemFeatures(), counts: null });
    worker.respond({ kind: 'done', requestId: 2, features: emptySystemFeatures(), counts: null });

    await staleAssertion;
    await expect(current).resolves.toEqual({ features: emptySystemFeatures(), counts: null });
  });

  // A camera move changes no part of the document, and cloning the RTC fixture
  // across the boundary costs 36-60 ms of main-thread time every time it
  // happens. These three cases are the whole contract that avoids it.
  it('names the retained System rather than re-sending an unchanged object', async () => {
    const worker = new EntryBackedProjectionWorker();
    const client = createFeatureProjectionWorker({ workerFactory: () => worker });
    const system = aWaySystem(36.14);

    const first = await client.project(wayProjectionInput(system));
    const second = await client.project(wayProjectionInput(system));

    expect(carriedSystems(worker)).toEqual([system, 'retained']);
    expect(projectedLatitudes(second)).toEqual(projectedLatitudes(first));
    expect(projectedLatitudes(second)).toEqual([36.14]);
    client.dispose();
  });

  it('carries the System again once the object changes, and projects the new content', async () => {
    const worker = new EntryBackedProjectionWorker();
    const client = createFeatureProjectionWorker({ workerFactory: () => worker });
    const before = aWaySystem(36.14);
    // Same id, same `updatedAt`, moved geometry: the editor store rebuilds the
    // object on every mutation, so only the reference separates these two.
    const after = aWaySystem(36.15);
    expect(after.updatedAt).toBe(before.updatedAt);

    await client.project(wayProjectionInput(before));
    const second = await client.project(wayProjectionInput(after));

    expect(carriedSystems(worker)).toEqual([before, after]);
    expect(projectedLatitudes(second)).toEqual([36.15]);
    client.dispose();
  });

  // Retention survives supersession now, which is the point: an abort leaves
  // the realm intact, so the next projection still names what it holds. Only a
  // Worker that errored loses its realm, and that one must be re-sent.
  it('keeps the System retained across an abort, and re-sends it after a Worker error', async () => {
    const first = new EntryBackedProjectionWorker();
    const replacement = new EntryBackedProjectionWorker();
    const workers = [first, replacement];
    const client = createFeatureProjectionWorker({
      workerFactory: () => {
        const worker = workers.shift();
        if (!worker) throw new Error('Expected a replacement projection Worker.');
        return worker;
      },
    });
    const system = aWaySystem(36.14);

    await client.project(wayProjectionInput(system));
    const abort = new AbortController();
    const superseded = client.project(wayProjectionInput(system), abort.signal);
    const supersededAssertion = expect(superseded).rejects.toMatchObject({ name: 'AbortError' });
    abort.abort();
    await supersededAssertion;
    await client.project(wayProjectionInput(system));

    expect(first.terminated).toBe(false);
    expect(carriedSystems(first)).toEqual([system, 'retained', 'retained']);

    // An errored Worker's realm is unreachable, so the record of what it held
    // goes with it.
    first.fail('Feature Worker failed.');
    await client.project(wayProjectionInput(system));
    expect(first.terminated).toBe(true);
    expect(carriedSystems(replacement)).toEqual([system]);
    client.dispose();
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
        system: { kind: 'sent', system: input.system },
        serviceId: 'service-a',
        patternId: 'pattern-a',
      },
    });
    expect('tierStateResolver' in (workRequests(worker)[0]?.input.view ?? {})).toBe(false);
    const overlay: PatternOverlayFeatures = {
      path: { type: 'FeatureCollection', features: [] },
      arrows: { type: 'FeatureCollection', features: [] },
      termini: { type: 'FeatureCollection', features: [] },
    };
    worker.respond({ kind: 'pattern-overlay-done', requestId: 1, overlay });

    await expect(projected).resolves.toEqual(overlay);
  });

  // An overlay used to abort by replacing the Worker, and that path returned
  // early unless a committed projection was also in flight — so an overlay
  // cancelled on its own never settled, and the editor awaits both together.
  it('rejects an aborted Pattern overlay when no projection is in flight', async () => {
    const worker = new RecordingFeatureProjectionWorker();
    const client = createFeatureProjectionWorker({
      workerFactory: () => {
        if (worker.terminated) throw new Error('A cancelled overlay must not replace the Worker.');
        return worker;
      },
    });
    const abort = new AbortController();
    const overlay = client.projectPatternOverlay(
      { ...requestInput(), serviceId: 'service-a', patternId: 'pattern-a' },
      abort.signal,
    );
    const rejection = expect(overlay).rejects.toMatchObject({ name: 'AbortError' });

    abort.abort();

    await rejection;
    // The realm a cancelled overlay leaves behind is still usable, so it keeps
    // both the Worker and the record of what that Worker was sent.
    expect(worker.terminated).toBe(false);
    expect(worker.requests.at(-1)).toEqual({ kind: 'cancel', requestId: 1 });
    client.dispose();
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
