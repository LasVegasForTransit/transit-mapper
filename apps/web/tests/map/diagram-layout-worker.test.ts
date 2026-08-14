import { describe, expect, it } from 'vitest';
import { aRoad, aSystem } from '@transitmapper/core/testing/fixtures';
import { layoutDiagram } from '@transitmapper/core/model/diagramLayout';
import {
  createDiagramLayoutWorker,
  type DiagramLayoutWorker,
} from '../../src/map/diagram-layout-worker';
import type {
  DiagramLayoutWorkerEvent,
  DiagramLayoutWorkerRequest,
} from '../../src/map/diagram-layout-worker-protocol';

class RecordingDiagramWorker implements DiagramLayoutWorker {
  onmessage: ((event: MessageEvent<DiagramLayoutWorkerEvent>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly requests: DiagramLayoutWorkerRequest[] = [];
  terminated = false;

  postMessage(request: DiagramLayoutWorkerRequest): void {
    this.requests.push(request);
  }

  terminate(): void {
    this.terminated = true;
  }

  respond(event: DiagramLayoutWorkerEvent): void {
    this.onmessage?.({ data: event } as MessageEvent<DiagramLayoutWorkerEvent>);
  }
}

function diagramSystem(name: string) {
  return aSystem({
    name,
    ways: [
      aRoad(`${name}-way`, [
        [-115.181, 36.14],
        [-115.179, 36.14],
      ]),
    ],
  });
}

describe('Diagram layout worker', () => {
  it('returns the worker-owned schematic system for the current request', async () => {
    const worker = new RecordingDiagramWorker();
    const layout = createDiagramLayoutWorker({ workerFactory: () => worker });
    const geographic = diagramSystem('geographic');
    const schematic = layoutDiagram(diagramSystem('schematic'));

    const result = layout.layout(geographic, 'diagram:geographic');

    expect(worker.requests).toEqual([
      { kind: 'layout', requestId: 1, revision: 'diagram:geographic', system: geographic },
    ]);
    worker.respond({
      kind: 'done',
      requestId: 1,
      revision: 'diagram:geographic',
      layout: schematic,
    });

    await expect(result).resolves.toBe(schematic);
    await expect(result.then((layout) => layout.system)).resolves.toBe(schematic.system);
    layout.dispose();
    expect(worker.terminated).toBe(true);
  });

  it('does not let an aborted request publish after a newer diagram request', async () => {
    const worker = new RecordingDiagramWorker();
    const layout = createDiagramLayoutWorker({ workerFactory: () => worker });
    const firstAbort = new AbortController();
    const first = layout.layout(diagramSystem('first'), 'diagram:first', firstAbort.signal);
    firstAbort.abort();
    const secondSystem = diagramSystem('second');
    const secondLayout = layoutDiagram(secondSystem);
    const second = layout.layout(secondSystem, 'diagram:second');

    worker.respond({
      kind: 'done',
      requestId: 1,
      revision: 'diagram:first',
      layout: layoutDiagram(diagramSystem('stale')),
    });
    worker.respond({
      kind: 'done',
      requestId: 2,
      revision: 'diagram:second',
      layout: secondLayout,
    });

    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await expect(second).resolves.toBe(secondLayout);
  });

  it('reuses the completed layout for the same immutable document revision', async () => {
    const worker = new RecordingDiagramWorker();
    const layout = createDiagramLayoutWorker({ workerFactory: () => worker });
    const geographic = diagramSystem('geographic');
    const schematic = layoutDiagram(diagramSystem('schematic'));

    const first = layout.layout(geographic, 'diagram:one');
    worker.respond({ kind: 'done', requestId: 1, revision: 'diagram:one', layout: schematic });
    await expect(first).resolves.toBe(schematic);

    await expect(layout.layout(geographic, 'diagram:one')).resolves.toBe(schematic);
    expect(worker.requests).toHaveLength(1);
  });
});
