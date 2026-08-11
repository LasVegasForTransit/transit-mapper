import { projector } from '@transitmapper/core/render/project';
import { systemSvg } from '@transitmapper/core/render/svg';
import type { SvgWorkerEvent, SvgWorkerRequest } from './svgWorkerProtocol';
import { groundPlaneProjector } from './svg-worker-projector';

interface WorkerScope {
  onmessage: ((event: MessageEvent<SvgWorkerRequest>) => void) | null;
  postMessage(message: SvgWorkerEvent): void;
}

const workerScope = globalThis as unknown as WorkerScope;

workerScope.onmessage = (event) => {
  try {
    const { system, view, options } = event.data;
    const project = event.data.projection
      ? groundPlaneProjector(event.data.projection)
      : projector(event.data.viewport);
    workerScope.postMessage({
      kind: 'done',
      markup: systemSvg(system, view, project, options),
    });
  } catch (error) {
    workerScope.postMessage({
      kind: 'error',
      message: error instanceof Error ? error.message : 'SVG rendering failed.',
    });
  }
};
