import { previewRenderView, previewSvg } from '@transitmapper/core/render/preview';
import { parseSystem } from '@transitmapper/core/model/serialize';
import { lineSceneFeatures, projectSchemaV16LineScene } from '@transitmapper/renderer/line';
import type { PreviewWorkerEvent, PreviewWorkerRequest } from './previewWorkerProtocol';

export interface PreviewWorkerScope {
  onmessage: ((event: MessageEvent<PreviewWorkerRequest>) => void) | null;
  postMessage(message: PreviewWorkerEvent): void;
}

async function render(scope: PreviewWorkerScope, request: PreviewWorkerRequest): Promise<void> {
  try {
    const system = parseSystem(JSON.parse(request.data));
    const options = { displayWidth: request.displayWidth };
    // A card is a Network drawing, so it carries passenger Lines rather than
    // the ServicePlan runs behind them. The scene is resolved against the
    // card's own view so its clipping and detail band match what gets drawn.
    const scene = await projectSchemaV16LineScene({
      system,
      view: previewRenderView(system, options),
      sceneRevision: `preview:${system.id}:${system.updatedAt}`,
    });
    scope.postMessage({
      kind: 'done',
      markup: previewSvg(system, { ...options, passengerLines: lineSceneFeatures(scene) }),
    });
  } catch (error) {
    scope.postMessage({
      kind: 'error',
      message: error instanceof Error ? error.message : 'Preview rendering failed.',
    });
  }
}

export function installPreviewWorker(scope: PreviewWorkerScope): void {
  scope.onmessage = (event) => {
    void render(scope, event.data);
  };
}

installPreviewWorker(globalThis);
